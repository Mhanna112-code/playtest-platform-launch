import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { fmtDateTimeIn } from "@/lib/format";
import { AUTO_CHARGED_CALL, awayFromTest, onTestLine, partWhen } from "@/lib/rules";
import { decideDispute } from "@/lib/server/payments";
import { bankToConfirm, confirmItems } from "@/lib/server/confirm";
import { deferredForBox, finishChoicePay } from "@/lib/server/holds";
import { devPaymentChanges, testerPaymentChanges } from "@/lib/server/live";
import { adminPage, type MineVM } from "@/lib/server/adminLists";
import { json, makeUser, req } from "./helpers";
import { bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 4, §177) "Nina Park disputed the pay for her live call." — she had three live calls on that test and parts on two tests: every change line names
// WHICH part (a call with its date and time) and, away from the test's own page, WHICH test. Also (same day, the dashboard): a raw "⟦t:…:date⟧" marker printed in
// "Charges made while you were away (… live call on “excerptexcer…” (⟦t:…⟧) $5.00)".

const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const devs: string[] = [];
afterAll(async () => {
  // Nothing left waiting for the global jobs other files run.
  await db.payment.updateMany({ where: { developerId: { in: devs }, status: { notIn: ["charged", "not_set_up"] } }, data: { status: "cancelled", actionPi: null, actionBy: null, coveredById: null } });
});

/** Ana's live call 2 hours ago (30 minutes, unlisted), paid $10.00 by Nora; `when`: its start as the lines write it (UTC in tests). */
async function paidCall() {
  const s = await setup({ liveRateCents: null });
  devs.push(s.dev.user.id);
  const j = await joined(s.testId);
  const booked = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
  const start = new Date(Date.now() - 2 * 3_600_000);
  start.setUTCSeconds(0, 0);
  const call = await db.call.update({ where: { id: booked.id }, data: { startsAt: start, actualMinutes: 30 } });
  expect((await pay(s.dev.cookie, { kind: "call", id: call.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  await settle();
  return { ...s, ...j, call, when: fmtDateTimeIn(start, "UTC"), day: start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) };
}
const admin = async () => {
  const a = await makeUser({ name: "Admin" });
  return db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
};
const noTokens = (s: string) => expect(s).not.toMatch(/⟦t:/);

describe("§177 the wording helpers", () => {
  it("a part with its call time; a line away from its test names the test (quoted, cut), lowercasing only a leading pronoun/article; lines that name a test are kept", () => {
    expect(partWhen("live call", "Tue, Oct 27, 8:00 AM")).toBe("live call on Tue, Oct 27, 8:00 AM");
    expect(partWhen("recording")).toBe("recording");
    expect(onTestLine("Harbor Run", "Nina Park disputed the pay for her live call on Tue, Oct 27, 8:00 AM")).toBe("On “Harbor Run”: Nina Park disputed the pay for her live call on Tue, Oct 27, 8:00 AM");
    expect(onTestLine("Harbor Run", "The team decided Nina Park's dispute on her recording: kept the pay at $4.00")).toBe("On “Harbor Run”: the team decided Nina Park's dispute on her recording: kept the pay at $4.00");
    expect(onTestLine("Harbor Run", "You invited Lee Park in another tab")).toBe("On “Harbor Run”: you invited Lee Park in another tab");
    expect(onTestLine("excerptexcerptexcerpt", "Ana Silva left the test")).toBe("On “excerptexcerptexcerp…”: Ana Silva left the test"); // (§203: cut at 20)
    expect(onTestLine("Harbor Run", "On Sky Lab: your bank reversed your $10.00 payment")).toBe("On Sky Lab: your bank reversed your $10.00 payment");
    expect(onTestLine("Harbor Run", "Payment went through on Sky Lab: $5.00 to Ana Silva for the recording")).toBe("Payment went through on Sky Lab: $5.00 to Ana Silva for the recording");
    expect(awayFromTest(undefined, "t1")).toBe(false); // an older page: its own test page
    expect(awayFromTest("/app/tests/t1", "t1")).toBe(false);
    expect(awayFromTest("/app/tests/t1/edit", "t1")).toBe(false);
    expect(awayFromTest("/app", "t1")).toBe(true);
    expect(awayFromTest("/app/payments", "t1")).toBe(true);
    expect(awayFromTest("/app/tests/t10", "t1")).toBe(true);
  });
});

describe("§177 a dispute on one of several calls: every line names the call", () => {
  it("the dispute, the team's decision (and its bells and emails), the developer's own Pay line; the admin's result line still reads", async () => {
    const w = await paidCall();
    // The developer's own Pay (another tab's line).
    expect((await db.actionLog.findFirstOrThrow({ where: { userId: w.dev.user.id, text: { startsWith: "paid Ana Silva" } } })).text).toMatch(new RegExp(`^paid Ana Silva \\$10\\.00 for the live call on ${w.when.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\u001f`));
    expect(await db.testEvent.count({ where: { testId: w.testId, kind: "paid", text: `You paid Ana Silva $10.00 for the live call on ${w.when}` } })).toBe(1);
    expect((await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "call", id: w.call.id, reason: "The call ran long and I tested everything", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await db.testEvent.findFirstOrThrow({ where: { testId: w.testId, kind: "dispute" } })).text).toBe(`Ana Silva disputed the pay for her live call on ${w.when}`);
    const filed = await db.notification.findFirstOrThrow({ where: { userId: w.dev.user.id, text: { startsWith: "Ana Silva disputed the pay for her live call on “Harbor Run” (" } } });
    noTokens(filed.text);
    expect(filed.text).toContain(`(${w.when} UTC)`); // the call's day and time, in the reader's zone
    const row = await db.dispute.findFirstOrThrow({ where: { callId: w.call.id } });
    const a = await admin();
    expect(await decideDispute(a, row.id, { total: "" })).toMatchObject({ extraCents: 0 });
    const kept = "kept the pay at $10.00, which was already paid: nothing more was charged";
    expect((await db.testEvent.findFirstOrThrow({ where: { testId: w.testId, kind: "admin" } })).text).toBe(`The team decided Ana Silva's dispute on her live call on ${w.when}: ${kept}`);
    const tester = await db.notification.findFirstOrThrow({ where: { userId: w.tester.user.id, text: { startsWith: "Your dispute about your live call on “Harbor Run” (" } } });
    noTokens(tester.text);
    expect(tester.text).toMatch(/ was decided$/);
    expect(await db.notification.count({ where: { userId: w.dev.user.id, text: { startsWith: "Ana Silva's dispute about her live call on “Harbor Run” (", endsWith: ") was decided" } } })).toBe(1);
    // The admin's Your actions reads what the decision did from its line, past the call's time ("8:00 AM: kept …").
    const mine = ((await adminPage("mine", a.id, null)).rows as MineVM[]).find((r) => r.id === `dispute-${row.id}`);
    expect(mine?.why).toBe(`dispute decided by you: ${kept}`);
  });

  it("a tester's Charge on a call names the call; payment lines name the part (a decision the part it decided) with the call's time", async () => {
    const w = await paidCall();
    const charge = await db.payment.create({ data: { kind: "call", callId: w.call.id, contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "pending" } });
    await finishChoicePay(charge.id, { status: "not_set_up", stripePaymentIntentId: null });
    expect(await db.testEvent.count({ where: { testId: w.testId, text: `Ana Silva charged $5.00 for her call on ${w.when}` } })).toBe(1);
    const since = new Date(Date.now() - 1000);
    const at = new Date();
    await db.payment.update({ where: { id: charge.id }, data: { settledAt: at, owedUntil: at } });
    await db.payment.create({ data: { kind: "dispute", callId: w.call.id, contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 300, feeCents: 0, testerCents: 0, status: "charged", settledAt: at } });
    const lines = (await devPaymentChanges(w.dev.user.id, w.testId, since)).map((l) => l.text);
    expect(lines).toEqual(expect.arrayContaining([
      `Payment went through on Harbor Run: $5.00 to Ana Silva for the live call on ${w.when}`,
      `Payment went through on Harbor Run: $3.00 to Ana Silva for the dispute decision on the live call on ${w.when}`,
    ]));
    // The tester's own lines on her session page name the call too.
    const hers = (await testerPaymentChanges(w.tester.user.id, w.sessionId, since)).map((l) => l.text);
    expect(hers).toEqual(expect.arrayContaining([`Nora Lane paid $5.00 for your live call on ${w.when}`, `Nora Lane paid $3.00 for your dispute about the live call on ${w.when}`]));
  });
});

describe("§177 time markers never reach a page unrendered (the dashboard's “Charges made while you were away”)", () => {
  it("the dashboard row and Payments' item for an away:charges payment covering a team decision on a call; Payments' waiting automatic call charge", async () => {
    const w = await paidCall();
    const dev = w.dev.user.id;
    const one = await db.payment.create({ data: { kind: "owed", note: "away:charges", developerId: dev, testerId: dev, amountCents: 500, feeCents: 500, testerCents: 0, status: "needs_confirmation", actionPi: "pi_away_" + randomUUID(), actionBy: new Date(Date.now() + 2 * 86_400_000) } });
    await db.payment.create({ data: { kind: "dispute", callId: w.call.id, contractId: w.sessionId, developerId: dev, testerId: w.tester.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "deferred", coveredById: one.id } });
    const row = (await bankToConfirm(dev)).find((r) => r.id === one.id)!;
    for (const t of [row.lead, row.full]) {
      noTokens(t);
      expect(t).toContain(`the team's dispute decision on`);
      expect(t).toContain(`live call on “Harbor Run” (${w.when}) $5.00`); // (Owner, Nov 4, §178) a call by its date and time
    }
    const item = (await confirmItems(dev)).find((i) => i.id === one.id)!;
    for (const t of [item.text, item.full]) {
      noTokens(t);
      expect(t).toMatch(/^Charges made while you were away \$5\.00 \(.*live call on “Harbor Run” \(\w+, \w+ \d+, \d+:\d\d [AP]M\) \$5\.00\)/); // (§178)
    }
    // An automatic call charge waiting for the lift: its call's date, written.
    const b2 = await bookCall(w.testId, w.dev.cookie, w.sessionId, w.tester.cookie, 72);
    const start2 = new Date(Date.now() - 9 * 86_400_000);
    await db.call.update({ where: { id: b2.id }, data: { startsAt: start2, actualMinutes: 30 } });
    await db.review.create({ data: { callId: b2.id, contractId: w.sessionId, amountCents: 1500, payKey: randomUUID(), auto: true, reason: AUTO_CHARGED_CALL } });
    const waiting = await db.payment.create({ data: { kind: "call", callId: b2.id, contractId: w.sessionId, developerId: dev, testerId: w.tester.user.id, amountCents: 1500, feeCents: 0, testerCents: 0, status: "deferred" } });
    const box = (await deferredForBox(dev)).find((p) => p.id === waiting.id)!;
    for (const t of [box.what, box.full]) {
      noTokens(t);
      expect(t).toContain(`(${fmtDateTimeIn(start2, "UTC")}, charged automatically after`); // (§178) its date and time
    }
  });
});
