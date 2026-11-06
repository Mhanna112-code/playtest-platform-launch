import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { bellKeyIn } from "@/lib/bell";
import { bankChangedLine } from "@/lib/rules";
import { sendSummaries } from "@/lib/server/notify";
import { chargebackOpened, declinedPayment, disputeAmountChanged, startHold } from "@/lib/server/holds";
import { setStripeForTests } from "@/lib/server/stripe";
import { joined, sact, settle, setup } from "./fixtures";

// (Owner, Nov 6, §294) Every chargeback the developer gets is emailed at once (`always`, whatever the email setting), as the admins' chargeback email is: the one
// that starts the hold, the one that turns a payment hold into a chargeback hold, a further one during a chargeback hold (before: a bell line only), and the bank
// changing its amount. In the bell they stay where they were (the hold lines in the day's "payhold" entry). A decline during a hold keeps its wording and rule.
// (§294, second decision) "At once" means immediately (sendEmail, the admins' path), never queued for the end-of-day email; and the bank changing a chargeback's amount
// BEFORE the repayment now rings (payhold) and emails the developer too, in Pay what you owe's own words (bankChangedLine).

// (Owner, Nov 6, §313a) The hold's one line names each paused test's closing date.
const HOLD_LINE = /^Your tests are paused until you pay what you owe: “Harbor Run” closes on .+$/;
// (Owner, Nov 6, §313a) The chargeback hold's one line names each paused test's closing date.
const CB_LINE = /^Your tests are paused after a chargeback: “Harbor Run” closes on .+ unless you finish the steps$/;
beforeEach(() => { process.env.DISPUTE_WAIT_MS = "0"; });
afterEach(() => { setStripeForTests(null); delete process.env.DISPUTE_WAIT_MS; });

const lines = (userId: string) => db.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
/** The emails sent to this address so far (the outbox: tests have no email key). */
const mails = (to: string) => db.outboxEmail.findMany({ where: { to }, orderBy: { createdAt: "asc" } });

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
  it("the chargeback that starts the hold, then a second one during the chargeback hold: each emailed immediately whatever the setting; one payhold entry in the bell", async () => {
    const w = await world();
    const first = await w.paid(1000);
    expect(await chargebackOpened(first.pi)).toBe(true);
    // Sent immediately, before any summary or end-of-day run.
    expect((await mails(w.dev.user.email)).map((m) => m.subject)).toEqual([expect.stringMatching(CB_LINE)]);
    const second = await w.paid(800);
    expect(await chargebackOpened(second.pi)).toBe(true);
    const l = await lines(w.devId);
    const start = l.find((x) => CB_LINE.test(x.text));
    expect(start).toMatchObject({ mustEmail: true, groupKey: "payhold", payment: true });
    const further = l.filter((x) => x.text.startsWith("Your bank reversed"));
    expect(further).toHaveLength(1);
    expect(further[0].text).toMatch(/: it was added to what you owe$/);
    // Before §294 a bell line only (mustEmail false): now it's emailed at once, and stays in the bell's payhold entry.
    expect(further[0]).toMatchObject({ mustEmail: true, groupKey: "payhold", payment: true, own: false, side: "developer" });
    expect(new Set([start!, further[0]].map((n) => bellKeyIn(n))).size).toBe(1);
    // Each its own email, sent immediately; the bell lines are marked emailed, so the end-of-day email (Off: must-send and payment lines) never repeats them.
    const sent = await mails(w.dev.user.email);
    expect(sent.map((m) => m.subject)).toEqual([expect.stringMatching(CB_LINE), further[0].text]);
    expect(sent[1].text).toContain("To resume: verify a card with 3D Secure, pay what you owe, and wait for the team's approval.");
    expect(sent[1].text).toContain("http://localhost:3400/app/payments#chargeback-steps");
    expect(start!.summarizedAt).not.toBeNull();
    expect(further[0].summarizedAt).not.toBeNull();
    await sendSummaries(new Date(), [w.devId]);
    expect((await mails(w.dev.user.email)).filter((m) => m.text.includes("Your bank reversed") || m.text.includes("after a chargeback"))).toHaveLength(2);
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
    expect(line!.summarizedAt).not.toBeNull();
    expect((await mails(w.dev.user.email)).map((m) => m.subject)).toContain(line!.text);
  });

  it("a decline during a hold keeps its wording and its rule: payhold, a payment line, not a must-send email", async () => {
    const w = await world();
    await startHold(w.devId, "unpaid");
    const row = await db.payment.create({ data: { kind: "review", contractId: w.sessionId, developerId: w.devId, testerId: w.tester.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    expect(await declinedPayment(w.devId, row.id, 500, "Ana Silva's recording")).toBe(false);
    const l = await lines(w.devId);
    expect(l.find((x) => HOLD_LINE.test(x.text))).toMatchObject({ mustEmail: true, groupKey: "payhold" });
    const declined = l.find((x) => x.text.startsWith("Another payment"));
    expect(declined).toMatchObject({ text: "Another payment was declined: $5.00 for Ana Silva's recording was added to what you owe", groupKey: "payhold", payment: true, mustEmail: false, summarizedAt: null });
    // Its email rule unchanged: no immediate email; it waits for the end-of-day payment email.
    expect((await mails(w.dev.user.email)).some((m) => m.subject.startsWith("Another payment"))).toBe(false);
    await sendSummaries(new Date(), [w.devId]);
    expect((await mails(w.dev.user.email)).some((m) => m.text.includes(declined!.text))).toBe(true);
  });

  // (Owner, Nov 6, §295) The amount changing (after the repayment and before it) goes back to the end-of-day email (`always`, no `now`).
  it("the bank changing a chargeback's amount after the repayment: lowered and raised each go in the end-of-day email (§295), not immediately", async () => {
    const w = await world();
    const { pi, p } = await w.paid(2000);
    await db.payment.update({ where: { id: p.id }, data: { chargeback: "open", chargebackAt: new Date(), reversedCents: 2000 } });
    // Repaid (recorded: no PaymentIntent, so its refund is recorded, not sent).
    await db.payment.create({ data: { kind: "chargeback", repaysId: p.id, contractId: p.contractId, developerId: w.devId, testerId: p.testerId, amountCents: 3500, feeCents: 3500, testerCents: 0, status: "charged", settledAt: new Date() } });
    expect(await disputeAmountChanged(pi, 1200, "under_review")).toBe("followed");
    const lowered = (await lines(w.devId)).find((x) => x.text.startsWith("Your bank lowered what it took back"));
    expect(lowered).toMatchObject({ mustEmail: true, payment: true });
    expect(lowered!.summarizedAt).toBeNull();
    expect(await disputeAmountChanged(pi, 1600, "under_review")).toBe("followed");
    const raised = (await lines(w.devId)).find((x) => x.text.startsWith("Your bank raised what it took back"));
    expect(raised).toMatchObject({ mustEmail: true, payment: true });
    expect(raised!.summarizedAt).toBeNull();
    // Neither sent immediately; both in the end-of-day email (the developer is on Off).
    expect((await mails(w.dev.user.email)).some((m) => m.text.includes("what it took back"))).toBe(false);
    await sendSummaries(new Date(), [w.devId]);
    const eod = (await mails(w.dev.user.email)).filter((m) => m.text.includes(lowered!.text));
    expect(eod).toHaveLength(1);
    expect(eod[0].text).toContain(raised!.text);
  });

  it("the bank changing a chargeback's amount BEFORE the repayment: a payhold bell line in Pay what you owe's words, in the end-of-day email (§295)", async () => {
    const w = await world();
    const { pi } = await w.paid(4000);
    expect(await chargebackOpened(pi)).toBe(true);
    const before = (await lines(w.devId)).length;
    expect(await disputeAmountChanged(pi, 2500, "under_review")).toBe("followed");
    const PIECE = "Ana Silva's written answers on “Harbor Run”";
    const want = bankChangedLine(4000, PIECE, 4000, 2500);
    expect(want).toBe(`Your bank changed the amount it took back from your $40.00 payment for ${PIECE}: $40.00 → $25.00 (now $25.00 + $15.00 fee = $40.00)`);
    const added = (await lines(w.devId)).slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ text: want, link: "/app/payments#chargeback-steps", groupKey: "payhold", payment: true, mustEmail: true, side: "developer" });
    expect(added[0].summarizedAt).toBeNull();
    // In the day's payhold entry with the hold's own line.
    const start = (await lines(w.devId)).find((x) => CB_LINE.test(x.text))!;
    expect(bellKeyIn(added[0])).toBe(bellKeyIn(start));
    // (§295) Not sent immediately: in the end-of-day email, with its link.
    expect((await mails(w.dev.user.email)).some((m) => m.text.includes(want))).toBe(false);
    await sendSummaries(new Date(), [w.devId]);
    const mail = (await mails(w.dev.user.email)).find((m) => m.text.includes(want));
    expect(mail?.text).toContain("http://localhost:3400/app/payments#chargeback-steps");
    // Lowered again before any repayment: another line, from the last followed amount.
    expect(await disputeAmountChanged(pi, 2000, "under_review")).toBe("followed");
    expect((await lines(w.devId)).at(-1)!.text).toBe(bankChangedLine(4000, PIECE, 2500, 2000));
    // The same amount again: nothing.
    const n = (await lines(w.devId)).length;
    expect(await disputeAmountChanged(pi, 2000, "under_review")).toBe("same");
    expect((await lines(w.devId)).length).toBe(n);
  });
});
