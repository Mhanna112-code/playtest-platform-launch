import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as M from "@/lib/callMeasure";
import { CHARGED_BY_TESTER, decideDoneLine, decisionWhat } from "@/lib/rules";
import * as T from "@/lib/confirmAllText";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { POST as allPOST } from "@/app/api/payments/confirm-all/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { decideDispute } from "@/lib/server/payments";
import { logReview } from "@/lib/server/actionText";
import { adminPage, type MineVM } from "@/lib/server/adminLists";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 3, batch 35 §163) "The call can't connect."; one wording when a dispute decision equals what's paid now; the admin sees Decide's result (and keeps it
// in Your actions); Pay on an old page after the tester's Charge or Let it go is refused on the first press; Confirm all with nothing left is refused, never a stop.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
afterEach(() => setStripeForTests(null));

describe("§163 1: the call room says “The call can't connect.”", () => {
  const room = (o: Partial<Parameters<typeof M.roomStatusLine>[0]>) => M.roomStatusLine({ setup: "ready", connection: "new", otherHere: false, otherLeft: false, stuck: false, otherName: "Ana", ...o });

  it("the owner's wording, after 20 seconds together without connecting and when the connection fails; no strict-network or relay talk", () => {
    expect(M.CANT_CONNECT_LINE).toBe("The call can't connect.");
    expect(M.CANT_CONNECT_MS).toBe(20_000);
    // Chrome with no usable path stays "new" or "connecting": both in the room, 20 seconds on, the line shows.
    expect(room({ otherHere: true, connection: "new", stuck: true })).toBe("The call can't connect.");
    expect(room({ otherHere: true, connection: "connecting", stuck: true })).toBe("The call can't connect.");
    // "failed" shows it at once.
    expect(room({ otherHere: true, connection: "failed" })).toBe("The call can't connect.");
    // Connected later: the line goes.
    expect(room({ otherHere: true, connection: "connected", stuck: true })).toBe("Connected");
    // The old wording is gone from the room and its lines.
    for (const f of ["app/app/calls/[id]/CallRoom.tsx", "lib/callMeasure.ts"]) {
      const s = src(f).split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
      expect(s, f).not.toMatch(/strict network|Couldn't connect directly|STRICT_NETWORK_LINE/);
    }
  });

  it("“Waiting for Ana…” only while Ana really isn't in the room; in the room but not connected reads “Connecting…”", () => {
    expect(room({ otherHere: false })).toBe("Waiting for Ana…");
    expect(room({ otherHere: true, connection: "new" })).toBe("Connecting…");
    expect(room({ otherHere: true, connection: "connecting" })).toBe("Connecting…");
    expect(room({ setup: "camera" })).toBe("Starting your camera…");
    expect(room({ setup: "allow" })).toBe(M.ALLOW_MEDIA_LINE);
    expect(room({ otherHere: true, connection: "disconnected" })).toBe("Ana lost connection…");
    // Ana left (her Leave): said as before, never "The call can't connect." while she's gone.
    expect(room({ otherHere: true, otherLeft: true, connection: "failed" })).toBe("Ana left the call");
  });

  it("the 20-second timer runs only while both are in the room and this connection never connected; each fresh connection gets its own; connecting clears it", () => {
    const r = src("app/app/calls/[id]/CallRoom.tsx");
    expect(r).toContain("if (!otherHere || otherLeft || flowing) return;");
    expect(r).toContain("const t = setTimeout(() => setStuck(true), CANT_CONNECT_MS);");
    expect(r).toContain("return () => clearTimeout(t);");
    expect(r).toContain("}, [otherHere, otherLeft, flowing, attempt]);");
    // A fresh connection (the start, the other person coming back) starts over: not connected, not stuck, a new attempt.
    expect(r).toMatch(/pcRef\.current = next;\n\s+screenSender\.current = null;\n\s+setConnection\("new"\);\n\s+setFlowing\(false\);\n\s+setStuck\(false\);\n\s+setAttempt\(\(n\) => n \+ 1\);/);
    // Connected: the line goes.
    expect(r).toContain('if (s === "connected") {\n          setFlowing(true);\n          setStuck(false);');
    expect(r).toContain("const status = roomStatusLine({ setup, connection, otherHere, otherLeft, stuck, otherName });");
    expect(r).not.toContain("setStatus(");
  });

  it("the other tile says “Connecting…” until media flows (connected), not just because ontrack fired", () => {
    const r = src("app/app/calls/[id]/CallRoom.tsx");
    expect(r).toContain("{!(otherVideo && flowing && (otherCam || otherSharing)) && <NoVideo");
    expect(r).toContain('!otherHere ? "Not here yet" : !linked ? "Connecting…"');
    // Leave and Rejoin are as before.
    expect(r).toContain("onLeft(typeof r?.measured === \"number\" ? r.measured : measured);");
    expect(r).toContain("Rejoin");
  });
});

/** Every charge's amount (a Stripe stand-in, as batch35-decide-paid-above's). */
function stripe() {
  const made: number[] = [];
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number }) => {
        made.push(p.amount);
        return { id: "pi_" + randomUUID(), status: "succeeded" };
      },
      retrieve: async (id: string) => ({ id, status: "requires_action" }),
      cancel: async (id: string) => ({ id, status: "canceled" }),
    },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
  } as unknown as Stripe);
  return made;
}
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const decidedLine = async (testId: string) => (await db.testEvent.findFirst({ where: { testId, kind: "admin" } }))?.text ?? null;

/** Ana's written answers paid $4.00 and disputed; an admin (with a cookie for the route); the developer's card saved. */
async function disputed() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful" })).status).toBe(200);
  expect((await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true })).status).toBe(200);
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  const admin = await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  const row = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
  await settle();
  return { ...s, ...j, sub, admin, adminCookie: a.cookie, row };
}
/** The admin's page loads, then the developer's Pay more of `moreCents` goes through. */
async function payMoreAfterLoad(moreCents: number) {
  const w = await disputed();
  const made = stripe();
  const loaded = seen();
  await settle();
  const m = await act(w.testId, "pay-extra", w.dev.cookie, { seenAt: seen(), contractId: w.sessionId, submissionId: w.sub.id, amount: (moreCents / 100).toFixed(2), tickedCents: moreCents, payKey: randomUUID() });
  expect(m.status).toBe(200);
  made.length = 0;
  return { ...w, made, loaded };
}
const decideRoute = (cookie: string, body: Record<string, unknown>) => adminPOST(req("/api/admin/decide", { cookie, body: { note: "", ...body } }), { params: Promise.resolve({ action: "decide" }) }).then(json);
/** The admin's Your actions line for this dispute, as the console shows it after its reload. */
async function yourAction(adminId: string, disputeId: string) {
  const rows = (await adminPage("mine", adminId, null)).rows as MineVM[];
  return rows.find((r) => r.id === `dispute-${disputeId}`) ?? null;
}

describe("§163 2: one wording when the decision equals what's paid now", () => {
  it("the line itself: raised with a charge (unchanged), kept at what's paid, a rejected piece; the admin's charged / not charged yet", () => {
    expect(decisionWhat({ paidNowCents: 700, dueCents: 300, decidedCents: 1000, rejected: false })).toBe("raised the pay to $10.00 ($3.00 more)");
    expect(decisionWhat({ paidNowCents: 1200, dueCents: 0, decidedCents: 1200, rejected: false })).toBe("kept the pay at $12.00, which was already paid: nothing more was charged");
    expect(decisionWhat({ paidNowCents: 0, dueCents: 0, decidedCents: 0, rejected: true })).toBe("kept the pay at $0.00 (rejected)");
    expect(decideDoneLine(decisionWhat({ paidNowCents: 700, dueCents: 300, decidedCents: 1000, rejected: false }, true))).toBe("Done: raised the pay to $10.00 ($3.00 more charged).");
    expect(decideDoneLine(decisionWhat({ paidNowCents: 700, dueCents: 300, decidedCents: 1000, rejected: false }, false))).toBe("Done: raised the pay to $10.00 ($3.00 more, not charged yet).");
    expect(decideDoneLine(decisionWhat({ paidNowCents: 1200, dueCents: 0, decidedCents: 1200, rejected: false }, true))).toBe("Done: kept the pay at $12.00, which was already paid: nothing more was charged.");
  });

  it("after a Pay more reached the decision ($10.00): “kept the pay at $10.00, which was already paid: nothing more was charged” on the test page and for the admin", async () => {
    const w = await payMoreAfterLoad(600);
    expect(await decideDispute(w.admin, w.row.id, { total: "10.00", tickCents: 600, seenAt: w.loaded })).toEqual({ extraCents: 0, line: "Done: kept the pay at $10.00, which was already paid: nothing more was charged." });
    expect(w.made).toEqual([]);
    expect(await decidedLine(w.testId)).toBe("The team decided Ana Silva's dispute: kept the pay at $10.00, which was already paid: nothing more was charged");
    expect((await yourAction(w.admin.id, w.row.id))?.why).toBe("dispute decided by you: kept the pay at $10.00, which was already paid: nothing more was charged");
  });

  it("deciding $12.00 after the “paid more than your decision” stop: the same wording (it read “kept the pay at $12.00”)", async () => {
    const w = await payMoreAfterLoad(800);
    const r1 = await decideRoute(w.adminCookie, { id: w.row.id, total: "10.00", tickCents: 600, seenAt: w.loaded });
    expect(r1.body.error.code).toBe("stop_once");
    const r2 = await decideRoute(w.adminCookie, { id: w.row.id, total: "12.00", seenAt: r1.body.error.seenAt, confirmed: true });
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual({ extraCents: 0, line: "Done: kept the pay at $12.00, which was already paid: nothing more was charged." });
    expect(w.made).toEqual([]);
    expect(await decidedLine(w.testId)).toBe("The team decided Ana Silva's dispute: kept the pay at $12.00, which was already paid: nothing more was charged");
    // The developer's next Pay more stops once naming it in the same words.
    const m = await act(w.testId, "pay-extra", w.dev.cookie, { seenAt: w.loaded, contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100, payKey: randomUUID() });
    expect(m.body.error.changes.map((c: { text: string }) => c.text)).toContain("The team decided Ana Silva's dispute: kept the pay at $12.00, which was already paid: nothing more was charged");
  });

  it("keeping the pay with a blank box reads the same; a raise that charges is unchanged", async () => {
    const k = await disputed();
    stripe();
    expect(await decideDispute(k.admin, k.row.id, { total: "" })).toEqual({ extraCents: 0, line: "Done: kept the pay at $4.00, which was already paid: nothing more was charged." });
    expect(await decidedLine(k.testId)).toBe("The team decided Ana Silva's dispute: kept the pay at $4.00, which was already paid: nothing more was charged");
    const w = await payMoreAfterLoad(300);
    expect(await decideDispute(w.admin, w.row.id, { total: "10.00", tickCents: 600, seenAt: w.loaded })).toEqual({ extraCents: 300, line: "Done: raised the pay to $10.00 ($3.00 more charged)." });
    expect(await decidedLine(w.testId)).toBe("The team decided Ana Silva's dispute: raised the pay to $10.00 ($3.00 more)");
  });
});

describe("§163 3: the admin sees the result, and keeps it after the row leaves the list", () => {
  it("Decide through the admin route answers the result line; after the reload the row has left Open disputes and Your actions has the same result", async () => {
    const w = await payMoreAfterLoad(300);
    const r = await decideRoute(w.adminCookie, { id: w.row.id, total: "10.00", tickCents: 600, seenAt: w.loaded });
    expect(r.status).toBe(200);
    expect(r.body.line).toBe("Done: raised the pay to $10.00 ($3.00 more charged).");
    expect(w.made).toEqual([300]);
    // The console loads again: the dispute isn't in Open disputes any more…
    const open = (await adminPage("disputes", w.admin.id, null)).rows as { id: string }[];
    expect(open.some((d) => d.id === w.row.id)).toBe(false);
    // …and Your actions keeps what it did, opening the dispute's row.
    const mine = await yourAction(w.admin.id, w.row.id);
    expect(mine).toMatchObject({ why: "dispute decided by you: raised the pay to $10.00 ($3.00 more charged)", href: `/admin?dispute=${w.row.id}#dispute-${w.row.id}`, testId: w.testId });
    expect(JSON.stringify(mine!.parts)).toContain("Ana Silva");
    // Only the admin who decided it.
    const other = await makeUser();
    expect(await yourAction(other.user.id, w.row.id)).toBeNull();
  });

  it("the decision box shows the server's line (not a client guess) in place of “Done.”", () => {
    const d = src("app/admin/DisputeDecision.tsx");
    expect(d).toContain('const r = await api<{ line?: string }>("/api/admin/decide"');
    expect(d).toContain('fin.finish(typeof r?.line === "string" && r.line ? r.line : "Done.", { reload: true });');
    expect(src("app/admin/page.tsx")).toContain("and disputes you decided (with what the decision did)");
  });
});

const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } })).then((r) => r.json());
/** Written answers whose Charge / Let it go is open (the review days and the tester's deadline passed). */
async function choiceOpen() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
  await db.test.update({ where: { id: s.testId }, data: { openUntil: new Date(Date.now() - 1000) } });
  await db.contract.updateMany({ where: { testId: s.testId }, data: { dueAt: new Date(Date.now() - 1000) } });
  await cron();
  await settle();
  return { ...s, ...j, sub };
}

describe("§163 4: Pay on an old page after the tester's Charge or Let it go is refused on the FIRST press", () => {
  it("Charge: the first press is the refusal, never a stop-once box", async () => {
    const w = await choiceOpen();
    const loaded = seen(); // the developer's page, opened before the Charge
    await settle();
    expect((await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.sub.id, choice: "charge" })).status).toBe(200);
    // The developer's Alerts let the Charge line through (the default): before, this press stopped once and only its second press was refused.
    expect((await db.testEvent.count({ where: { testId: w.testId, createdAt: { gt: new Date(loaded) } } }))).toBeGreaterThan(0);
    const first = await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, confirmed: false });
    expect(first.status).toBe(409);
    expect(first.body.error).toMatchObject({ code: "reviewed", message: "Ana Silva already charged $10.00 for her written answers." });
  });

  it("Let it go: the first press is the refusal", async () => {
    const w = await choiceOpen();
    const loaded = seen();
    await settle();
    expect((await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.sub.id, choice: "letgo" })).status).toBe(200);
    const first = await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, confirmed: false });
    expect(first.status).toBe(409);
    expect(first.body.error).toMatchObject({ code: "reviewed", message: "Ana Silva let her written answers go: nothing was charged." });
  });

  it("(owner, Nov 4: replaces the stop first) the developer's own Pay in another tab: the old tab's Pay is refused at once, naming the tab", async () => {
    const w = await choiceOpen();
    const loaded = seen();
    await settle();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000, tab: "tabA" })).status).toBe(200);
    const first = await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, confirmed: false, tab: "tabB" });
    expect([first.body.error.code, first.body.error.message]).toEqual(["reviewed", expect.stringMatching(/^You already paid \$10\.00 for Ana Silva's written answers in another tab at \d{1,2}:\d{2} [AP]M\.$/)]);
  });

  it("Confirm all on a page whose payments are no longer waiting: refused at once, never a stop whose second press is refused", async () => {
    const s = await setup();
    const r = await allPOST(req("/api/payments/confirm-all", { cookie: s.dev.cookie, body: { seenTotalCents: 1000, seenIds: [randomUUID()] } })).then(json);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "nothing", message: T.NOTHING_TO_CONFIRM });
  });
});

// ---------- §163 5: a Confirm with your bank / Confirm all in another tab is one of the developer's own other-tab lines ----------

const DAY = 86_400_000;
/** A charge made while the developer was away, waiting for "Confirm with your bank" (as batch 23's awayCharge). */
const away = (x: { kind: string; contractId: string; developerId: string; testerId: string; submissionId?: string; callId?: string; amountCents?: number }) =>
  db.payment.create({ data: { kind: x.kind, submissionId: x.submissionId ?? null, callId: x.callId ?? null, contractId: x.contractId, developerId: x.developerId, testerId: x.testerId, amountCents: x.amountCents ?? 1000, feeCents: 0, testerCents: 0, status: "needs_confirmation", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 3 * DAY) } });
const confirmIn = (cookie: string, tab: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, body: { tab, ...body } })).then(json);

/** Ana (a Charge and a call charge waiting), Ben (a Charge waiting: tab A's open bank box) and Cara (written answers still to pay), on one test. */
async function awayWorld() {
  const s = await setup();
  const person = async (n: string, pronoun: string) => {
    const j = await joined(s.testId, n, pronoun);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    return { ...j, sub: await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } }) };
  };
  const ana = await person("Ana Silva", "she"), ben = await person("Ben Okafor", "he"), cara = await person("Cara Diaz", "she");
  const base = (p: typeof ana) => ({ contractId: p.sessionId, developerId: s.dev.user.id, testerId: p.tester.user.id });
  const anaWork = await away({ kind: "review", submissionId: ana.sub.id, ...base(ana) });
  const call = await bookCall(s.testId, s.dev.cookie, ana.sessionId, ana.tester.cookie);
  await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 2 * 3_600_000) } });
  const anaCall = await away({ kind: "call", callId: call.id, amountCents: 3000, ...base(ana) });
  const box = await away({ kind: "review", submissionId: ben.sub.id, ...base(ben) });
  await settle();
  return { ...s, ana, ben, cara, anaWork, anaCall, box };
}
const WORK_LINE = "You confirmed Ana Silva's $10.00 charge for her written answers with your bank in another tab";
const CALL_LINE = "You confirmed Ana Silva's $30.00 charge for her live call with your bank in another tab";
/** What tab A's (or B's) open bank box on Ben's charge says (§160's peek), since the box opened. */
const notice = async (w: Awaited<ReturnType<typeof awayWorld>>, tab: string, since: string) => ((await confirmIn(w.dev.cookie, tab, { paymentId: w.box.id, peek: true, since })).body.changes ?? []) as string[];

describe("§163 5: a Confirm in another tab is one of the developer's own other-tab lines", () => {
  it("a Confirm of a Charge on written answers in tab B: tab A's open bank box says it, and tab A's next Pay stops once with it; tab B never shows it", async () => {
    const w = await awayWorld();
    const opened = seen(); // tab A's bank box (Ben's charge) opened, and its page loaded
    await settle();
    expect((await confirmIn(w.dev.cookie, "tab-B", { paymentId: w.anaWork.id, simulate: "succeeded" })).status).toBe(200);
    expect(await notice(w, "tab-A", opened)).toEqual([WORK_LINE]); // one line for the one Confirm (no second "Payment went through")
    expect(await notice(w, "tab-B", opened)).toEqual([]);
    const p = await pay(w.dev.cookie, { kind: "submission", id: w.cara.sub.id, amount: "10.00", tickedCents: 1000, seenAt: opened, confirmed: false, tab: "tab-A" });
    expect(p.body.error.code).toBe("stop_once");
    expect(p.body.error.changes.map((c: { text: string }) => c.text)).toEqual([WORK_LINE]);
    // Exactly one line for the one Confirm.
    expect(await db.actionLog.count({ where: { userId: w.dev.user.id, text: { startsWith: "confirmed Ana Silva's $10.00 charge" } } })).toBe(1);
    // The tab that pressed: its Pay goes through with nothing to stop for.
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.cara.sub.id, amount: "10.00", tickedCents: 1000, seenAt: opened, confirmed: false, tab: "tab-B" })).status).toBe(200);
  });

  it("the same for a call's charge (calls weren't logged at all before)", async () => {
    const w = await awayWorld();
    const opened = seen();
    await settle();
    expect((await confirmIn(w.dev.cookie, "tab-B", { paymentId: w.anaCall.id, simulate: "succeeded" })).status).toBe(200);
    expect(await notice(w, "tab-A", opened)).toEqual([CALL_LINE]);
    expect(await notice(w, "tab-B", opened)).toEqual([]);
    const p = await pay(w.dev.cookie, { kind: "submission", id: w.cara.sub.id, amount: "10.00", tickedCents: 1000, seenAt: opened, confirmed: false, tab: "tab-A" });
    expect(p.body.error.changes.map((c: { text: string }) => c.text)).toEqual([CALL_LINE]);
  });

  it("a Confirm all in tab B: tab A's open bank box names each item once; tab B's never", async () => {
    const w = await awayWorld();
    // Ben's charge is tab A's open box (its own press's check): Confirm all covers only Ana's two.
    await db.payment.update({ where: { id: w.box.id }, data: { status: "needs_action" } });
    const opened = seen();
    await settle();
    const r = await allPOST(req("/api/payments/confirm-all", { cookie: w.dev.cookie, body: { tab: "tab-B", seenTotalCents: 4000, seenIds: [w.anaWork.id, w.anaCall.id] } })).then(json);
    expect(r.status).toBe(200);
    const oneId = (await db.payment.findUniqueOrThrow({ where: { id: w.anaWork.id } })).coveredById;
    // Its one bank check finishes through the confirm route when it asked the bank; otherwise it went through at once.
    if (r.body.confirm && oneId) expect((await confirmIn(w.dev.cookie, "tab-B", { paymentId: oneId, simulate: "succeeded" })).status).toBe(200);
    const a = await notice(w, "tab-A", opened);
    expect(a.filter((l) => l === WORK_LINE)).toHaveLength(1);
    expect(a.filter((l) => l === CALL_LINE)).toHaveLength(1);
    const b = await notice(w, "tab-B", opened);
    expect(b).not.toContain(WORK_LINE);
    expect(b).not.toContain(CALL_LINE);
    expect(await db.actionLog.count({ where: { userId: w.dev.user.id, text: { startsWith: "confirmed Ana Silva's" } } })).toBe(2);
  });

  it("the other kinds' wording: a team decision, a Pay more, a retried chargeback", async () => {
    const w = await awayWorld();
    const base = { contractId: w.ana.sessionId, developerId: w.dev.user.id, testerId: w.ana.tester.user.id, submissionId: w.ana.sub.id };
    const lines: string[] = [];
    for (const kind of ["dispute", "extra", "chargeback"]) {
      const p = await away({ kind, amountCents: 600, ...base });
      const opened = seen();
      await settle();
      expect((await confirmIn(w.dev.cookie, "tab-B", { paymentId: p.id, simulate: "succeeded" })).status).toBe(200);
      lines.push(...(await notice(w, "tab-A", opened)));
    }
    expect(lines).toEqual([
      "You confirmed the team's $6.00 dispute decision on Ana Silva's written answers with your bank in another tab",
      "You confirmed your $6.00 Pay more for Ana Silva's written answers with your bank in another tab",
      "You confirmed your $6.00 payment again for Ana Silva's written answers with your bank in another tab",
    ]);
  });
});

// ---------- §163 6 (owner, Nov 4): the developer's own press in another tab that settled the SAME thing is ONE refusal; anything still possible stops once ----------

const AT = "\\d{1,2}:\\d{2} [AP]M";
const line = (s: string) => new RegExp(`^${s.replace(/[$.()]/g, (c) => `\\${c}`).replace("<at>", AT)}$`);
const changesOf = (r: { body: { error?: { changes?: { text: string }[] } } }) => (r.body.error?.changes ?? []).map((c) => c.text);
/** A saved card for the developer (Pay more needs one). */
const withCard = (id: string) => db.user.update({ where: { id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });

describe("§163 6: own other-tab presses on the same thing are refused at once", () => {
  it("Pay in tab B, then Pay in old tab A on the same part: refused on the FIRST press, naming the tab and the time", async () => {
    const w = await awayWorld();
    const loaded = seen();
    await settle();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.cara.sub.id, amount: "10.00", tickedCents: 1000, tab: "tab-B" })).status).toBe(200);
    const a = await pay(w.dev.cookie, { kind: "submission", id: w.cara.sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, confirmed: false, tab: "tab-A" });
    expect([a.status, a.body.error?.code]).toEqual([409, "reviewed"]);
    expect(a.body.error.message).toMatch(line("You already paid $10.00 for Cara Diaz's written answers in another tab at <at>."));
    // The same tab: the plain refusal.
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.cara.sub.id, amount: "10.00", tickedCents: 1000, tab: "tab-B" })).body.error.message).toBe("You already paid $10.00 for Cara Diaz's written answers.");
  });

  it("the same for a reject made in another tab", async () => {
    const w = await awayWorld();
    const loaded = seen();
    await settle();
    await db.review.create({ data: { contractId: w.cara.sessionId, submissionId: w.cara.sub.id, amountCents: 0, rejected: true, reason: "Not what was asked", payKey: randomUUID() } });
    await logReview(w.dev.user.id, { tab: "tab-B", kind: "submission", id: w.cara.sub.id }, { rejected: true });
    const a = await pay(w.dev.cookie, { kind: "submission", id: w.cara.sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, confirmed: false, tab: "tab-A" });
    expect(a.body.error.message).toMatch(line("You already rejected Cara Diaz's written answers in another tab at <at>."));
  });

  it("Pay in tab B, then Pay more in tab A on that part: stops once, then goes ahead; past what's left it's refused on the first press", async () => {
    const w = await awayWorld();
    await withCard(w.dev.user.id);
    stripe();
    const loaded = seen();
    await settle();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.cara.sub.id, amount: "10.00", tickedCents: 1000, tab: "tab-B" })).status).toBe(200);
    const more = (body: Record<string, unknown>) => act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.cara.sessionId, submissionId: w.cara.sub.id, payKey: randomUUID(), tab: "tab-A", seenAt: loaded, ...body });
    // Past what's left before the most (the part's max): refused at once, never after a stop.
    const over = await more({ amount: "5000.00", tickedCents: 500_000, over200: true });
    expect([over.status, over.body.error?.code]).toEqual([400, "over_cap"]);
    const first = await more({ amount: "2.00", tickedCents: 200 });
    expect(first.body.error?.code).toBe("stop_once");
    expect(changesOf(first)).toEqual(["You paid Cara Diaz $10.00 for the written answers in another tab"]);
    expect((await more({ amount: "2.00", tickedCents: 200, confirmed: true, boxAt: seen() })).status).toBe(200);
  });

  it("Pay in tab B, then Pay in tab A on a DIFFERENT part: stops once, then goes ahead", async () => {
    const w = await awayWorld();
    await db.payment.delete({ where: { id: w.box.id } }); // Ben's part is unpaid, with nothing waiting on it
    const loaded = seen();
    await settle();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.cara.sub.id, amount: "10.00", tickedCents: 1000, tab: "tab-B" })).status).toBe(200);
    const first = await pay(w.dev.cookie, { kind: "submission", id: w.ben.sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, confirmed: false, tab: "tab-A" });
    expect(first.body.error?.code).toBe("stop_once");
    expect(changesOf(first)).toEqual(["You paid Cara Diaz $10.00 for the written answers in another tab"]);
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.ben.sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, confirmed: true, boxAt: seen(), tab: "tab-A" })).status).toBe(200);
  });

  it("Confirm with your bank in tab B: tab A's Confirm on that charge, and its Pay on that part, are each ONE refusal; its Pay more stops once", async () => {
    const w = await awayWorld();
    await withCard(w.dev.user.id);
    // Ana's Charge, as a real one makes it: her review, and its payment waiting for the bank.
    await db.review.create({ data: { contractId: w.ana.sessionId, submissionId: w.ana.sub.id, amountCents: 1000, reason: CHARGED_BY_TESTER, payKey: randomUUID() } });
    const loaded = seen();
    await settle();
    expect((await confirmIn(w.dev.cookie, "tab-B", { paymentId: w.anaWork.id, simulate: "succeeded" })).status).toBe(200);
    const again = await confirmIn(w.dev.cookie, "tab-A", { paymentId: w.anaWork.id, start: true, seenAt: loaded });
    expect([again.status, again.body.error?.code]).toEqual([409, "confirmed"]);
    expect(again.body.error.message).toMatch(line("You already confirmed this payment in another tab at <at>."));
    // The same tab: the plain line, as before.
    expect((await confirmIn(w.dev.cookie, "tab-B", { paymentId: w.anaWork.id, start: true })).body.error.message).toBe("You already confirmed this payment.");
    const p = await pay(w.dev.cookie, { kind: "submission", id: w.ana.sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, confirmed: false, tab: "tab-A" });
    expect(p.body.error.message).toMatch(line("You already confirmed Ana Silva's $10.00 charge for her written answers with your bank in another tab at <at>."));
    const more = (body: Record<string, unknown>) => act(w.testId, "pay-extra", w.dev.cookie, { contractId: w.ana.sessionId, submissionId: w.ana.sub.id, payKey: randomUUID(), tab: "tab-A", seenAt: loaded, amount: "2.00", tickedCents: 200, ...body });
    const first = await more({});
    expect(first.body.error?.code).toBe("stop_once");
    expect(changesOf(first)).toEqual([WORK_LINE]);
    expect((await more({ confirmed: true, boxAt: seen() })).status).toBe(200);
  });

  it("Confirm all in old tab A covering a charge tab B confirmed: stops once naming it, the total drops, the second press pays the rest; all of them confirmed: ONE refusal", async () => {
    const w = await awayWorld();
    await db.payment.delete({ where: { id: w.box.id } }); // only Ana's two
    await settle();
    expect((await confirmIn(w.dev.cookie, "tab-B", { paymentId: w.anaWork.id, simulate: "succeeded" })).status).toBe(200);
    const all = (cookie: string, body: Record<string, unknown>) => allPOST(req("/api/payments/confirm-all", { cookie, body: { tab: "tab-A", ...body } })).then(json);
    const first = await all(w.dev.cookie, { seenTotalCents: 4000, seenIds: [w.anaWork.id, w.anaCall.id] });
    expect(first.body.error?.code).toBe("stop_once");
    expect(changesOf(first)).toEqual([WORK_LINE, "Confirm all now covers 1 payment: $30.00."]);
    expect(first.body.error.totalCents).toBe(3000);
    expect((await all(w.dev.cookie, { seenTotalCents: 3000, seenIds: first.body.error.ids, confirmed: true })).status).toBe(200);
    // Everything it covered was confirmed in another tab.
    const v = await awayWorld();
    await db.payment.delete({ where: { id: v.box.id } });
    await settle();
    for (const id of [v.anaWork.id, v.anaCall.id]) expect((await confirmIn(v.dev.cookie, "tab-B", { paymentId: id, simulate: "succeeded" })).status).toBe(200);
    const r = await all(v.dev.cookie, { seenTotalCents: 4000, seenIds: [v.anaWork.id, v.anaCall.id] });
    expect([r.status, r.body.error?.code]).toEqual([409, "nothing"]);
    expect(r.body.error.message).toMatch(line("You already confirmed these payments in another tab at <at>."));
  });

  it("the call room holds the page's ICE servers in a ref: a redraw of the page never hangs up the call", () => {
    const r = src("app/app/calls/[id]/CallRoom.tsx");
    expect(r).toContain("const pageIce = useRef(iceServers);");
    expect(r).toContain("let ice = pageIce.current;");
    // The room's effect re-runs only for a new call, side, name or relay mode: never for a new array of the same servers.
    expect(r).toContain("}, [callId, role, otherName, relayOnly]);");
    expect(r).not.toContain("otherName, iceServers, relayOnly]");
  });
});
