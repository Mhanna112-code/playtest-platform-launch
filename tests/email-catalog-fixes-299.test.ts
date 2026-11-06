import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { STILL_SUSPENDED_LINE } from "@/lib/rules";
import { POST as testsPOST } from "@/app/api/tests/route";
import { POST as helpPOST } from "@/app/api/help/route";
import { TOPICS } from "@/lib/helpTopics";
import { bell, sendSummaries, teamEmails } from "@/lib/server/notify";
import { remindCallsSoon } from "@/lib/server/calls";
import { finishExtraPay } from "@/lib/server/payments";
import { chargebackOpened, liftHoldIfClear, startHold } from "@/lib/server/holds";
import { pauseTest, suspendAccount, unpauseTest } from "@/lib/server/restrictions";
import { extendPauseClosure } from "@/lib/server/pauseClosure";
import { act, bookCall, joined, listingBody, sact, seen, settle, setup } from "./fixtures";
import { json, makeUser, req } from "./helpers";

// (Owner, Nov 6, §299) Four fixes from the email catalog: a payment line to a tester reaches her whatever the test's state (Pay more on a stopped test); the
// 15-minute call reminder is emailed at once (notify's `now`), never in a later summary; the team lifting its pause (and moving a paused test's closing date)
// reaches the developer like the pause (`always`, "Payments and holds"); Contact us and the team's chargeback emails go to every admin account's confirmed email
// plus ADMIN_EMAILS, each once, never to a placeholder.

const MIN = 60_000;
const lines = (userId: string) => db.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
const texts = async (userId: string) => (await lines(userId)).map((n) => n.text);
const mails = (to: string) => db.outboxEmail.findMany({ where: { to }, orderBy: { createdAt: "asc" } });
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
async function admin(confirmed = true) {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test`, unconfirmed: !confirmed });
  return db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
}
async function world() {
  const s = await setup();
  const j = await joined(s.testId, "Ana Silva");
  return { ...s, ...j, devId: s.dev.user.id, anaId: j.tester.user.id };
}
/** A second test of the same developer, with Ben working on it. */
async function secondTest(devCookie: string) {
  const r = await json(await testsPOST(req("/api/tests", { cookie: devCookie, body: listingBody({ title: "Sky Lab", productName: "Sky Lab" }) })));
  expect(r.status).toBe(200);
  await settle();
  const j = await joined(r.body.id, "Ben Okafor", "he");
  return { testId: r.body.id as string, ...j, benId: j.tester.user.id };
}
const RUNNING = "Your tests are running again";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("§299 point 1: Pay more on a finished test reaches the tester", () => {
  it("a Pay more on a stopped test: Ana's bell line and (with email Off) her end-of-day email", async () => {
    const w = await world();
    await db.user.update({ where: { id: w.anaId }, data: { emailPref: "off" } });
    await sact(w.sessionId, "written", w.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: w.sessionId } });
    expect((await act(w.testId, "stop", w.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: w.testId } })).status).toBe("stopped");
    const p = await db.payment.create({ data: { kind: "extra", developerId: w.devId, testerId: w.anaId, contractId: w.sessionId, submissionId: sub.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "processing" } });
    await finishExtraPay(p.id, { status: "paid", stripePaymentIntentId: null });
    const mine = (await lines(w.anaId)).filter((n) => n.text.startsWith("Nora Lane paid you $5.00 more"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ payment: true, groupKey: "tpaid" });
    await sendSummaries(new Date(), [w.anaId]);
    expect((await mails(w.tester.user.email)).some((m) => m.text.includes("Nora Lane paid you $5.00 more"))).toBe(true);
  });

  it("the reach rule keeps dropping other lines about a counterpart on a stopped test, but never a payment line (notify and bell alike)", async () => {
    const w = await world();
    expect((await act(w.testId, "stop", w.dev.cookie, { reason: "Done.", seenAt: seen(), confirmed: true })).status).toBe(200);
    await bell(w.anaId, "NOT A PAYMENT", `/app/sessions/${w.sessionId}`, w.devId, { side: "tester" });
    await bell(w.anaId, "A PAYMENT", `/app/sessions/${w.sessionId}`, w.devId, { side: "tester", payment: true, group: "tpaid" });
    const t = await texts(w.anaId);
    expect(t).toContain("A PAYMENT");
    expect(t).not.toContain("NOT A PAYMENT");
    // Every payment line to a tester that names its developer as `about` is one of these two (Pay more, $0 more): no other tester payment line carries `about`.
    const n = src("lib/server/notify.ts");
    expect(n).toContain("if (user && opts.about && !opts.payment && !(await inReach(user.id, opts.about))) return;");
    expect(n).toContain("if (about && !opts.payment && !(await inReach(userId, about))) return;");
  });
});

describe("§299 point 2: the 15-minute call reminder goes out at once", () => {
  it("both are emailed immediately; the bell lines stay, already emailed, and the next summary doesn't repeat them; email Off: the bell line only", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() + 14 * MIN), createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    await db.user.update({ where: { id: j.tester.user.id }, data: { emailPref: "weekly" } });
    await remindCallsSoon();
    for (const [u, who] of [[j.tester.user, "Nora Lane"], [s.dev.user, "Ana Silva"]] as const) {
      const ns = await db.notification.findMany({ where: { userId: u.id, reminderKey: `call15:${call.id}` } });
      expect(ns).toHaveLength(1);
      expect(ns[0].text).toMatch(new RegExp(`^Your call with ${who} on “Harbor Run” starts at `));
      expect(ns[0].summarizedAt).not.toBeNull();
      expect(ns[0].mustEmail).toBe(false);
      const sent = (await mails(u.email)).filter((m) => m.subject === ns[0].text);
      expect(sent).toHaveLength(1);
    }
    // The next summaries don't list it again.
    await sendSummaries(new Date(), [j.tester.user.id, s.dev.user.id]);
    for (const u of [j.tester.user, s.dev.user]) expect((await mails(u.email)).filter((m) => m.text.includes("starts at"))).toHaveLength(1);
    // Email Off: the bell line, no email.
    const w2 = await world();
    await db.user.update({ where: { id: w2.devId }, data: { emailPref: "off" } });
    const c2 = await bookCall(w2.testId, w2.dev.cookie, w2.sessionId, w2.tester.cookie);
    await db.call.update({ where: { id: c2.id }, data: { startsAt: new Date(Date.now() + 14 * MIN), createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    await remindCallsSoon();
    const off = await db.notification.findMany({ where: { userId: w2.devId, reminderKey: `call15:${c2.id}` } });
    expect(off).toHaveLength(1);
    expect((await mails(w2.dev.user.email)).filter((m) => m.subject === off[0].text)).toHaveLength(0);
    await sendSummaries(new Date(), [w2.devId]);
    expect((await mails(w2.dev.user.email)).filter((m) => m.text.includes("starts at"))).toHaveLength(0);
  });
});

describe("§299 point 3: the team's lift reaches the developer like its pause", () => {
  it("the lift and a closing date moved later are `always`, in the pause's Payments and holds stack; with email Off they reach the end-of-day email", async () => {
    const w = await world();
    await db.user.update({ where: { id: w.devId }, data: { emailPref: "off" } });
    const a = await admin();
    await pauseTest(a.id, w.testId, "Checking the build");
    await extendPauseClosure(w.testId, 3, new Date(), a.id);
    await unpauseTest(w.testId, a.id);
    const dl = await lines(w.devId);
    for (const re of [/^The team paused/, /will close later$/, /^The team lifted the pause on “Harbor Run”$/])
      expect(dl.find((l) => re.test(l.text)), String(re)).toMatchObject({ own: false, groupKey: "payhold", mustEmail: true });
    await sendSummaries(new Date(), [w.devId]);
    const m = (await mails(w.dev.user.email)).map((x) => x.text).join("\n");
    expect(m).toContain("The team lifted the pause on “Harbor Run”");
    expect(m).toContain("“Harbor Run” will close later");
    // One lift, no account-wide "running again" for it.
    expect(dl.filter((l) => l.text === RUNNING)).toHaveLength(0);
  });

  it("a hold lifts while the team's pause is on: that test stays paused (its testers hear nothing); ONE running-again line; the team's lift later runs it", async () => {
    const w = await world();
    const two = await secondTest(w.dev.cookie);
    const a = await admin();
    await pauseTest(a.id, w.testId, "x");
    await startHold(w.devId, "unpaid");
    expect(await liftHoldIfClear(w.devId)).toBe(true);
    const t1 = await db.test.findUniqueOrThrow({ where: { id: w.testId } });
    expect(t1.adminPausedAt).not.toBeNull();
    expect(t1.pausedSince).not.toBeNull();
    expect((await db.test.findUniqueOrThrow({ where: { id: two.testId } })).pausedSince).toBeNull();
    expect((await texts(w.anaId)).filter((t) => t.endsWith("is running again"))).toHaveLength(0);
    expect((await texts(two.benId)).filter((t) => t === "“Sky Lab” is running again")).toHaveLength(1);
    expect((await texts(w.devId)).filter((t) => t === RUNNING)).toHaveLength(1); // one line for both tests
    // The team lifts its pause: Ana's test runs again, told once; the developer reads the team's lift, never a second "running again".
    await unpauseTest(w.testId, a.id);
    expect((await db.test.findUniqueOrThrow({ where: { id: w.testId } })).pausedSince).toBeNull();
    expect((await texts(w.anaId)).filter((t) => t === "“Harbor Run” is running again")).toHaveLength(1);
    const dev = await texts(w.devId);
    expect(dev.filter((t) => t === RUNNING)).toHaveLength(1);
    expect(dev.filter((t) => t === "The team lifted the pause on “Harbor Run”")).toHaveLength(1);
  });

  it("the team lifts its pause while a hold is on: the test stays paused, nobody is told it runs; the hold's lift then sends ONE running-again", async () => {
    const w = await world();
    const a = await admin();
    await pauseTest(a.id, w.testId, "x");
    await startHold(w.devId, "unpaid");
    await unpauseTest(w.testId, a.id);
    const t = await db.test.findUniqueOrThrow({ where: { id: w.testId } });
    expect(t.adminPausedAt).toBeNull();
    expect(t.pausedSince).not.toBeNull(); // the hold still pauses it
    expect((await texts(w.anaId)).filter((x) => x.endsWith("is running again"))).toHaveLength(0);
    let dev = await lines(w.devId);
    expect(dev.find((l) => l.text === "The team lifted the pause on “Harbor Run”")).toMatchObject({ mustEmail: true, groupKey: "payhold" });
    expect(dev.filter((l) => l.text === RUNNING)).toHaveLength(0);
    expect(await liftHoldIfClear(w.devId)).toBe(true);
    expect((await db.test.findUniqueOrThrow({ where: { id: w.testId } })).pausedSince).toBeNull();
    dev = await lines(w.devId);
    expect(dev.filter((l) => l.text === RUNNING)).toHaveLength(1);
    expect((await texts(w.anaId)).filter((x) => x === "“Harbor Run” is running again")).toHaveLength(1);
  });

  it("a hold lifting during a suspension: STILL_SUSPENDED_LINE, no running again; the tests stay paused", async () => {
    const w = await world();
    const a = await admin();
    await suspendAccount(a.id, w.devId, "Checking", "developer");
    await startHold(w.devId, "unpaid");
    expect(await liftHoldIfClear(w.devId)).toBe(true);
    const dev = await texts(w.devId);
    expect(dev.filter((t) => t === STILL_SUSPENDED_LINE)).toHaveLength(1);
    expect(dev.filter((t) => t === RUNNING)).toHaveLength(0);
    expect((await db.test.findUniqueOrThrow({ where: { id: w.testId } })).pausedSince).not.toBeNull();
    expect((await texts(w.anaId)).filter((x) => x.endsWith("is running again"))).toHaveLength(0);
  });
});

describe("§299 point 4: Contact us and the team's chargeback emails go to every admin account", () => {
  it("every admin account's confirmed email plus ADMIN_EMAILS, each once; an unconfirmed admin address gets nothing", async () => {
    const yes = await admin(true);
    const no = await admin(false);
    const sender = await makeUser({ name: "Ana Silva" });
    const message = `Something odd happened ${randomUUID()}`;
    expect((await json(await helpPOST(req("/api/help", { cookie: sender.cookie, body: { topic: TOPICS[0], message } })))).status).toBe(200);
    const got = async (to: string) => (await mails(to)).filter((m) => m.text.includes(message));
    expect(await got(yes.email)).toHaveLength(1);
    expect(await got("owner@playtest.test")).toHaveLength(1); // ADMIN_EMAILS kept
    expect(await got(no.email)).toHaveLength(0);
    expect(await got("team@playtest.local")).toHaveLength(0);
    // An admin account listed in ADMIN_EMAILS too (any case) is emailed once.
    vi.stubEnv("ADMIN_EMAILS", `${yes.email.toUpperCase()}, extra-${randomUUID()}@playtest.test`);
    const to = await teamEmails("x");
    expect(to.filter((e) => e.toLowerCase() === yes.email.toLowerCase())).toHaveLength(1);
    expect(to.some((e) => e.startsWith("extra-"))).toBe(true);
    vi.unstubAllEnvs();
    // The team's chargeback email: the same list.
    const dev = await makeUser({ dev: true });
    const payee = await makeUser({ tester: true });
    const pi = `pi_${randomUUID()}`;
    await db.payment.create({ data: { kind: "review", developerId: dev.user.id, testerId: payee.user.id, amountCents: 1234, feeCents: 0, testerCents: 0, status: "paid", stripePaymentIntentId: pi } });
    await chargebackOpened(pi);
    const cb = async (addr: string) => (await mails(addr)).filter((m) => m.text.includes(pi));
    expect(await cb(yes.email)).toHaveLength(1);
    expect(await cb("owner@playtest.test")).toHaveLength(1);
    expect(await cb(no.email)).toHaveLength(0);
  });

  it("no admin account and no ADMIN_EMAILS: no placeholder address; the reason is logged", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    const notify = await import("@/lib/server/notify");
    vi.spyOn(db.user, "findMany").mockResolvedValueOnce([] as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await notify.teamEmails("Contact us (Payments)")).toEqual([]);
    expect(err.mock.calls.some((c) => String(c[0]).includes("Contact us (Payments): not sent"))).toBe(true);
    vi.unstubAllEnvs();
    expect(src("app/api/help/route.ts")).not.toContain("playtest.local");
    expect(src("app/api/help/route.ts")).toContain("await teamEmails(");
    expect(src("lib/server/holds.ts")).not.toMatch(/process\.env\.ADMIN_EMAILS/);
  });
});
