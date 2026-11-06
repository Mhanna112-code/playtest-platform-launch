import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import * as R from "@/lib/rules";
import { autoChargeCalls, disputeAmountChanged, payOwed, runDaily, startHold } from "@/lib/server/holds";
import { APPROVED_LINE, approveChargebackHold, approvedNewHoldLine } from "@/lib/server/chargeback";
import { pauseTest, suspendAccount, unpauseTest } from "@/lib/server/restrictions";
import * as PC from "@/lib/server/pauseClosure";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";
import { groupTitle, OUTAGES_GROUP } from "@/lib/bell";

// (Owner, Nov 6, §310) a: a chargeback won after it was repaid sends ONE line; b: the team's pause names the closing date, and the "is paused and closes on"
// line is not also sent; c: a hold-lift approval followed at once by a new hold never says "paused again". (Owner, Nov 6, §311) a: no daily paused reminder (the
// line is sent once per pause); b: the team's lift is a "The team decided" line; c: the bank changing a repaid chargeback's amount is in "Payments and holds".

const DAY = 86_400_000;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const webhook = (type: string, object: Record<string, unknown>) =>
  webhookPOST(new Request("http://localhost:3400/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "t" }, body: JSON.stringify({ type, data: { object } }) }));
const admin = async () => {
  const a = await makeUser({ name: "Admin" });
  return db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
};
afterEach(() => setStripeForTests(null));

describe("§310a a chargeback won after it was repaid: one line", () => {
  it("the line names the win and the refund together (or that it was only recorded)", () => {
    expect(R.chargebackWonRefundLine(1000, " on your $10.00 payment", 2500)).toBe("Your bank's chargeback of $10.00 on your $10.00 payment was reversed in your favour: $25.00 refunded to your card.");
    expect(R.chargebackWonRefundLine(1000, " on your $10.00 payment", 2500, true)).toBe("Your bank's chargeback of $10.00 on your $10.00 payment was reversed in your favour: $25.00 recorded as refunded.");
    expect("chargebackRefundLine" in R).toBe(false);
  });

  it("repaid, then won: one bell line (in Payments and holds), no separate \"Refund:\" line", async () => {
    const s = await setup({ writtenCents: "10.00" });
    const j = await joined(s.testId);
    const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
    await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    setStripeForTests({
      paymentIntents: { create: async (x: { capture_method?: string }) => ({ id: "pi_" + randomUUID(), status: x.capture_method === "manual" ? "requires_capture" : "succeeded" }), capture: async (id: string) => ({ id, status: "succeeded" }) },
      refunds: { create: async () => ({ id: "re_" + randomUUID() }) },
      webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
    } as unknown as Stripe);
    const paid = await reviewPOST(req("/api/review", { cookie: s.dev.cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 } })).then(json);
    expect(paid.status).toBe(200);
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id, status: "charged" } });
    expect((await webhook("charge.dispute.created", { payment_intent: p.stripePaymentIntentId })).status).toBe(200);
    await db.user.update({ where: { id: s.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
    await payOwed(await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } }));
    await approveChargebackHold(s.dev.user.id);
    expect((await webhook("charge.dispute.closed", { payment_intent: p.stripePaymentIntentId, status: "won" })).status).toBe(200);
    const mine = await db.notification.findMany({ where: { userId: s.dev.user.id, text: { contains: "chargeback of $10.00" } } });
    expect(mine).toHaveLength(1);
    expect(mine[0].text).toMatch(/^Your bank's chargeback of \$10\.00 on your \$10\.00 payment for .+ was reversed in your favour: \$25\.00 refunded to your card\.$/);
    expect(mine[0]).toMatchObject({ groupKey: "payhold", link: "/app/payments" });
    expect(await db.notification.count({ where: { userId: s.dev.user.id, text: { startsWith: "Refund:" } } })).toBe(0);
  });
});

describe("§310b the team's pause names the closing date; the paused line isn't also sent", () => {
  it("the developer's line reads like the paused line, and no paused line rings at the pause", async () => {
    const s = await setup();
    await pauseTest((await admin()).id, s.testId, "Checking the build");
    const team = await db.notification.findFirstOrThrow({ where: { userId: s.dev.user.id, text: { startsWith: "The team paused “Harbor Run”" } } });
    expect(team.text).toMatch(/^The team paused “Harbor Run”: it closes on .+ unless the team lifts the pause$/);
    expect(team).toMatchObject({ groupKey: "payhold", mustEmail: true });
    expect(await db.notification.count({ where: { userId: s.dev.user.id, reminderKey: `paused:${s.testId}` } })).toBe(0);
    // The paused line's date and words (closesUnless), 7 days from now; the next day's job doesn't send the paused line either (§311a).
    const at = new Date(Date.now() + 7 * DAY).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    expect([at, new Date(Date.now() + 7 * DAY - DAY).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })].some((d) => team.text.includes(`closes on ${d} unless`))).toBe(true);
    await runDaily(new Date(Date.now() + DAY));
    expect(await db.notification.count({ where: { userId: s.dev.user.id, reminderKey: `paused:${s.testId}` } })).toBe(0);
  });

  it("the team's pause no longer rings the reminder itself", () => {
    const pause = src("lib/server/restrictions.ts");
    const body = pause.slice(pause.indexOf("export async function pauseTest("), pause.indexOf("export const TEAM_PAUSED_EMAIL_LINE"));
    expect(body).not.toContain(".bellPausedTests(");
    expect(body).toContain("closesUnless(dev,");
  });
});

describe("§310c every hold-lift approval reads the same", () => {
  it("a new hold right after the lift: the approval alone, never \"paused again\"", () => {
    expect(approvedNewHoldLine(0)).toBe(`${APPROVED_LINE}.`);
    expect(approvedNewHoldLine(800)).toBe("The team approved lifting your hold: the $8.00 reserved on your card was taken.");
    for (const f of ["lib/server/holds.ts", "lib/server/chargeback.ts"]) {
      const code = src(f).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      expect(code, f).not.toContain("paused again");
      expect(code, f).toContain("approvedNewHoldLine(");
    }
  });
});

describe("§311a no daily paused reminder: the paused line is sent once per pause", () => {
  it("a hold sends it once; the daily job never repeats it; a suspension during the same pause doesn't either", async () => {
    const s = await setup();
    expect("pausedReminders" in PC).toBe(false);
    await startHold(s.dev.user.id, "unpaid");
    const once = () => db.notification.count({ where: { userId: s.dev.user.id, reminderKey: `paused:${s.testId}` } });
    expect(await once()).toBe(1);
    const line = await db.notification.findFirstOrThrow({ where: { userId: s.dev.user.id, reminderKey: `paused:${s.testId}` } });
    expect(line.text).toMatch(/^Harbor Run is paused and closes on .+ unless you pay what you owe$/);
    expect(line).toMatchObject({ groupKey: "pausedreminder" });
    await runDaily(new Date(Date.now() + DAY));
    await runDaily(new Date(Date.now() + 2 * DAY));
    expect(await once()).toBe(1);
    await suspendAccount((await admin()).id, s.dev.user.id, "Checking", "developer");
    expect(await once()).toBe(1);
  });
});

describe("§311b the team's lift is a \"The team decided\" line", () => {
  it("in the admindecision stack, still `always`", async () => {
    const s = await setup();
    const a = await admin();
    await pauseTest(a.id, s.testId, "Checking the build");
    await unpauseTest(s.testId, a.id);
    const lift = await db.notification.findFirstOrThrow({ where: { userId: s.dev.user.id, text: { startsWith: "The team lifted the pause on “Harbor Run”" } } });
    expect(lift).toMatchObject({ groupKey: "admindecision", mustEmail: true });
  });
});

describe("§311c the bank changing a repaid chargeback's amount: in \"Payments and holds\"", () => {
  it("lowered and raised after the repayment are payhold lines, end of day (`always`)", async () => {
    process.env.DISPUTE_WAIT_MS = "0";
    try {
      const s = await setup();
      const j = await joined(s.testId, "Ana Silva");
      const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
      await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
      await settle();
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
      const pi = "pi_" + randomUUID();
      const p = await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: j.sessionId, developerId: s.dev.user.id, testerId: j.tester.user.id, amountCents: 2000, feeCents: 0, testerCents: 0, status: "charged", stripePaymentIntentId: pi, chargeback: "open", chargebackAt: new Date(), reversedCents: 2000 } });
      await db.payment.create({ data: { kind: "chargeback", repaysId: p.id, contractId: p.contractId, developerId: s.dev.user.id, testerId: p.testerId, amountCents: 3500, feeCents: 3500, testerCents: 0, status: "charged", settledAt: new Date() } });
      expect(await disputeAmountChanged(pi, 1200, "under_review")).toBe("followed");
      expect(await disputeAmountChanged(pi, 1600, "under_review")).toBe("followed");
      for (const start of ["Your bank lowered what it took back", "Your bank raised what it took back"]) {
        const l = await db.notification.findFirstOrThrow({ where: { userId: s.dev.user.id, text: { startsWith: start } } });
        expect(l, start).toMatchObject({ groupKey: "payhold", mustEmail: true, payment: true, summarizedAt: null });
      }
    } finally {
      delete process.env.DISPUTE_WAIT_MS;
    }
  });
});

describe("§311d the developer's review reminders reach the end-of-day email whatever the setting", () => {
  it("a review reminder is `always` (Off included), in the unreviewed stack", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    await db.user.update({ where: { id: s.dev.user.id }, data: { emailPref: "off" } });
    const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
    await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const soon = new Date(Date.now() + 5 * DAY);
    await db.test.update({ where: { id: s.testId }, data: { openUntil: soon } });
    await db.contract.updateMany({ where: { testId: s.testId }, data: { dueAt: soon } });
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000), updatedAt: new Date(Date.now() - 14 * DAY) } });
    await runDaily();
    const r = await db.notification.findFirstOrThrow({ where: { userId: s.dev.user.id, reminderKey: `unreviewed:${sub.id}` } });
    expect(r.text).toContain("review Ana Silva's written answers within 1 week");
    expect(r).toMatchObject({ groupKey: "unreviewed", mustEmail: true });
    const code = src("lib/server/holds.ts");
    expect(code.match(/group: "unreviewed", reminder: `unreviewed:\$\{(s|x)\.id\}`, always: true \}/g)).toHaveLength(3);
  });
});

describe("§311e an unlisted call: the listed call's reminders, then closed with nothing paid at its pay date", () => {
  it("unpaid at its pay date: $0 review (final), the event and the developer's line; Pay and Pay more refused; the reminders' tail", async () => {
    expect(R.UNLISTED_CALL_TAIL).toBe(" (it isn't listed: pay any amount, or it closes with nothing paid)");
    expect(src("lib/server/holds.ts")).not.toContain("payYourCalls");
    expect(src("lib/server/holds.ts")).not.toContain("paycalls:");
    const s = await setup({ liveRateCents: null });
    const j = await joined(s.testId, "Ana Silva");
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
    const start = new Date(Date.now() - 8 * DAY);
    await db.call.update({ where: { id: call.id }, data: { startsAt: start, measuredMinutes: 30, measuredAt: new Date(start.getTime() + 30 * 60_000), payBy: new Date(Date.now() - 60_000) } });
    await autoChargeCalls(new Date());
    expect(await db.review.findUniqueOrThrow({ where: { callId: call.id } })).toMatchObject({ amountCents: 0, auto: true, reason: R.UNLISTED_CALL_CLOSED });
    expect(await db.testEvent.count({ where: { testId: s.testId, text: { startsWith: "Ana Silva's call on ", endsWith: " closed with nothing paid" } } })).toBe(1);
    const line = await db.notification.findFirstOrThrow({ where: { userId: s.dev.user.id, text: { endsWith: "closed with nothing paid (it wasn't listed)" } } });
    expect(line.text).toMatch(/^Ana Silva's call on .+ closed with nothing paid \(it wasn't listed\)$/);
    expect(line).toMatchObject({ side: "developer", testId: s.testId, link: `/app/tests/${s.testId}#call-${call.id}` });
    // Final: the developer's Pay and Pay more are refused.
    const paid = await reviewPOST(req("/api/review", { cookie: s.dev.cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, kind: "call", id: call.id, amount: "5.00", tickedCents: 500 } })).then(json);
    expect(paid.status).toBe(409);
    expect(paid.body.error.message).toBe("Ana Silva's call closed with nothing paid: it wasn't listed and wasn't paid within 7 days.");
    const more = await act(s.testId, "pay-extra", s.dev.cookie, { seenAt: seen(), confirmed: true, payKey: randomUUID(), contractId: j.sessionId, callId: call.id, amount: "5.00", tickedCents: 500 });
    expect(more.status).toBe(409);
    // Once only.
    await autoChargeCalls(new Date());
    expect(await db.notification.count({ where: { userId: s.dev.user.id, text: { endsWith: "closed with nothing paid (it wasn't listed)" } } })).toBe(1);
    // Disputable exactly as an unlisted call paid $0 by hand: the admin's bounds are $0 to $100 (30 min × $200/h, within the $1,000 for calls).
    const P = await import("@/lib/server/payments");
    expect(await P.disputeBounds({ submissionId: null, callId: call.id })).toMatchObject({ min: 0, max: 10_000 });
    const d = await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "call", id: call.id, reason: "We talked for the whole half hour", seenAt: seen(), confirmed: true });
    expect(d.status).toBe(200);
  });

  it("the pages: the developer's Pay box note before the date; the tester's paid line reads the closing reason", async () => {
    expect(R.unlistedCloseLine("Nov 5")).toBe("If you don't pay by Nov 5, it closes with nothing paid.");
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain(": unlistedCloseLine(pieceDay(x.x!.payBy, u.timeZone))) : undefined}");
    // The tester's session page shows a $0 review's reason under "Paid $0", as for a listed call's "Closed with nothing to pay."; no Charge (a reviewed call).
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("review.amountCents === 0 && review.reason && !byTesterChoice(review.reason) ? (");
    expect(R.UNLISTED_CALL_CLOSED).toBe("Closed with nothing paid (it wasn't listed).");
  });
});

describe("§311f the outage lines stack into one entry a day", () => {
  it("their group is \"outages\": \"Site down · 2\"", () => {
    expect(OUTAGES_GROUP).toBe("outages");
    expect(groupTitle(OUTAGES_GROUP, 1, 2)).toBe("Site down · 2");
    expect(src("lib/server/outages.ts")).toContain('link: "/app", groupKey: OUTAGES_GROUP }');
  });
});

describe("§311g reminder marks follow the date they count to", () => {
  it("(fake clock) Open until extended after its 1-day heads-up: the new 1 week, 3 days and 1 day heads-ups come", async () => {
    const s = await setup();
    const t0 = Date.now();
    const open = new Date(t0 + 10 * DAY);
    await db.test.update({ where: { id: s.testId }, data: { openUntil: open } });
    const heads = () => db.notification.count({ where: { userId: s.dev.user.id, reminderKey: `headsup:${s.testId}` } });
    await runDaily(new Date(open.getTime() - 0.5 * DAY));
    expect(await heads()).toBe(1); // the 1-day heads-up
    const later = new Date(open.getTime() + 15 * DAY); // (not over a month after the test was made: no 1-month mark)
    await db.test.update({ where: { id: s.testId }, data: { openUntil: later } });
    await runDaily(new Date(open.getTime() - 0.4 * DAY)); // the day of the move: nothing (no stale line)
    expect(await heads()).toBe(1);
    for (const [left, n] of [[6.5, 2], [6.4, 2], [2.5, 3], [0.5, 4], [0.4, 4]] as const) {
      await runDaily(new Date(later.getTime() - left * DAY));
      expect(await heads(), `${left} days before`).toBe(n);
    }
  }, 120_000);

  it("(fake clock) a tester's deadline extended after the review reminder's 1 day: the new date's marks come", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva");
    const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
    await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const t0 = sub.updatedAt.getTime();
    await db.contract.update({ where: { id: j.sessionId }, data: { dueAt: new Date(t0 + 20 * DAY) } });
    const texts = async () => (await db.notification.findMany({ where: { userId: s.dev.user.id, reminderKey: `unreviewed:${sub.id}` }, orderBy: { createdAt: "asc" } })).map((l) => l.text);
    await runDaily(new Date(t0 + 19.5 * DAY));
    expect((await texts()).filter((x) => x.includes(" by tomorrow "))).toHaveLength(1);
    // Extended by 14 days: the review date moves with it.
    await db.contract.update({ where: { id: j.sessionId }, data: { dueAt: new Date(t0 + 34 * DAY) } });
    const before = (await texts()).length;
    for (const d of [19.6, 27.1, 31.1, 33.1]) await runDaily(new Date(t0 + d * DAY));
    const after = (await texts()).slice(before);
    for (const w of ["within 1 week", "within 3 days", "by tomorrow"]) expect(after.filter((x) => x.includes(` ${w} `)), w).toHaveLength(1);
  }, 120_000);

  it("a pause moving the review date: no second line the same day; the marks still ahead come", () => {
    const sent = new Date("2026-11-01T12:00:00Z");
    const D = new Date("2026-11-21T12:00:00Z");
    const at1 = new Date(D.getTime() - 2.5 * DAY);
    const first = R.reviewMarkDue(sent, D, at1, []);
    expect(first.send?.mark).toBe("3d");
    const rec = [...first.record];
    // Paused for a day: the date moves; the same day's run sends nothing.
    const D2 = new Date(D.getTime() + DAY);
    const moved = R.reviewMarkDue(sent, D2, new Date(at1.getTime() + 3_600_000), rec);
    expect(moved.send).toBeNull();
    rec.push(...moved.record);
    expect(R.reviewMarkDue(sent, D2, new Date(D2.getTime() - 0.5 * DAY), rec).send?.mark).toBe("1d");
    // Bare marks from before §311g count as sent for an earlier date.
    expect(R.reviewMarkDue(sent, D, at1, ["1w", "3d"]).send).toBeNull();
    expect(R.openUntilMarkDue({ openUntil: D, createdAt: sent }, ["1w", "3d"], at1).send).toBeNull();
  });

  it("(fake clock) a rejoin with under a day left: her new deadline's 1-day reminder comes, though her earlier stint had one", async () => {
    const s = await setup({ joinMode: "anyone" });
    const j = await joined(s.testId, "Ana Silva");
    const oldDue = new Date(Date.now() + 10 * 3_600_000);
    await db.contract.update({ where: { id: j.sessionId }, data: { dueAt: oldDue } });
    await db.test.update({ where: { id: s.testId }, data: { notifiedMarks: { push: [`${R.deadlineMarkKey(j.sessionId, oldDue)}seen`, `${R.deadlineMarkKey(j.sessionId, oldDue)}1d`] } } });
    expect((await sact(j.sessionId, "leave", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const lv = (await db.test.findUniqueOrThrow({ where: { id: s.testId } })).listingVersion;
    // She asks to rejoin and the developer accepts: the same contract, a fresh deadline.
    expect((await act(s.testId, "rejoin-ask", j.tester.cookie, { listingVersion: lv, seenAt: seen(), confirmed: true, anyway: true })).status).toBe(200);
    await settle();
    const app = await db.application.findFirstOrThrow({ where: { testId: s.testId, testerId: j.tester.user.id } });
    const back = await act(s.testId, "application", s.dev.cookie, { applicationId: app.id, decision: "accept", seenAt: seen(), confirmed: true });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    expect(c.status).toBe("working");
    expect((await db.test.findUniqueOrThrow({ where: { id: s.testId } })).notifiedMarks.filter((x) => x.startsWith(`due:${c.id}:`))).toEqual([]);
    await runDaily(new Date(c.dueAt.getTime() - 12 * 3_600_000));
    expect(await db.notification.count({ where: { userId: j.tester.user.id, reminderKey: `headsup:${s.testId}`, groupKey: "deadlines" } })).toBe(1);
  }, 120_000);
});
