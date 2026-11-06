import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import * as R from "@/lib/rules";
import { payOwed } from "@/lib/server/holds";
import { APPROVED_LINE, approveChargebackHold, approvedNewHoldLine } from "@/lib/server/chargeback";
import { pauseTest } from "@/lib/server/restrictions";
import { pausedReminders } from "@/lib/server/pauseClosure";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 6, §310) a: a chargeback won after it was repaid sends ONE line; b: the team's pause names the closing date, and the daily "is paused and closes on"
// reminder starts with the next day's job; c: a hold-lift approval followed at once by a new hold never says "paused again".

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

describe("§310b the team's pause names the closing date; the daily reminder starts the next day", () => {
  it("the developer's line reads like the daily reminder, and no reminder rings at the pause", async () => {
    const s = await setup();
    await pauseTest((await admin()).id, s.testId, "Checking the build");
    const team = await db.notification.findFirstOrThrow({ where: { userId: s.dev.user.id, text: { startsWith: "The team paused “Harbor Run”" } } });
    expect(team.text).toMatch(/^The team paused “Harbor Run”: it closes on .+ unless the team lifts the pause$/);
    expect(team).toMatchObject({ groupKey: "payhold", mustEmail: true });
    expect(await db.notification.count({ where: { userId: s.dev.user.id, reminderKey: `paused:${s.testId}` } })).toBe(0);
    // The next day's daily job sends the reminder, with the same date and words.
    await pausedReminders(new Date(Date.now() + DAY));
    const reminder = await db.notification.findFirstOrThrow({ where: { userId: s.dev.user.id, reminderKey: `paused:${s.testId}` } });
    expect(reminder.text).toMatch(/^Harbor Run is paused and closes on .+ unless the team lifts the pause$/);
    expect(team.text.slice(team.text.indexOf("closes on "))).toBe(reminder.text.slice(reminder.text.indexOf("closes on ")));
  });

  it("the team's pause no longer rings the reminder itself", () => {
    const pause = src("lib/server/restrictions.ts");
    const body = pause.slice(pause.indexOf("export async function pauseTest("), pause.indexOf("export const TEAM_PAUSED_EMAIL_LINE"));
    expect(body).not.toContain("bellPausedTests");
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
