import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { confirmByText } from "@/lib/bankTop";
import { awayAction, bankToConfirm, bankWaitingOnTest, confirmItems } from "@/lib/server/confirm";
import { retryOwed, startHold } from "@/lib/server/holds";
import { sendSummaries } from "@/lib/server/notify";
import { setStripeForTests } from "@/lib/server/stripe";
import { approveChargebackHold, approvedLiftedLine } from "@/lib/server/chargeback";
import { namesList, owedReceiptWhat, retriedLine } from "@/lib/rules";
import { json, req } from "./helpers";
import { bookCall, joined, sact, settle, setup } from "./fixtures";
import { withCard } from "./b15";

// Batch 25 (Oct 29): bank-confirmation leftovers. "Confirm by" in the developer's own time zone (1), one wording for a retried chargeback (2), the renewal's bell line
// opens its row (3), /api/pulse's bank=1 only for a developer (4), and one bell line for an automatic retry of what's owed (5).
const DAY = 86_400_000, MIN = 60_000;
// UTC+14 all year (no daylight saving): far from any server clock, and its midnight is 10:00 UTC.
const FAR = "Pacific/Kiritimati";

afterEach(() => setStripeForTests(null));

function fakeStripe(mode: "ok" | "away-action" = "ok") {
  setStripeForTests({
    paymentIntents: {
      create: async (p: { off_session?: boolean; capture_method?: string }) => {
        const id = "pi_" + randomUUID();
        if (mode === "away-action" && p.off_session) throw Object.assign(new Error("Authentication required."), { code: "authentication_required", raw: { payment_intent: { id, client_secret: `${id}_secret` } } });
        return { id, status: p.capture_method === "manual" ? "requires_capture" : "succeeded" };
      },
      capture: async (id: string) => ({ id, status: "succeeded" }),
      retrieve: async (id: string) => ({ id, status: "succeeded", client_secret: `${id}_secret` }),
      cancel: async (id: string) => ({ id, status: "canceled" }),
    },
  } as unknown as Stripe);
}

/** A developer with Ana Silva in "Harbor Run" and her written answers sent. */
async function withWork() {
  const { dev, testId } = await setup();
  const { tester, sessionId } = await joined(testId);
  await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
  return { dev, testId, tester, sessionId, sub };
}
type Over = Partial<{ kind: string; status: string; submissionId: string | null; callId: string | null; repaysId: string | null; amountCents: number; by: Date }>;
const waiting = (x: Awaited<ReturnType<typeof withWork>>, o: Over) =>
  db.payment.create({
    data: {
      kind: o.kind ?? "review", submissionId: o.submissionId ?? null, callId: o.callId ?? null, repaysId: o.repaysId ?? null, contractId: x.sessionId, developerId: x.dev.user.id, testerId: x.tester.user.id,
      amountCents: o.amountCents ?? 1250, feeCents: 0, testerCents: 0, status: o.status ?? "needs_confirmation", actionPi: "pi_" + randomUUID(), actionBy: o.by ?? new Date(Date.now() + 2 * DAY),
    },
  });
/** The next 10:10 UTC at least 2 hours away: 12:10 AM in Kiritimati, just past its midnight. */
function pastFarMidnight() {
  const d = new Date();
  d.setUTCHours(10, 10, 0, 0);
  while (d.getTime() < Date.now() + 2 * 3_600_000) d.setTime(d.getTime() + DAY);
  return d;
}

describe("batch 25 section 1: confirm-by times in the developer's own time zone", () => {
  it("near midnight, a developer far from the server's clock sees their own day and time, and the red check is theirs", async () => {
    const x = await withWork();
    await db.user.update({ where: { id: x.dev.user.id }, data: { timeZone: FAR } });
    const by = pastFarMidnight();
    const now = new Date(by.getTime() - 40 * MIN); // 11:30 PM there: the deadline is tomorrow, in 40 minutes
    const p = await waiting(x, { submissionId: x.sub.id, by });
    const rows = await bankToConfirm(x.dev.user.id, now);
    expect(rows.find((r) => r.id === p.id)).toMatchObject({ by: "confirm by tomorrow, 12:10 AM", soon: true });
    // The same moment for a developer in UTC (the server's clock on a host): "today, 10:10 AM".
    expect(confirmByText(by, now, "UTC")).toEqual({ text: "confirm by today, 10:10 AM", soon: true });
    // More than 24 hours away: the day, in their zone.
    const later = new Date(by.getTime() + 3 * DAY);
    const q = await waiting(x, { submissionId: x.sub.id, by: later });
    const day = later.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: FAR });
    expect((await bankToConfirm(x.dev.user.id, now)).find((r) => r.id === q.id)).toMatchObject({ by: `confirm by ${day}, 12:10 AM`, soon: false });
  });

  it("the test page's Confirm it by and Payments' list use the developer's zone too", async () => {
    const x = await withWork();
    await db.user.update({ where: { id: x.dev.user.id }, data: { timeZone: FAR } });
    const by = new Date("2030-01-01T10:10:00Z"); // Tue 10:10 AM in UTC; Wed, Jan 2, 12:10 AM in Kiritimati
    const p = await waiting(x, { submissionId: x.sub.id, by });
    const onTest = (await bankWaitingOnTest(x.dev.user.id, x.testId)).find((r) => r.id === p.id)!;
    expect(onTest.line).toBe("Your bank wants you to confirm a $12.50 payment for Ana Silva's written answers, made while you were away. Confirm it by Wed, Jan 2, 12:10 AM.");
    const item = (await confirmItems(x.dev.user.id)).find((i) => i.id === p.id)!;
    expect(item.text).toBe("A payment $12.50 on “Harbor Run” · confirm by Wed, Jan 2, 12:10 AM");
  });
});

describe("batch 25 section 2: a retried chargeback reads the same on the dashboard as on the test page", () => {
  it("“a payment your bank had reversed (<piece>)”; an automatic retry of what's owed keeps “what you owe”", async () => {
    const x = await withWork();
    const reversed = await db.payment.create({ data: { kind: "review", submissionId: x.sub.id, contractId: x.sessionId, developerId: x.dev.user.id, testerId: x.tester.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "charged", chargeback: "open" } });
    // The repay row (made by a retry) carries no piece itself: it names the reversed payment's piece.
    const repay = await waiting(x, { kind: "chargeback", repaysId: reversed.id, amountCents: 2500 });
    const owedRetry = await waiting(x, { status: "failed", submissionId: x.sub.id, amountCents: 1000 });
    const rows = await bankToConfirm(x.dev.user.id);
    expect(rows.find((r) => r.id === repay.id)!.lead).toBe("$25.00 on “Harbor Run” · a payment your bank had reversed (Ana Silva's written answers)");
    expect(rows.find((r) => r.id === owedRetry.id)!.lead).toBe("$10.00 on “Harbor Run” · what you owe");
    const onTest = (await bankWaitingOnTest(x.dev.user.id, x.testId)).find((r) => r.id === repay.id)!;
    expect(onTest.line).toContain("for a payment your bank had reversed (Ana Silva's written answers), made while you were away.");
    expect(onTest.pieceId).toBe(x.sub.id);
  });
});

describe("batch 25 section 3: the renewal's bell line opens its own row", () => {
  it("(batch 29 §32) the bell line opens the dashboard's box; the box's row links to #bank-<id> on Payments (marked)", async () => {
    const x = await withWork();
    const sub = await db.payment.create({ data: { kind: "subscription", developerId: x.dev.user.id, testerId: x.dev.user.id, amountCents: 700, feeCents: 700, testerCents: 0, status: "needs_confirmation" } });
    await awayAction(sub.id, { status: "requires_action", stripePaymentIntentId: "pi_" + randomUUID(), clientSecret: "" });
    const n = await db.notification.findFirstOrThrow({ where: { userId: x.dev.user.id, text: { startsWith: "Your bank wants you to confirm a $7.00 payment by " } } });
    expect(n.link).toBe("/app#bank-to-confirm");
    expect((await bankToConfirm(x.dev.user.id)).find((r) => r.id === sub.id)!.href).toBe(`/app/payments#bank-${sub.id}`);
  });
});

describe("batch 25 section 4: /api/pulse?bank=1 answers only for a developer", () => {
  it("a developer gets the box's fingerprint; anyone else the plain pulse", async () => {
    const x = await withWork();
    await waiting(x, { submissionId: x.sub.id });
    const dev = await pulseGET(req("/api/pulse?bank=1", { cookie: x.dev.cookie, method: "GET" })).then(json);
    expect(dev.status).toBe(200);
    expect(dev.body.v).toContain(":");
    // The tester: the plain pulse, which needs a test or a session (no box for them).
    const t = await pulseGET(req("/api/pulse?bank=1", { cookie: x.tester.cookie, method: "GET" })).then(json);
    expect(t.status).toBe(404);
    const plain = await pulseGET(req(`/api/pulse?bank=1&session=${x.sessionId}`, { cookie: x.tester.cookie, method: "GET" })).then(json);
    const session = await pulseGET(req(`/api/pulse?session=${x.sessionId}`, { cookie: x.tester.cookie, method: "GET" })).then(json);
    expect(plain.body.v).toBe(session.body.v);
  });
});

describe("batch 25 section 5: one bell line for an automatic retry", () => {
  it("the names: one, several, more than 3", () => {
    expect(namesList(["A"])).toBe("A");
    expect(namesList(["A", "B"])).toBe("A and B");
    expect(namesList(["A", "B", "C"])).toBe("A, B and C");
    expect(namesList(["A", "B", "C", "D", "E"])).toBe("A, B, C and 2 more");
    expect(retriedLine(1000, ["Ana Silva's call on Oct 30"])).toBe("We charged your card $10.00 for what you owed: Ana Silva's call on Oct 30.");
    expect(owedReceiptWhat(["Ana Silva's call on Oct 30"])).toBe("what you owed: Ana Silva's call on Oct 30");
  });

  /** Ana Silva's call (a held call) and, with `ben`, Ben Okafor's written answers, each a declined payment, on a payment hold with a saved card. */
  async function held(ben = false) {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie);
    await withCard(dev.user.id);
    const rows = [await db.payment.create({ data: { kind: "call", callId: call.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } })];
    if (ben) {
      const b = await joined(testId, "Ben Okafor", "he");
      await sact(b.sessionId, "written", b.tester.cookie, { answers: ["a", "b"] });
      await settle();
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: b.sessionId } });
      rows.push(await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: b.sessionId, developerId: dev.user.id, testerId: b.tester.user.id, amountCents: 800, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } }));
    }
    await startHold(dev.user.id, "unpaid");
    const day = call.startsAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return { dev, rows, day };
  }
  const moneyLines = (userId: string, since: Date) => db.notification.findMany({ where: { userId, createdAt: { gte: since }, OR: [{ text: { startsWith: "Receipt:" } }, { text: { startsWith: "We charged your card" } }] } });

  it("a retry of one item: one line in Payments and holds naming it, no receipt line, and one email", async () => {
    const { dev, day } = await held();
    fakeStripe();
    const before = new Date();
    expect(await retryOwed(dev.user.id)).toMatchObject({ cents: 1000, lifted: true });
    const lines = await moneyLines(dev.user.id, before);
    expect(lines.map((n) => n.text)).toEqual([`We charged your card $10.00 for what you owed: Ana Silva's call on ${day}.`]);
    expect(lines[0]).toMatchObject({ groupKey: "payhold", payment: true, link: "/app/payments" });
    await sendSummaries(new Date(), [dev.user.id]);
    const mails = (await db.outboxEmail.findMany({ where: { to: dev.user.email } })).map((m) => m.text);
    expect(mails.filter((t) => t.includes("for what you owed: Ana Silva's call on"))).toHaveLength(1);
    expect(mails.join()).not.toContain("Receipt:");
  });

  it("a retry of several items names them all in one line", async () => {
    const { dev, day } = await held(true);
    fakeStripe();
    const before = new Date();
    expect(await retryOwed(dev.user.id)).toMatchObject({ cents: 1800 });
    expect((await moneyLines(dev.user.id, before)).map((n) => n.text)).toEqual([`We charged your card $18.00 for what you owed: Ana Silva's call on ${day} and Ben Okafor's written answers.`]);
  });

  it("Pay what you owe keeps one receipt, naming the items", async () => {
    const { dev, rows, day } = await held(true);
    fakeStripe();
    const before = new Date();
    const r = await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: { seenTotalCents: 1800, seenIds: rows.map((p) => p.id) } })).then(json);
    expect(r.status).toBe(200);
    expect((await moneyLines(dev.user.id, before)).map((n) => n.text)).toEqual([`Receipt: you paid $18.00 for what you owed: Ana Silva's call on ${day} and Ben Okafor's written answers`]);
  });

  it("a retry that waits for the bank sends no line; the bank's confirmation gives one receipt for that money, never two", async () => {
    const { dev, rows, day } = await held();
    fakeStripe("away-action");
    const before = new Date();
    expect(await retryOwed(dev.user.id)).toMatchObject({ cents: 0 });
    expect(await moneyLines(dev.user.id, before)).toHaveLength(0);
    const waitingRow = await db.payment.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(waitingRow.actionPi).not.toBeNull();
    const confirm = (body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie: dev.cookie, body })).then(json);
    expect((await confirm({ paymentId: rows[0].id, start: true })).status).toBe(200);
    expect((await confirm({ paymentId: rows[0].id })).status).toBe(200);
    expect((await moneyLines(dev.user.id, before)).map((n) => n.text)).toEqual([`Receipt: you paid $10.00 for what you owed: Ana Silva's call on ${day}`]);
    expect(await db.notification.count({ where: { userId: dev.user.id, createdAt: { gte: before }, text: { contains: "$10.00" }, NOT: { text: { startsWith: "Your bank wants you to confirm" } } } })).toBe(1);
  });

  it("a reserved chargeback taken on Approve: the one notice names the money, no separate receipt line", async () => {
    const { dev, rows } = await held();
    fakeStripe();
    await db.user.update({ where: { id: dev.user.id }, data: { holdReason: "chargeback", chargebackCardVerifiedAt: new Date() } });
    const r = await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: { seenTotalCents: 1000, seenIds: rows.map((p) => p.id) } })).then(json);
    expect(r.body.reservedCents).toBe(1000);
    await settle();
    const before = new Date();
    expect((await approveChargebackHold(dev.user.id)).lifted).toBe(true);
    const mine = await db.notification.findMany({ where: { userId: dev.user.id, createdAt: { gte: before }, text: { contains: "$10.00" } } });
    expect(mine.map((n) => n.text)).toEqual([approvedLiftedLine(1000)]);
  });
});
