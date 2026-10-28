import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import * as R from "@/lib/rules";
import { pauseClosesAt, pauseReasons } from "@/lib/pause";
import { payOwed, runDaily, startHold } from "@/lib/server/holds";
import { pauseTest, unpauseTest } from "@/lib/server/restrictions";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 9 (owner, Oct 28 night): caps for unlisted parts, only Pay for them, a note and the ticks on every Pay, a rate on a call's Pay, per-piece extra caps, one clock per paused test.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const DAY = 86_400_000;
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const extra = (testId: string, cookie: string, body: Record<string, unknown>) => act(testId, "pay-extra", cookie, { seenAt: seen(), confirmed: true, payKey: randomUUID(), ...body });
const cents = (dollars: string) => Math.round(Number(dollars) * 100);

/** Written answers sent on a test (listed at `writtenCents`, or not listed with null). */
async function sentWork(writtenCents: string | null) {
  const s = await setup(writtenCents == null ? { writtenCents: null, questions: [] } : { writtenCents });
  const j = await joined(s.testId);
  const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
  await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}
/** A held 30-minute call (listed at $30/h, or not listed). */
async function heldCall(listed: boolean, liveRate = "30.00") {
  const s = await setup(listed ? { liveRateCents: liveRate } : { liveRateCents: null });
  const j = await joined(s.testId);
  const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
  await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 2 * 3_600_000), actualMinutes: 30 } });
  return { ...s, ...j, call };
}

describe("batch 9 item 1 and 6: the caps", () => {
  it("the constants and the per-piece extra cap (100% of the listing, never more than the max; 100% of the max for an unlisted part)", () => {
    expect(R.NO_LISTING_WORK_CAP_CENTS).toBe(100_000);
    expect(R.NO_LISTING_CALL_RATE_CAP_CENTS).toBe(20_000);
    expect(R.EXTRA_PAY_CAP_PERCENT).toBe(100);
    expect(R.pieceMaxCents("submission")).toBe(100_000);
    expect(R.pieceMaxCents("call", 30)).toBe(10_000);
    expect(R.extraCapCents(2000, 100_000)).toBe(2000); // a $20 listing allows $20 extra
    expect(R.extraCapCents(300_000, 100_000)).toBe(100_000); // a $3000 listing allows $1000 extra
    expect(R.extraCapCents(2500, 10_000)).toBe(2500); // a $50/h call, 30 min: $25 extra
    expect(R.extraCapCents(15_000, 10_000)).toBe(10_000); // a $300/h call, 30 min: $100 extra
    expect(R.extraCapCents(null, 100_000)).toBe(100_000); // unlisted: up to the max on top
    expect(R.overMaxLine(100_000)).toBe("This is more than you can pay above the max (up to $1,000).");
    expect(R.overListingLine(2000)).toBe("This is more than you can pay above the listing (up to $20).");
  });

  it("an unlisted written piece: Pay at most $1000, then extra pay at most $1000 more (a total of $2000)", async () => {
    const { dev, testId, sessionId, sub } = await sentWork(null);
    // (Batch 11 section 6) One Pay box: up to the max plus 100% of it.
    const over = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "2000.01", tickedCents: 200_001, over200: true });
    expect(over.body.error.message).toBe("This is more than you can pay above the max (up to $1,000).");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "1000.00", tickedCents: 100_000, over200: true })).status).toBe(200);
    expect((await extra(testId, dev.cookie, { contractId: sessionId, submissionId: sub.id, amount: "1000.01", tickedCents: 100_001, over200: true })).body.error.message).toBe("This is more than you can pay above the max (up to $1,000).");
    expect((await extra(testId, dev.cookie, { contractId: sessionId, submissionId: sub.id, amount: "1000.00", tickedCents: 100_000, over200: true })).status).toBe(200);
  });

  it("an unlisted call: at most $200/h for the logged minutes, then the same again as extra pay", async () => {
    const { dev, testId, sessionId, call } = await heldCall(false);
    // (Batch 12 section 2) An unlisted call: $200/h for its logged minutes and nothing above.
    const over = await pay(dev.cookie, { kind: "call", id: call.id, amount: "100.01", tickedCents: 10_001 });
    expect(over.body.error.message).toBe("This is more than you can pay for this call (up to $100 more for unlisted calls).");
    expect((await pay(dev.cookie, { kind: "call", id: call.id, rate: "201.00", amount: "100.00", tickedCents: 10_000 })).body.error.message).toBe("A call that isn't listed can be paid at most $200 an hour.");
    expect((await pay(dev.cookie, { kind: "call", id: call.id, rate: "200.00", amount: "100.00", tickedCents: 10_000 })).status).toBe(200);
    expect((await extra(testId, dev.cookie, { contractId: sessionId, callId: call.id, amount: "0.50", tickedCents: 50 })).body.error.message).toBe("This is more than you can pay for this call (up to $0 more for unlisted calls).");
  });

  it("a listed piece: what is paid above the listing (Pay plus extra pays) is at most 100% of the listing", async () => {
    const { dev, testId, sessionId, sub } = await sentWork("20.00");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "41.00", tickedCents: 4100 })).body.error.message).toBe("This is more than you can pay above the listing (up to $20).");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "30.00", tickedCents: 3000 })).status).toBe(200);
    expect((await extra(testId, dev.cookie, { contractId: sessionId, submissionId: sub.id, amount: "10.01", tickedCents: 1001 })).body.error.message).toBe("This is more than you can pay above the listing (up to $10).");
    expect((await extra(testId, dev.cookie, { contractId: sessionId, submissionId: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    // A $50/h call: $25 extra for 30 minutes.
    const c = await heldCall(true, "50.00");
    await pay(c.dev.cookie, { kind: "call", id: c.call.id, amount: "25.00", tickedCents: 2500 });
    expect((await extra(c.testId, c.dev.cookie, { contractId: c.sessionId, callId: c.call.id, amount: "25.01", tickedCents: 2501 })).body.error.message).toBe("This is more than you can pay above the listing (up to $25).");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("<PayBox more={{ testId: t.id, contractId: c.id }}");
    expect(src("app/app/tests/[id]/page.tsx")).toContain('kind="call" id={x.id}');
  });
});

describe("batch 9 item 2: an unlisted part has only Pay", () => {
  it("no Reject; $0 closes the row with no tick and reads '<dev> paid $0 for this' plus the note; (batch 10) it can be disputed", async () => {
    const { dev, tester, sessionId, sub } = await sentWork(null);
    const rej = await pay(dev.cookie, { kind: "submission", id: sub.id, action: "reject", reason: "Not what I asked" });
    expect(rej.body.error.message).toBe("A part that isn't listed can't be rejected: pay $0 to close it.");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "0", reason: "Thanks, not needed after all" })).status).toBe(200);
    expect(await db.review.findFirstOrThrow({ where: { submissionId: sub.id } })).toMatchObject({ amountCents: 0, rejected: false, reason: "Thanks, not needed after all" });
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "Nora Lane paid $0 for your written answers on “Harbor Run”" } })).toBe(1); // (batch 15 section 20: no note in the bell)
    const d = await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question fully" });
    expect(d.status).toBe(200); // (Batch 10) every reviewed part can be disputed, unlisted ones too
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain('{listed && !more && <button className="btn-danger"');
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("{dev} paid $0 for this");
  });

  it("(batch 15 section 2) the developer's reminders follow the review marks to the review date, then stop; the row stays", async () => {
    const { dev, sub, sessionId } = await sentWork(null);
    // Sent 5 days ago; the review date is the later of the tester's deadline and sent + 7 days. Make it 2 days ahead: the 3-day mark is due.
    await db.submission.update({ where: { id: sub.id }, data: { updatedAt: new Date(Date.now() - 5 * DAY), payBy: new Date(Date.now() + 2 * DAY) } });
    await db.contract.update({ where: { id: sessionId }, data: { dueAt: new Date(Date.now() + 1 * DAY) } });
    await runDaily();
    const n = () => db.notification.count({ where: { userId: dev.user.id, reminderKey: `unreviewed:${sub.id}` } });
    expect(await n()).toBe(1);
    // After the review date: no Charge for an unlisted part, and no more reminders.
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - DAY) } });
    await db.contract.update({ where: { id: sessionId }, data: { dueAt: new Date(Date.now() - DAY) } });
    await runDaily();
    expect(await n()).toBe(1);
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).toBeNull();
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
  });
});

describe("batch 9 item 3: an optional note on every Pay", () => {
  it("the tester reads it with the payment (session page and bell line); extra pay carries one too; below the listing it is required", async () => {
    const { dev, tester, testId, sessionId, sub } = await sentWork("10.00");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400 })).body.error.message).toContain("Say why");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, reason: "Great detail" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "Nora Lane paid you $10.00 for your written answers on “Harbor Run”" } })).toBe(1);
    expect((await extra(testId, dev.cookie, { contractId: sessionId, submissionId: sub.id, amount: "2.00", tickedCents: 200, note: "For the bug list" })).status).toBe(200);
    expect(await db.payment.findFirstOrThrow({ where: { submissionId: sub.id, kind: "extra" } })).toMatchObject({ note: "For the bug list" });
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "Nora Lane paid you $2.00 more for your written answers on “Harbor Run”" } })).toBe(1);
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain("Note to {p.name}");
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain('{more ? " (optional)"');
    expect(src("app/app/sessions/[id]/page.tsx")).toContain('data-extra-line=""');
  });
});

describe("batch 9 item 4: a rate on a call's Pay", () => {
  it("the rate × logged minutes is the amount; the rate is kept and the tester sees it; a listed call's starts at the contract rate", async () => {
    const { dev, tester, call } = await heldCall(true);
    expect((await pay(dev.cookie, { kind: "call", id: call.id, rate: "40.00", amount: "20.00", tickedCents: 2000 })).status).toBe(200);
    expect(await db.review.findFirstOrThrow({ where: { callId: call.id } })).toMatchObject({ amountCents: 2000, rateCents: 4000 });
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { startsWith: "Nora Lane paid you $20.00 for your live call" } } })).toBe(1);
    const box = src("app/app/tests/[id]/PayBox.tsx");
    expect(box).toContain("Rate ($/h)");
    expect(box).toContain("setAmount(r == null ? \"\" : (Math.round((r * minutes) / 60) / 100).toFixed(2));");
    expect(box).toContain('const typeAmount = (v: string) => { setAmount(v); setRate("");');
    expect(box).toContain("isCall && listed && p.rateCents != null ? (p.rateCents / 100).toFixed(2) : \"\"");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("{review.rateCents != null && <> ({money(review.rateCents)}/h)</>}");
  });
});

describe("batch 9 item 5: the ticks on every Pay", () => {
  it("every amount above $0 needs the tick naming it; over $200 also the second tick; $0 needs none", () => {
    expect(R.PAY_TICK_LINE(1000)).toBe("I understand this payment of $10.00 can't be refunded and is charged now.");
    expect(R.OVER_PAY_TICK_LINE).toBe("I confirm this payment is over $200.");
    expect(R.payTicks(0, null, false)).toEqual({ ok: true });
    expect(R.payTicks(1000, null, false)).toEqual({ ok: false, message: "Tick “I understand this payment of $10.00 can't be refunded and is charged now.” to pay." });
    expect(R.payTicks(1000, 900, false).ok).toBe(false); // a changed amount unticks it
    expect(R.payTicks(25_000, 25_000, false)).toEqual({ ok: false, message: "Tick “I confirm this payment is over $200.” to pay." });
    expect(R.payTicks(25_000, 25_000, true)).toEqual({ ok: true });
    expect(R.checkExtraPay(1000, null)).toMatchObject({ ok: false });
    expect(R.checkExtraPay(1000, 1000)).toEqual({ ok: true });
    for (const f of ["app/app/tests/[id]/PayBox.tsx"]) {
      expect(src(f), f).toContain("PAY_TICK_LINE(cents)");
      expect(src(f), f).toContain("OVER_PAY_TICK_LINE");
      expect(src(f), f).not.toContain("charged now: {");
    }
  });

  it("the server refuses a Pay or an Extra pay without them", async () => {
    const { dev, testId, sessionId, sub } = await sentWork("150.00");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "250.00" })).body.error.message).toBe(`Tick “${R.PAY_TICK_LINE(25_000)}” to pay.`);
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "250.00", tickedCents: 25_000 })).body.error.message).toBe(`Tick “${R.OVER_PAY_TICK_LINE}” to pay.`);
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "250.00", tickedCents: 25_000, over200: true })).status).toBe(200);
    expect((await extra(testId, dev.cookie, { contractId: sessionId, submissionId: sub.id, amount: "5.00" })).body.error.message).toBe(`Tick “${R.PAY_TICK_LINE(cents("5.00"))}” to pay.`);
  });
});

describe("batch 9 item 7: one 7-day clock per paused test", () => {
  it("from when it was first paused, whatever the causes; a second cause or one lifting never moves it; the card lists every reason", async () => {
    const { dev, testId } = await setup();
    await startHold(dev.user.id, "unpaid");
    const first = (await db.test.findUniqueOrThrow({ where: { id: testId } })).pausedSince!;
    expect(first).not.toBeNull();
    const a = await makeUser({ name: "Admin" });
    await new Promise((r) => setTimeout(r, 20));
    await pauseTest(a.user.id, testId, "Reported");
    let t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    let u = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    expect(t.pausedSince!.getTime()).toBe(first.getTime());
    expect(pauseReasons(u, t)).toBe("payment hold · paused by the team");
    expect(src("app/app/page.tsx")).toContain("const why = pauseReasons(user, t);");
    // The hold lifts while the team's pause remains: the clock stays at the first pause.
    expect((await payOwed(u)).lifted).toBe(true);
    t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    u = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    expect(pauseClosesAt(u, t)!.since.getTime()).toBe(first.getTime());
    expect(pauseClosesAt(u, t)!.at.getTime()).toBe(first.getTime() + 7 * DAY);
    expect(pauseReasons(u, t)).toBe("paused by the team");
    // No cause left: the clock ends.
    await unpauseTest(testId);
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).pausedSince).toBeNull();
  });

  it("the migration starts the clock of tests already paused at their earliest cause", () => {
    const dir = path.resolve(__dirname, "../prisma/migrations");
    const name = fs.readdirSync(dir).find((d) => d.endsWith("_pay_notes_rates_pause_clock"))!;
    const sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8");
    expect(sql).toContain('LEAST(t."adminPausedAt", u."holdStartedAt", u."suspendedAt")');
  });
});
