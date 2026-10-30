import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setStripeForTests } from "@/lib/server/stripe";
import { POST as reviewPOST } from "@/app/api/review/route";
import { renderTimes } from "@/lib/tz";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, setup } from "./fixtures";

// Batch 29 §37 (the batch 28 design doc check's leftovers) and §38 (a piece's cap is the part's max IN ALL).

const DAY = 86_400_000;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
afterEach(() => setStripeForTests(null));

/** A Stripe stand-in: every charge succeeds, is declined, or asks the bank (off-session: authentication_required). */
function stripeCard(card: "ok" | "declined" | "3ds") {
  setStripeForTests({
    paymentIntents: {
      create: async () => {
        if (card === "declined") throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError", rawType: "card_error", code: "card_declined" });
        const id = "pi_" + randomUUID();
        if (card === "3ds") throw Object.assign(new Error("Authentication required."), { code: "authentication_required", raw: { payment_intent: { id, client_secret: `${id}_secret` } } });
        return { id, status: "succeeded", latest_charge: id.replace(/^pi_/, "ch_") };
      },
      retrieve: async (id: string) => ({ id, status: "requires_payment_method" }),
    },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
  } as unknown as Stripe);
}

/** A listed call ($30/h) that took place 8 days ago, 30 minutes measured, its review date just passed: $15.00 to charge. */
async function heldCall(dev: { card?: boolean } = {}) {
  const s = await setup();
  const j = await joined(s.testId);
  const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
  await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 8 * DAY), actualMinutes: 30, payBy: new Date(Date.now() - 60_000) } });
  if (dev.card !== false) await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
  return { ...s, ...j, call };
}
const autoCharge = async () => (await import("@/lib/server/holds")).autoChargeCalls(new Date());
const eventsOf = async (testId: string) => (await db.testEvent.findMany({ where: { testId, kind: "paid" }, orderBy: { createdAt: "asc" } })).map((e) => e.text);
const delayedLines = (userId: string) => db.notification.count({ where: { userId, text: "Payment for your call on “Harbor Run” may be delayed" } });

describe("batch 29 §37: an automatic call charge the tester can't be paid for yet reads 'may be delayed'", () => {
  it("during a hold: owed, the tester's call reads delayed (bell and page), never 'failed' or 'hold'; the event says it was added to what's owed", async () => {
    const x = await heldCall();
    await db.user.update({ where: { id: x.dev.user.id }, data: { holdStartedAt: new Date(), holdReason: "unpaid" } });
    expect(await autoCharge()).toBe(1);
    expect(await db.payment.findFirstOrThrow({ where: { callId: x.call.id } })).toMatchObject({ status: "owed", amountCents: 1500 });
    expect(await delayedLines(x.tester.user.id)).toBe(1);
    const mine = await db.notification.findMany({ where: { userId: x.tester.user.id } });
    for (const n of mine) expect(n.text).not.toMatch(/failed|hold|chargeback|suspended/i);
    expect(await eventsOf(x.testId)).toContain("Ana Silva's call was charged automatically: $15.00, added to what you owe");
    // The session page treats owed and waiting (deferred) call payments like a declined one: the delayed line instead of "paid".
    expect(src("app/app/sessions/[id]/page.tsx")).toContain('{ status: { in: ["needs_confirmation", "owed", "deferred"] } }');
  });

  it("during a suspension: waiting (deferred), the tester reads delayed too", async () => {
    const x = await heldCall();
    await db.user.update({ where: { id: x.dev.user.id }, data: { devSuspendedAt: new Date() } });
    expect(await autoCharge()).toBe(1);
    expect(await db.payment.findFirstOrThrow({ where: { callId: x.call.id } })).toMatchObject({ status: "deferred" });
    expect(await delayedLines(x.tester.user.id)).toBe(1);
    expect(await eventsOf(x.testId)).toContain("Ana Silva's call was charged automatically: $15.00, charged when your account is clear");
  });

  it("the developer's event says the true outcome: declined, or waiting for the bank", async () => {
    stripeCard("declined");
    const a = await heldCall();
    expect(await autoCharge()).toBe(1);
    expect(await db.payment.findFirstOrThrow({ where: { callId: a.call.id } })).toMatchObject({ status: "failed" });
    expect(await eventsOf(a.testId)).toEqual(["The automatic charge for Ana Silva's call ($15.00) was declined: it was added to what you owe"]);
    expect(await delayedLines(a.tester.user.id)).toBe(1);
    stripeCard("3ds");
    const b = await heldCall();
    expect(await autoCharge()).toBe(1);
    expect(await db.payment.findFirstOrThrow({ where: { callId: b.call.id } })).toMatchObject({ status: "needs_confirmation" });
    expect(await eventsOf(b.testId)).toEqual(["Ana Silva's call was charged automatically: $15.00, waiting for your bank to confirm it"]);
    stripeCard("ok");
    const c = await heldCall();
    expect(await autoCharge()).toBe(1);
    expect(await eventsOf(c.testId)).toEqual(["Ana Silva's call was charged automatically: $15.00"]);
  });
});

describe("batch 29 §37: a developer who deleted their account", () => {
  it("their saved card is charged for an unpaid listed call; with no saved card the call stays unpaid (and the page says it can't be paid)", async () => {
    stripeCard("ok");
    const withCard = await heldCall();
    await db.user.update({ where: { id: withCard.dev.user.id }, data: { deletedAt: new Date() } });
    const noCard = await heldCall({ card: false });
    await db.user.update({ where: { id: noCard.dev.user.id }, data: { deletedAt: new Date() } });
    expect(await autoCharge()).toBe(1);
    expect(await db.payment.findFirstOrThrow({ where: { callId: withCard.call.id } })).toMatchObject({ status: "charged", amountCents: 1500 });
    expect(await db.review.count({ where: { callId: noCard.call.id } })).toBe(0);
    expect(await db.payment.count({ where: { callId: noCard.call.id } })).toBe(0);
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("devGone && !(x.rateCents != null && c.test.developer.stripePaymentMethodId)");
  });

  it("declined: no hold (no account left), it stays delayed for the tester and listed for the admins", async () => {
    stripeCard("declined");
    const x = await heldCall();
    await db.user.update({ where: { id: x.dev.user.id }, data: { deletedAt: new Date() } });
    expect(await autoCharge()).toBe(1);
    expect(await db.payment.findFirstOrThrow({ where: { callId: x.call.id } })).toMatchObject({ status: "failed" });
    expect((await db.user.findUniqueOrThrow({ where: { id: x.dev.user.id } })).holdStartedAt).toBeNull();
    expect(await delayedLines(x.tester.user.id)).toBe(1);
    expect(await eventsOf(x.testId)).toEqual(["The automatic charge for Ana Silva's call ($15.00) was declined"]);
  });
});

describe("batch 29 §37: the automatic-charge dates", () => {
  it("the developer's Pay box date is in their saved zone; the tester's line shows only while the date is ahead", () => {
    const dev = src("app/app/tests/[id]/page.tsx");
    expect(dev).toContain('autoChargeLine(pieceDay(x.x!.payBy, u.timeZone)'); // (batch 30 §20) one shared date helper
    expect(dev).not.toContain("autoChargeLine(fmtDate(");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain('{x.rateCents != null && x.payBy && x.payBy > now && <p className="text-xs text-slate-400" data-auto-charge="">');
  });

  it("an outage gap's date is decided in the admin's zone", async () => {
    const { gapLine } = await import("@/lib/server/outages");
    // 7:30 PM to 8:10 PM in New York: one day there, two days in UTC.
    const g = { startAt: new Date("2026-10-29T23:30:00Z"), endAt: new Date("2026-10-30T00:10:00Z"), ms: 40 * 60_000 };
    expect(renderTimes(gapLine(g, "America/New_York"), "America/New_York")).toMatch(/^Possible outage: no checks from 7:30 PM [A-Z]+ to 8:10 PM/);
    expect(renderTimes(gapLine(g, "UTC"), "UTC")).toMatch(/^Possible outage: no checks from Thu, Oct 29, 11:30 PM/);
    expect(src("app/admin/page.tsx")).toContain("gapLine(g, u.timeZone)");
  });
});

describe("batch 29 §37: a deferred payment declined after a lift names what it was", () => {
  it("a tester's Charge (charged after the pause) reads as that piece, not 'work you paid for during the pause'", async () => {
    const R = await import("@/lib/rules");
    stripeCard("declined");
    const s = await setup();
    const j = await joined(s.testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    await db.review.create({ data: { submissionId: sub.id, contractId: j.sessionId, amountCents: 1000, agreedCents: 1000, reason: R.CHARGED_BY_TESTER, payKey: randomUUID() } });
    const base = { kind: "review", contractId: j.sessionId, developerId: s.dev.user.id, testerId: j.tester.user.id, feeCents: 0, testerCents: 0, status: "deferred" };
    await db.payment.create({ data: { ...base, submissionId: sub.id, amountCents: 1000 } });
    // A second deferred payment (a team decision), so the first decline starts the hold and the next says "Another payment was declined: … for <what>".
    await db.payment.create({ data: { ...base, kind: "dispute", amountCents: 700, createdAt: new Date(Date.now() - 60_000) } });
    const { chargeDeferred } = await import("@/lib/server/holds");
    await chargeDeferred(s.dev.user.id);
    const lines = (await db.notification.findMany({ where: { userId: s.dev.user.id, text: { startsWith: "Another payment was declined" } } })).map((n) => n.text);
    expect(lines).toEqual(["Another payment was declined: $10.00 for Ana Silva's written answers on “Harbor Run” was added to what you owe"]);
    expect(src("lib/server/holds.ts")).not.toContain('p.kind === "dispute" ? "a team decision" : "work you paid for during the pause"');
  });
});

describe("batch 29 §37: the admin's dispute row", () => {
  it("'Paid for this piece' is the Pay plus every Pay more, the same total as the range line", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    expect((await json(await reviewPOST(req("/api/review", { cookie: s.dev.cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 } })))).status).toBe(200);
    expect((await act(s.testId, "pay-extra", s.dev.cookie, { seenAt: seen(), confirmed: true, payKey: randomUUID(), contractId: j.sessionId, submissionId: sub.id, amount: "5.00", tickedCents: 500 })).status).toBe(200);
    expect((await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "submission", id: sub.id, reason: "We agreed $30 in the chat" })).status).toBe(200);
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    const { disputeRow } = await import("@/lib/server/adminLists");
    const row = await disputeRow(d);
    expect(row.money).toBe("Listing $10.00 · Paid for this piece $15.00");
    expect(row.range).toBe("$15.00 paid · can raise up to $985.00 more");
  });
});

describe("batch 29 §37: Terms and leftovers", () => {
  it("the Pay more example, the batch 28 points in What changed, the automatic charge under Calls; the version stays", async () => {
    const T = await import("@/lib/termsOfUse");
    expect(T.TERMS_VERSION).toBe(2);
    const more = T.PAYMENT_RULES.find((r) => r.heading === "Pay more")!;
    expect(more.example).toBe("A written part listed at $20 can be paid up to $1,000 in all.");
    expect(more.text).toContain("the part's maximum in all, listed or not");
    expect(T.PAYMENT_RULES.find((r) => r.heading === "Calls")!.text).toContain("is charged to their card automatically for its measured length at the call's rate");
    const points = T.WHAT_CHANGED.find((w) => w.version === 2)!.points.join("\n");
    expect(points).toContain("To decide a dispute, our team can read the chat between the tester and the developer");
    expect(points).toContain("can be paid at most the part's maximum in all");
    expect(points).toContain("charged to their card automatically");
    expect(points).toContain("Emails about payments are always sent the same evening");
  });

  it("callChoiceLine and the stale EXTRA_PAY_CAP_PERCENT mention are gone", async () => {
    expect("callChoiceLine" in (await import("@/lib/server/holds"))).toBe(false);
    expect(fs.readFileSync(path.resolve(__dirname, "../docs/HANDOVER.md"), "utf8")).not.toContain("EXTRA_PAY_CAP_PERCENT");
  });
});

describe("batch 29 §38: a piece's cap is the part's max in all", () => {
  const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
  const more = (testId: string, cookie: string, body: Record<string, unknown>) => act(testId, "pay-extra", cookie, { seenAt: seen(), confirmed: true, payKey: randomUUID(), ...body });
  async function sent(over: Record<string, unknown> = {}) {
    const s = await setup(over);
    const j = await joined(s.testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    return { ...s, ...j, sub: await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } }) };
  }

  it("a $10 written part can be paid up to $1,000 in all: up to $990.00 more after the $10", async () => {
    const R = await import("@/lib/rules");
    const { pieceOf, pieceRoom } = await import("@/lib/server/payments");
    const w = await sent();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "1000.01", tickedCents: 100_001, over200: true })).body.error.message).toBe("This is more than this piece can be paid (up to $1,000).");
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect(await pieceRoom((await pieceOf({ submissionId: w.sub.id }))!)).toMatchObject({ paidCents: 1000, roomCents: 99_000, totalCapCents: 100_000 });
    expect((await more(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "990.01", tickedCents: 99_001, over200: true })).body.error.message).toBe("This is more than this piece can be paid (up to $990 more, $1,000 in all).");
    expect((await more(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "990.00", tickedCents: 99_000, over200: true })).status).toBe(200);
    expect((await more(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "1.00", tickedCents: 100 })).body.error.message).toBe(R.paidMostLine(100_000));
    // The Pay box's hint says the same ("up to $990.00 more ($1,000.00 in all)").
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain("more ? `up to ${money(room.roomCents)} more (${money(total)} in all)` : `up to ${money(room.roomCents)} in all`");
  });

  it("a part listed at the max leaves no Pay more room; an unlisted part is $1,000 in all too", async () => {
    const { pieceOf, pieceRoom } = await import("@/lib/server/payments");
    const top = await sent({ writtenCents: "1000.00", confirmHigh: ["written"] });
    expect((await pay(top.dev.cookie, { kind: "submission", id: top.sub.id, amount: "1000.00", tickedCents: 100_000, over200: true })).status).toBe(200);
    expect(await pieceRoom((await pieceOf({ submissionId: top.sub.id }))!)).toMatchObject({ roomCents: 0, totalCapCents: 100_000 });
    const open = await sent({ writtenCents: null });
    expect(await pieceRoom((await pieceOf({ submissionId: open.sub.id }))!)).toMatchObject({ roomCents: 100_000, totalCapCents: 100_000 });
  });

  it("a listed call: $200 an hour × its measured minutes in all (within the $1,000 for that tester's calls); a dispute's range ends there too", async () => {
    const { pieceOf, pieceRoom, disputeBounds } = await import("@/lib/server/payments");
    const x = await heldCall({ card: false });
    expect((await pay(x.dev.cookie, { kind: "call", id: x.call.id, amount: "15.00", tickedCents: 1500 })).status).toBe(200);
    // 30 minutes at most $200/h: $100 in all, so $85 more.
    expect(await pieceRoom((await pieceOf({ callId: x.call.id }))!)).toMatchObject({ paidCents: 1500, roomCents: 8500, totalCapCents: 10_000 });
    expect((await sact(x.sessionId, "dispute", x.tester.cookie, { kind: "call", id: x.call.id, reason: "The call ran long" })).status).toBe(200);
    expect(await disputeBounds({ submissionId: null, callId: x.call.id })).toMatchObject({ min: 1500, max: 10_000 });
    void makeUser;
  });
});
