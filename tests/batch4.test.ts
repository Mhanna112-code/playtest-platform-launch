import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as helpPOST } from "@/app/api/help/route";
import { POST as profilePOST } from "@/app/api/profile/route";
import { POST as testsPOST } from "@/app/api/tests/route";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { POST as chatOpenPOST } from "@/app/api/chat/open/route";
import { POST as joinCallPOST } from "@/app/api/calls/[id]/join/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { setStripeForTests } from "@/lib/server/stripe";
import { devRestricted, restrictionKey, restrictionOf } from "@/lib/restricted";
import { changesLeftLine, countsOf, LIMITS } from "@/lib/limits";
import { notify, bell, sendSummaries } from "@/lib/server/notify";
import { chargebackOpened, owed, startHold } from "@/lib/server/holds";
import { findTests } from "@/lib/server/tests";
import { suspendedAccountsReminder } from "@/lib/server/restrictions";
import { ratingReminders } from "@/lib/server/ratings";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, listingBody, sact, seen, settle, setup } from "./fixtures";

const DAY = 86_400_000;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } })).then((r) => r.json());
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const admin = async () => {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
};
const lines = (userId: string) => db.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
afterEach(() => setStripeForTests(null));

async function sentWork(over: Record<string, unknown> = {}) {
  const s = await setup(over);
  const j = await joined(s.testId);
  const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
  await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}

describe("A3) a payment hold, a chargeback hold and a suspension are one state", () => {
  it("restrictionOf / devRestricted / restrictionKey", () => {
    expect(restrictionOf({})).toBeNull();
    expect(restrictionOf({ devSuspendedAt: new Date(), holdStartedAt: new Date() })).toBe("suspended");
    expect(restrictionOf({ holdStartedAt: new Date(), holdReason: "chargeback" })).toBe("chargeback");
    expect(restrictionOf({ holdStartedAt: new Date(), holdReason: "unpaid" })).toBe("hold");
    const both = { isDeveloper: true, isTester: true, holdStartedAt: new Date(), side: "tester" };
    expect(devRestricted(both, "tester")).toBe(false);
    expect(devRestricted(both, "developer")).toBe(true);
    expect(devRestricted({ ...both, devSuspendedAt: new Date() }, "tester")).toBe(false); // (batch 15 section 16) a developer-side suspension leaves the tester side working
    expect(devRestricted({ ...both, devSuspendedAt: new Date() }, "developer")).toBe(true);
    expect(restrictionKey({ isDeveloper: true, isTester: false, holdStartedAt: new Date(), holdReason: "chargeback" })).toBe("c");
    expect(restrictionKey({ isDeveloper: true, isTester: false, devSuspendedAt: new Date(), holdStartedAt: new Date() })).toBe("sh");
    expect(restrictionKey({ isDeveloper: true, isTester: false })).toBe("");
  });

  it("every developer press is refused for a held or suspended developer except Cancel call (which works from the dashboard); each names itself", async () => {
    for (const how of ["hold", "suspended"] as const) {
      const { dev, testId, sessionId, tester } = await sentWork();
      const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 24 * 6);
      if (how === "hold") await startHold(dev.user.id, "unpaid");
      else await db.user.update({ where: { id: dev.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
      const code = how === "hold" ? "held" : "suspended";
      // (Batch 15 section 29) Stop and End early now work from the restricted view (tested in batch15-paused); everything else is refused.
      for (const [action, body] of [["edit", { version: 1, fields: { title: "x" } }], ["next-round", {}], ["invite", { testerIds: [tester.user.id] }], ["pay-extra", { contractId: sessionId, amount: "2.00" }], ["lower-length", { callId: call.id, minutes: 20, reason: "We stopped early." }], ["message", { contractId: sessionId, body: "hi" }]] as const) {
        const r = await act(testId, action, dev.cookie, { seenAt: seen(), confirmed: true, ...body });
        expect(r.status, `${how} ${action}`).toBe(403);
        expect(r.body.error.code, `${how} ${action}`).toBe(code);
        expect(r.body.error.failed, `${how} ${action}`).toMatch(/didn't go through$/);
      }
      expect((await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody() })))).body.error.code).toBe(code);
      expect((await json(await profilePOST(req("/api/profile", { cookie: dev.cookie, body: { name: "New", isDeveloper: true } })))).body.error.code).toBe(code);
      // The one press that works.
      expect((await act(testId, "cancel-call", dev.cookie, { callId: call.id, seenAt: seen(), confirmed: true })).status).toBe(200);
      expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).status).toBe("cancelled");
    }
  });

  it("the blue box, the closed pages and the strip: sources", () => {
    const box = src("components/RestrictedBox.tsx");
    expect(box).toContain('className="info space-y-2"'); // blue, not red
    expect(box).toContain("Pay what you owe");
    expect(box).toContain('target="_blank"'); // opens Payments in a new tab
    expect(box).toContain("Contact us");
    expect(box).toContain("tests resume as normal");
    expect(box).toContain("LongList"); // 3 lines, then Show N more
    expect(src("components/SessionWatch.tsx")).toContain('window.location.replace("/app")');
    expect(src("components/SessionWatch.tsx")).toContain("window.scrollTo({ top: 0 })");
    expect(src("lib/client.ts")).toContain("`/app?failed=");
    const layout = src("app/app/layout.tsx");
    expect(layout).toContain("Email confirmation is off for testing.");
    expect(layout).toContain("confirmSkipped()");
    expect(layout).toContain("restrictedOn(u, side)"); // (Owner, Oct 28) every link to a closed page is hidden
    expect(src("app/app/page.tsx")).toContain('<RestrictedBox');
    expect(src("app/app/page.tsx")).not.toContain("border-rose-400/50");
  });
});

describe("A1, A2) declined payments and chargebacks", () => {
  it("a chargeback during a payment hold turns it into a chargeback hold (count unchanged); every further chargeback adds to what is owed", async () => {
    const { dev, sessionId, sub, tester } = await sentWork();
    await startHold(dev.user.id, "unpaid");
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdCount).toBe(1);
    const mk = async (cents: number) => {
      const pi = "pi_" + randomUUID();
      await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: cents, feeCents: 0, testerCents: 0, status: "charged", stripePaymentIntentId: pi } });
      return pi;
    };
    await chargebackOpened(await mk(800));
    const u1 = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    expect(u1).toMatchObject({ holdReason: "chargeback", holdCount: 1 });
    expect((await lines(dev.user.id)).find((l) => /now a chargeback hold/.test(l.text))).toMatchObject({ mustEmail: true, groupKey: "payhold" });
    // (Batch 11) Each chargeback is owed with its $15 fee.
    expect((await owed(dev.user.id)).reduce((a, p) => a + p.amountCents, 0)).toBe(2300);
    await chargebackOpened(await mk(500));
    expect((await owed(dev.user.id)).reduce((a, p) => a + p.amountCents, 0)).toBe(4300);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdCount).toBe(1);
  });

  it("the 4th hold still needs an admin's Approve (the count is unchanged by chargebacks)", async () => {
    const { dev } = await setup();
    await db.user.update({ where: { id: dev.user.id }, data: { holdCount: 3 } });
    await startHold(dev.user.id, "unpaid");
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdCount).toBe(4);
    const { payOwed } = await import("@/lib/server/holds");
    // (Batch 10) Nothing is owed: the press is refused and the hold stays (it waits for Approve).
    await expect(payOwed(dev.user)).rejects.toMatchObject({ code: "nothing_owed" });
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).not.toBeNull();
  });
});

describe("A8) the extra-pay cap (batch 9: per piece, $1000 max for an unlisted part, plus 100% of the max as extra pay)", () => {
  it("a part with no listed price: (batch 11: one Pay box) at most $1000 plus $1000 above it, $2000 in all", async () => {
    const { dev, testId, sessionId, sub } = await sentWork({ writtenCents: null, questions: [] });
    expect(sub.agreedCents).toBeNull();
    const over = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "2000.01", tickedCents: 200_001, over200: true });
    expect(over.status).toBe(400);
    expect(over.body.error.message).toBe("This is more than you can pay above the max (up to $1,000).");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "600.00", tickedCents: 60_000, over200: true })).status).toBe(200);
    const tooMuch = await act(testId, "pay-extra", dev.cookie, { seenAt: seen(), contractId: sessionId, submissionId: sub.id, amount: "1400.01", tickedCents: 140_001, over200: true, payKey: randomUUID() });
    expect(tooMuch.body.error.message).toBe("This is more than you can pay above the max (up to $1,000).");
    expect((await act(testId, "pay-extra", dev.cookie, { seenAt: seen(), contractId: sessionId, submissionId: sub.id, amount: "1400.00", tickedCents: 140_000, over200: true, payKey: randomUUID() })).status).toBe(200);
  });
});

describe("E2, E3) stacking by kind and reminders in the summary email", () => {
  it("Weekly / Monthly emails show only the newest copy of each reminder; Daily lists them all; each line is emailed once", async () => {
    const wk = await makeUser({ dev: true });
    const dy = await makeUser({ dev: true });
    await db.user.update({ where: { id: wk.user.id }, data: { emailPref: "weekly", lastSummaryAt: new Date(Date.now() - 8 * DAY) } });
    await db.user.update({ where: { id: dy.user.id }, data: { emailPref: "daily", lastSummaryAt: new Date(Date.now() - 2 * DAY) } });
    for (const u of [wk, dy]) {
      await bell(u.user.id, "Harbor Run is paused and closes on Nov 3 unless you pay what you owe", "/app", undefined, { reminder: "paused:t1" });
      await db.notification.updateMany({ where: { userId: u.user.id }, data: { createdAt: new Date(Date.now() - 2 * DAY) } });
      await bell(u.user.id, "Harbor Run is paused and closes on Nov 3 unless you pay what you owe (newest)", "/app", undefined, { reminder: "paused:t1" });
      await bell(u.user.id, "A plain line", "/app");
    }
    await sendSummaries();
    const text = async (u: { user: { email: string } }) => (await db.outboxEmail.findMany({ where: { to: u.user.email } })).map((m) => m.text).join("\n");
    const w = await text(wk), d = await text(dy);
    expect(w).toContain("(newest)");
    expect(w.match(/is paused and closes/g)).toHaveLength(1);
    expect(w).toContain("A plain line");
    expect(d.match(/is paused and closes/g)).toHaveLength(2);
    expect((await db.notification.findMany({ where: { userId: wk.user.id, summarizedAt: null } })).length).toBe(0); // the older copy is marked done, not emailed later
    await sendSummaries();
    expect((await db.outboxEmail.findMany({ where: { to: wk.user.email } })).length).toBe(1); // once only
  });

  it("the stacking kinds are groups across tests, not per-test entries", async () => {
    const { dev } = await setup();
    await notify(dev.user.email, "Dispute on one", ["x"], "/app", { group: "disputefiled" });
    await notify(dev.user.email, "Dispute on two", ["x"], "/app", { group: "disputefiled" });
    const l = await lines(dev.user.id);
    const { bellKey } = await import("@/lib/bell");
    expect(new Set(l.map(bellKey)).size).toBe(1);
    const bellSrc = src("lib/bell.ts");
    for (const g of ["payhold", "admindecision", "disputefiled", "disputedecided", "pausedreminder", "tpaid", "trejected", "tdelayed", "tarrived", "textra", "tstopped", "suspendedreview"]) expect(bellSrc).toContain(`${g}:`);
    expect(bellSrc).not.toContain("owed:");
  });

  it("the suspended-accounts review is daily and skips deleted admins", async () => {
    const gone = await admin();
    const live = await admin();
    await db.user.update({ where: { id: gone.user.id }, data: { deletedAt: new Date() } });
    const t = await makeUser({ tester: true });
    await db.user.update({ where: { id: t.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    await db.appState.deleteMany({ where: { key: "suspended-reminder" } });
    await suspendedAccountsReminder();
    expect((await lines(live.user.id)).some((l) => /suspended account sides? to review$/.test(l.text) && l.groupKey === "suspendedreview")).toBe(true);
    expect((await lines(gone.user.id)).length).toBe(0);
  });

  it("Open until heads-ups wait while the test is paused", async () => {
    const { dev, testId } = await setup();
    const { tester } = await joined(testId);
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() + 2 * DAY) } });
    await db.contract.updateMany({ where: { testId }, data: { dueAt: new Date(Date.now() + 2 * DAY), joinedAt: new Date(Date.now() - 5 * DAY) } }); // (batch 16 section 1) their own deadline; the 3-day mark is due
    await startHold(dev.user.id, "unpaid");
    await cron();
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "Your deadline on" } } })).toBe(0);
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: null, holdReason: "" } });
    await cron();
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "Your deadline on" } } })).toBe(1); // (batch 15 section 18) their own deadline
  });
});

describe("E4) email confirmation only for Post, Join, Apply and accepting an invite", () => {
  it("an unconfirmed developer can edit, invite and pay; Post a test and Join say so with the email", async () => {
    const dev = await makeUser({ dev: true, unconfirmed: true });
    const posted = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody() })));
    expect(posted.status).toBe(409);
    expect(posted.body.error.message).toBe(`Confirm your email first. We sent a link to ${dev.user.email}.`);
    await db.user.update({ where: { id: dev.user.id }, data: { emailVerifiedAt: new Date() } });
    const t = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody() })));
    await db.user.update({ where: { id: dev.user.id }, data: { emailVerifiedAt: null } });
    const edit = await act(t.body.id, "edit", dev.cookie, { version: 1, fields: { title: "Renamed" } });
    expect(edit.status).toBe(200);
    const tester = await makeUser({ tester: true, unconfirmed: true });
    const join = await act(t.body.id, "join", tester.cookie, { listingVersion: 2 });
    expect(join.status).toBe(409);
    expect(join.body.error.message).toBe(`Confirm your email first. We sent a link to ${tester.user.email}.`);
    expect(src("components/Err.tsx")).toContain("Resend the link");
    // Sending work needs no confirmation.
    await db.user.update({ where: { id: tester.user.id }, data: { emailVerifiedAt: new Date() } });
    const j = await act(t.body.id, "join", tester.cookie, { listingVersion: 2 });
    await db.user.update({ where: { id: tester.user.id }, data: { emailVerifiedAt: null } });
    expect((await sact(j.body.sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
  });
});

describe("E5, E6, E7) names, Contact us, data requests", () => {
  it("Contact us works for suspended and held accounts and is limited to 5 a day (a blue 409 on the 6th)", async () => {
    const t = await makeUser({ tester: true });
    const d = await makeUser({ dev: true });
    await db.user.update({ where: { id: t.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    await db.user.update({ where: { id: d.user.id }, data: { holdStartedAt: new Date(), holdReason: "unpaid" } });
    const send = (cookie: string) => helpPOST(req("/api/help", { cookie, body: { topic: "My account", message: "Please look at my account, thanks" } })).then(json);
    for (let i = 0; i < 5; i++) expect((await send(t.cookie)).status).toBe(200);
    const sixth = await send(t.cookie);
    expect(sixth.status).toBe(409);
    expect(sixth.body.error.message).toBe("You've sent 5 messages today. We'll reply by email.");
    expect((await send(d.cookie)).status).toBe(200); // the limit is per account
    await db.contactMessage.updateMany({ where: { userId: t.user.id }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    expect((await send(t.cookie)).status).toBe(200);
    expect(LIMITS.contactPerDay).toBe(5);
  });

  it("data requests go through Contact us: a topic, and no data-request item in Settings", () => {
    expect(src("lib/helpTopics.ts")).toContain("A request about my data");
    expect(src("app/app/account/page.tsx")).not.toMatch(/download my data|data request|export your data/i);
  });

  it("Unblock works for a held account and not for a suspended one", async () => {
    const a = await makeUser({ dev: true });
    const b = await makeUser({ tester: true });
    await db.block.create({ data: { blockerId: a.user.id, blockedId: b.user.id } });
    await db.user.update({ where: { id: a.user.id }, data: { holdStartedAt: new Date(), holdReason: "unpaid" } });
    expect((await json(await blocksPOST(req("/api/blocks", { cookie: a.cookie, body: { userId: b.user.id } })))).body.error.code).toBe("held"); // Block waits
    expect((await json(await blocksPOST(req("/api/blocks", { cookie: a.cookie, body: { userId: b.user.id, action: "unblock" } })))).status).toBe(200);
    await db.block.create({ data: { blockerId: a.user.id, blockedId: b.user.id } });
    await db.user.update({ where: { id: a.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    expect((await json(await blocksPOST(req("/api/blocks", { cookie: a.cookie, body: { userId: b.user.id, action: "unblock" } })))).body.error.code).toBe("suspended");
  });
});

describe("B3) Join call", () => {
  it("a press after a cancellation reads 'This call was cancelled' with the reason; the status reports it for the live check", async () => {
    const { dev, testId, sessionId, tester } = await sentWork();
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 24 * 6);
    await db.call.update({ where: { id: call.id }, data: { status: "cancelled", cancelledBy: "developer", cancelNote: "Something came up" } });
    const r = await json(await joinCallPOST(req(`/api/calls/${call.id}/join`, { cookie: tester.cookie, body: {} }), { params: Promise.resolve({ id: call.id }) }));
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe("Your Join call didn't go through: Nora Lane cancelled this call."); // (batch 15 section 38)
    expect(src("components/JoinCall.tsx")).toContain("setGone(true)");
  });
});

describe("C) Edit: 3 significant changes", () => {
  it("(batch 5 item 2, batch 6 item 3) the steps, NDA, questions, languages and devices count PER FIELD; prices, parts and the link don't; the line reads 'Changes left: 2 of 3'", async () => {
    expect(changesLeftLine(1)).toBe("Changes left: 2 of 3");
    expect(changesLeftLine(3)).toBe("Changes left: 0 of 3");
    const { dev, testId } = await setup();
    await joined(testId);
    const ver = async () => (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: await ver(), fields: { ndaText: "Secret", questions: ["A?"] } })).status).toBe(200);
    expect(countsOf((await db.test.findUniqueOrThrow({ where: { id: testId } })).criticalCounts)).toMatchObject({ ndaText: 1, questions: 1, description: 0 }); // one change of each
    expect((await act(testId, "edit", dev.cookie, { version: await ver(), fields: { ndaText: "Two" } })).status).toBe(200);
    expect((await act(testId, "edit", dev.cookie, { version: await ver(), fields: { ndaText: "Three" } })).status).toBe(200);
    const fourth = await act(testId, "edit", dev.cookie, { version: await ver(), fields: { ndaText: "Another" } });
    expect(fourth.status).toBe(400);
    expect(fourth.body.error.critical).toEqual(["ndaText"]);
    // Not limited: prices, parts and the build link.
    expect((await act(testId, "edit", dev.cookie, { version: await ver(), fields: { writtenCents: "11.00", liveRateCents: "40.00", buildUrl: "https://example.com/z", liveRequired: true } })).status).toBe(200);
    expect(countsOf((await db.test.findUniqueOrThrow({ where: { id: testId } })).criticalCounts)).toMatchObject({ ndaText: 3, questions: 1, languages: 0, devices: 0, description: 0 });
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("changesLeftLine");
    expect(form).toContain('disabled={fieldLocked("ndaText")}');
  });
});

describe("D) testers", () => {
  it("paused tests are not in Find tests (a hold, a suspension or the team's pause)", async () => {
    const a = await setup();
    const b = await setup();
    const c = await setup();
    const tester = await makeUser({ tester: true });
    const ids = async () => (await findTests(tester.user)).map((t) => t.id);
    expect(await ids()).toEqual(expect.arrayContaining([a.testId, b.testId, c.testId]));
    await db.user.update({ where: { id: a.dev.user.id }, data: { holdStartedAt: new Date(), holdReason: "unpaid" } });
    await db.user.update({ where: { id: b.dev.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    await db.test.update({ where: { id: c.testId }, data: { adminPausedAt: new Date() } });
    const now = await ids();
    for (const x of [a, b, c]) expect(now).not.toContain(x.testId);
    expect(src("app/app/find/[id]/page.tsx")).toContain("This test isn&apos;t available right now.");
  });

  it("(batch 5 item 4) Dismiss removes a 'You were removed from this test' card after a reinstatement; no automatic re-invite", async () => {
    const a = await admin();
    const inviteOnly = await setup({ joinMode: "invite" });
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    await act(inviteOnly.testId, "invite", inviteOnly.dev.cookie, { seenAt: seen(), testerIds: [t.user.id] });
    const j = await act(inviteOnly.testId, "join", t.cookie, { listingVersion: 1 });
    expect(j.status).toBe(200);
    expect((await aact(a.cookie, "suspend", { id: t.user.id, note: "Testing" })).status).toBe(200);
    expect((await aact(a.cookie, "unsuspend", { id: t.user.id })).status).toBe(200);
    expect(await db.invite.count({ where: { testId: inviteOnly.testId, testerId: t.user.id, status: "sent" } })).toBe(0);
    const sid = j.body.sessionId as string;
    expect((await sact(sid, "dismiss-removed", t.cookie, {})).status).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: sid } })).removedDismissedAt).not.toBeNull();
    const dash = src("app/app/page.tsx");
    for (const w of ["Tests you were removed from", "Tests you left", "Send work", "Charge or cancel", "Needs review", "data-paused-tag"]) expect(dash, w).toContain(w);
  });

  it("rating reminders: every 3 days after a stop or close, for 2 weeks only", async () => {
    const { dev, testId, sessionId, tester, sub } = await sentWork();
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true });
    await db.contract.update({ where: { id: sessionId }, data: { ratePromptedAt: new Date(Date.now() - 4 * DAY) } });
    await db.test.update({ where: { id: testId }, data: { stoppedAt: new Date(Date.now() - 4 * DAY) } });
    await ratingReminders(new Date());
    expect((await lines(tester.user.id)).some((l) => l.reminderKey === `rate:${sessionId}`)).toBe(true);
    await db.notification.deleteMany({ where: { userId: tester.user.id, text: { startsWith: "Reminder: rate" } } });
    await ratingReminders(new Date(Date.now() + 12 * DAY)); // 16 days after the stop: past the 2 weeks
    expect(await db.notification.count({ where: { userId: tester.user.id, reminderKey: `rate:${sessionId}` } })).toBe(0);
  });

  it("'Chat with <name>' works both ways and is refused for the side that is suspended or held (batch 15 section 1: the other person can still open it)", async () => {
    const { dev, sessionId, tester } = await sentWork();
    const open = (cookie: string) => chatOpenPOST(req("/api/chat/open", { cookie, body: { contractId: sessionId } })).then(json);
    expect((await open(dev.cookie)).status).toBe(200);
    expect((await open(tester.cookie)).status).toBe(200);
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: new Date(), holdReason: "unpaid" } });
    expect((await open(dev.cookie)).body.error.message).toBe("Unable to chat with this tester.");
    expect((await open(tester.cookie)).status).toBe(200); // read-only for them: "Messages are paused for now."
    expect(src("components/PersonHover.tsx")).toContain("chat?: ReactNode");
    expect(src("app/app/tests/[id]/TestersJoined.tsx")).toContain("seat.chat");
  });

  it("the developer's tester row shows the agreed scope only: no History fold; a Switch / Keep is a live line with 'See their contract'", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).not.toContain('data-history=""');
    expect(page).toContain('contractLink="scroll"');
    expect(src("app/app/tests/[id]/edit/page.tsx")).toContain("contractLink={{ testId: id }}");
    expect(src("components/LiveTop.tsx")).toContain("See their contract");
  });

  it("accepting an application sends the developer no second 'joined' line", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const t = await makeUser({ tester: true, name: "Dee Moss" });
    await act(testId, "apply", t.cookie, { note: "Hi" });
    const app = await db.application.findFirstOrThrow({ where: { testId } });
    expect((await act(testId, "application", dev.cookie, { applicationId: app.id, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await lines(dev.user.id)).map((l) => l.text)).toEqual(["Dee Moss applied to join “Harbor Run”"]);
  });
});

// ---------- Oct 28 follow-ups (the media pass) ----------
import { GET as pulseGET } from "@/app/api/pulse/route";
import { alertOf } from "@/lib/alerts";

describe("follow-up 1) (undone by batch 6 item 1) calls on a test without a Live call part", () => {
  it("a request is allowed again on both sides (see batch6.test.ts)", async () => {
    const { dev, testId } = await setup({ liveRateCents: null });
    const { tester, sessionId } = await joined(testId);
    const startsAt = new Date(Date.now() + 48 * 3_600_000).toISOString();
    expect((await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt })).status).toBe(200);
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), confirmed: true, startsAt: new Date(Date.now() + 72 * 3_600_000).toISOString() })).status).toBe(200);
    expect(await db.callRequest.count({ where: { testId } })).toBe(2);
    expect(src("app/app/sessions/[id]/page.tsx")).not.toContain("hasLivePart");
  });
});

describe("follow-up 2, 3) the team stopping a test", () => {
  it("is a hard refusal for every press a stopped test does not allow, never a stop-once; Pay and chat carry on; the page moves live", async () => {
    const a = await admin();
    const { dev, testId, sessionId, sub } = await sentWork();
    const loaded = seen();
    await new Promise((r) => setTimeout(r, 30));
    expect((await aact(a.cookie, "stop-test", { id: testId, note: "Policy" })).status).toBe(200);
    for (const [action, body] of [["edit", { version: 1, fields: { title: "x" } }], ["stop", { reason: "We have what we need." }], ["next-round", {}], ["invite", { testerIds: [sessionId] }], ["end-early", { contractIds: [sessionId], reason: "Enough said" }], ["request-time", { contractIds: [sessionId], startsAt: new Date(Date.now() + 48 * 3_600_000).toISOString() }]] as const) {
      const r = await act(testId, action, dev.cookie, { seenAt: loaded, ...body });
      expect(r.status, action).toBe(409);
      expect(r.body.error.code, action).toBe("admin_stopped");
      expect(r.body.error.failed, action).toMatch(/didn't go through$/);
    }
    // Pay was allowed before and still is. (Batch 17 section 12) From a page opened before the team's stop it stops once with it, then goes ahead.
    const p0 = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, confirmed: false });
    expect(p0.body.error.changes.map((x: { text: string }) => x.text)).toEqual([expect.stringMatching(/^The team stopped this test at /)]);
    const p = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, confirmed: true, boxAt: new Date().toISOString() });
    expect(p.status).toBe(200);
    expect((await act(testId, "message", dev.cookie, { contractId: sessionId, body: "Thanks all" })).status).toBe(200);
    // The pulse tells the open page (and Edit) the team stopped it.
    const pulse = await json(await pulseGET(req(`/api/pulse?test=${testId}`, { cookie: dev.cookie })));
    expect(pulse.body.adminStopped).toBe(true);
    const ac = src("components/AutoRefresh.tsx");
    expect(ac).toContain("adminStopped");
    expect(ac).toContain("window.location.href = `/app/tests/${testId}`");
    expect(src("app/app/tests/[id]/edit/page.tsx")).toContain("<AutoRefresh");
    expect(src("app/app/tests/[id]/edit/page.tsx")).toMatch(/className="err-field"[^>]*>This test was stopped\./); // red, not blue
    expect(alertOf("stopped")).toBeNull();
  });
});

describe("follow-up 4) the redirect for a restricted developer", () => {
  it("is decided before anything else renders, by the layout and by the page itself, and the pulse says restricted", async () => {
    const layout = src("app/app/layout.tsx");
    expect(layout.indexOf("closedForSuspended(path, u, side)")).toBeLessThan(layout.indexOf("db.notification.count"));
    for (const f of ["app/app/tests/[id]/edit/page.tsx", "app/app/tests/new/page.tsx"]) expect(src(f), f).toContain("requireOpenDevPage");
    // (Batch 15 section 29) The test page opens in its restricted view: decided first, by the page's own path.
    expect(src("app/app/tests/[id]/page.tsx")).toContain("const u = await requireOpenPage(`/app/tests/${id}`);");
    expect(src("components/SessionWatch.tsx")).toContain('window.location.replace("/app")');
    const { dev, testId } = await setup();
    await startHold(dev.user.id, "unpaid");
    expect((await json(await pulseGET(req(`/api/pulse?test=${testId}`, { cookie: dev.cookie })))).body.restricted).toBe(true);
    expect(src("components/AutoRefresh.tsx")).toContain("!restricted");
  });
});

describe("follow-up 5, 7, 8, 9, 10) cards, the mistakes line, End early, profile stops, drafts", () => {
  it("(undone by batch 6 item 2) an Open test's card shows Accepting testers or Full", () => {
    expect(src("app/app/page.tsx")).toContain("<StatusPill status={t.status} full={inIt.length >= t.spots} />");
  });

  it("'Fix the N mistakes above…' sits above the Save / Post button", () => {
    const form = src("app/app/tests/TestForm.tsx");
    // (Batch 16 section 10) The list reads the red fields themselves (MistakeList: "Fix the N mistakes above, then press … again.").
    expect(form.indexOf("<MistakeList press=")).toBeGreaterThan(0);
    expect(form.indexOf("<MistakeList press=")).toBeLessThan(form.indexOf('{busy ? "Saving…"'));
  });

  it("the End early pop-up counts held calls and every unreviewed part", () => {
    expect(src("app/app/tests/[id]/page.tsx")).toContain('"live call"');
    expect(src("app/app/tests/[id]/page.tsx")).toContain("waiting: [...c.submissions.filter((x) => !x.review && !payShut(x.id))"); // (batch 17 §19) a piece whose Pay closed doesn't wait
    expect(src("app/app/tests/[id]/TopPanel.tsx")).toContain("Nothing they&apos;ve sent or held is waiting for review.");
  });

  it("a tester changing their profile is not a 'Joins and applications' stop", async () => {
    expect(alertOf("profile")).toBeNull();
    expect(src("lib/server/invites.ts")).toContain('kind: "profile", text: `${name} no longer lists ${gone}.`'); // (batch 20 section 4)
  });

  it("a draft has no Next round and no End early", () => {
    const top = src("app/app/tests/[id]/TopPanel.tsx");
    expect(top).toContain('p.restricted || p.teamStopped || p.status === "draft" ? null');
    expect(top).toContain('p.status !== "draft" && !stopped && <button className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setOpen(open === "end"');
  });
});

describe("follow-up 6) one Save in another tab is one line in one voice, and 'Changes left' follows live", () => {
  it("'You changed the description and live call rate in another tab' (no second 'Nora Lane changed the description')", async () => {
    const { dev, testId } = await setup();
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    const loaded = seen();
    await new Promise((r) => setTimeout(r, 30));
    expect((await act(testId, "edit", dev.cookie, { version: v, tab: "tab-2", fields: { description: "Sail further", liveRateCents: "40.00" } })).status).toBe(200);
    // (Batch 16 section 21) A Save in another tab is about Edit only: Next round here isn't stopped by it (one line, one voice, in the log).
    const next = await act(testId, "next-round", dev.cookie, { seenAt: loaded, tab: "tab-1" });
    expect(next.body.error?.code).not.toBe("stop_once");
    const log = await db.actionLog.findFirstOrThrow({ where: { testId, tab: "tab-2" } });
    expect(log.text.split("\u001f")[0]).toBe("You changed the description and live call rate in another tab");
  });

  it("the listing the open Edit page polls carries the change count and whether anyone joined", async () => {
    const { dev, testId } = await setup();
    const { GET } = await import("@/app/api/tests/[id]/[action]/route");
    const read = async () => (await json(await GET(req(`/api/tests/${testId}/listing`, { cookie: dev.cookie }), { params: Promise.resolve({ id: testId, action: "listing" }) }))).body;
    expect(await read()).toMatchObject({ criticalCounts: { description: 0, ndaText: 0, questions: 0, languages: 0, devices: 0 }, everJoined: false });
    await joined(testId);
    await db.test.update({ where: { id: testId }, data: { criticalCounts: { ndaText: 2 } } });
    expect(await read()).toMatchObject({ criticalCounts: { ndaText: 2, devices: 0 }, everJoined: true });
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("setCritCounts(countsOf(r.criticalCounts))");
  });
});

describe("follow-up 4b) session-ending changes are hard moves", () => {
  it("SessionWatch replaces the location (deleted, signed out, switched account, restricted) and reloads an empty main; AutoRefresh does the same after a refresh", () => {
    const w = src("components/SessionWatch.tsx");
    for (const t of ['window.location.replace("/login?gone=1")', "window.location.replace(`/login?next=", "window.location.replace(landingOfNewSignIn())", 'window.location.replace("/app")', 'querySelector("main")?.children.length']) expect(w, t).toContain(t);
    expect(src("components/AutoRefresh.tsx")).toContain('querySelector("main")?.children.length');
  });
});
