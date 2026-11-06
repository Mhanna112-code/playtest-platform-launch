import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { bellKeyIn } from "@/lib/bell";
import { sendSummaries } from "@/lib/server/notify";
import { chargebackOpened, declinedPayment, disputeAmountChanged, startHold } from "@/lib/server/holds";
import { setStripeForTests } from "@/lib/server/stripe";
import { joined, sact, settle, setup } from "./fixtures";

// (Owner, Nov 6, §294) Every chargeback the developer gets is emailed at once (`always`, whatever the email setting), as the admins' chargeback email is: the one
// that starts the hold, the one that turns a payment hold into a chargeback hold, a further one during a chargeback hold (before: a bell line only), and the bank
// changing its amount. In the bell they stay where they were (the hold lines in the day's "payhold" entry). A decline during a hold keeps its wording and rule.

beforeEach(() => { process.env.DISPUTE_WAIT_MS = "0"; });
afterEach(() => { setStripeForTests(null); delete process.env.DISPUTE_WAIT_MS; });

const lines = (userId: string) => db.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

/** A developer on email Off with a tester's written answers sent. */
async function world() {
  const s = await setup();
  const j = await joined(s.testId, "Ana Silva");
  const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
  await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await db.user.update({ where: { id: s.dev.user.id }, data: { emailPref: "off" } });
  const paid = async (cents: number) => {
    const pi = "pi_" + randomUUID();
    const p = await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: j.sessionId, developerId: s.dev.user.id, testerId: j.tester.user.id, amountCents: cents, feeCents: 0, testerCents: 0, status: "charged", stripePaymentIntentId: pi } });
    return { pi, p };
  };
  return { ...s, ...j, sub, devId: s.dev.user.id, paid };
}

describe("§294 chargeback emails go out at once, every one", () => {
  it("the chargeback that starts the hold, then a second one during the chargeback hold: both emailed whatever the setting; one payhold entry in the bell", async () => {
    const w = await world();
    const first = await w.paid(1000);
    expect(await chargebackOpened(first.pi)).toBe(true);
    const second = await w.paid(800);
    expect(await chargebackOpened(second.pi)).toBe(true);
    const l = await lines(w.devId);
    const start = l.find((x) => x.text === "Your tests are paused after a chargeback");
    expect(start).toMatchObject({ mustEmail: true, groupKey: "payhold", payment: true });
    const further = l.filter((x) => x.text.startsWith("Your bank reversed"));
    expect(further).toHaveLength(1);
    expect(further[0].text).toMatch(/: it was added to what you owe$/);
    // Before §294 a bell line only (mustEmail false): now it's emailed at once, and stays in the bell's payhold entry.
    expect(further[0]).toMatchObject({ mustEmail: true, groupKey: "payhold", payment: true, own: false, side: "developer" });
    expect(new Set([start!, further[0]].map((n) => bellKeyIn(n))).size).toBe(1);
    // The email (Off: only must-send and payment lines) holds both.
    await sendSummaries(new Date(), [w.devId]);
    const mail = await db.outboxEmail.findFirstOrThrow({ where: { to: w.dev.user.email }, orderBy: { createdAt: "desc" } });
    expect(mail.text).toContain("Your tests are paused after a chargeback");
    expect(mail.text).toContain(further[0].text);
    // The admins' chargeback email, unchanged: one per chargeback, at once.
    const admin = await db.outboxEmail.findMany({ where: { to: "owner@playtest.test", subject: { startsWith: "Playtest: new chargeback of " }, text: { contains: second.pi } } });
    expect(admin).toHaveLength(1);
    expect(admin[0].subject).toBe("Playtest: new chargeback of $8.00");
  });

  it("a chargeback during a payment hold: the hold becomes a chargeback hold, emailed at once, in payhold (unchanged)", async () => {
    const w = await world();
    await startHold(w.devId, "unpaid");
    const p = await w.paid(1000);
    expect(await chargebackOpened(p.pi)).toBe(true);
    const line = (await lines(w.devId)).find((x) => /now a chargeback hold/.test(x.text));
    expect(line).toMatchObject({ mustEmail: true, groupKey: "payhold", payment: true });
  });

  it("a decline during a hold keeps its wording and its rule: payhold, a payment line, not a must-send email", async () => {
    const w = await world();
    await startHold(w.devId, "unpaid");
    const row = await db.payment.create({ data: { kind: "review", contractId: w.sessionId, developerId: w.devId, testerId: w.tester.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    expect(await declinedPayment(w.devId, row.id, 500, "Ana Silva's recording")).toBe(false);
    const l = await lines(w.devId);
    expect(l.find((x) => x.text === "Your tests are paused")).toMatchObject({ mustEmail: true, groupKey: "payhold" });
    expect(l.find((x) => x.text.startsWith("Another payment"))).toMatchObject({ text: "Another payment was declined: $5.00 for Ana Silva's recording was added to what you owe", groupKey: "payhold", payment: true, mustEmail: false });
  });

  it("the bank changing a chargeback's amount after the repayment: lowered and raised are each emailed at once", async () => {
    const w = await world();
    const { pi, p } = await w.paid(2000);
    await db.payment.update({ where: { id: p.id }, data: { chargeback: "open", chargebackAt: new Date(), reversedCents: 2000 } });
    // Repaid (recorded: no PaymentIntent, so its refund is recorded, not sent).
    await db.payment.create({ data: { kind: "chargeback", repaysId: p.id, contractId: p.contractId, developerId: w.devId, testerId: p.testerId, amountCents: 3500, feeCents: 3500, testerCents: 0, status: "charged", settledAt: new Date() } });
    expect(await disputeAmountChanged(pi, 1200, "under_review")).toBe("followed");
    const lowered = (await lines(w.devId)).find((x) => x.text.startsWith("Your bank lowered what it took back"));
    expect(lowered).toMatchObject({ mustEmail: true, payment: true });
    expect(await disputeAmountChanged(pi, 1600, "under_review")).toBe("followed");
    const raised = (await lines(w.devId)).find((x) => x.text.startsWith("Your bank raised what it took back"));
    expect(raised).toMatchObject({ mustEmail: true, payment: true });
  });
});
