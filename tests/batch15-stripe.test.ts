import { afterEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import { payoutReadyOf, refreshPayoutStatus, setStripeForTests } from "@/lib/server/stripe";
import { makeUser, uniq } from "./helpers";

// Batch 15 sections 4 and 5: payout readiness (transfers-only Express accounts) and the Connect webhook's own signing secret.
afterEach(() => {
  setStripeForTests(null);
  delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
});

const signed = (payload: string, secret: string) => Stripe.webhooks.generateTestHeaderString({ payload, secret });
const post = (payload: string, signature: string) =>
  webhookPOST(new Request("http://localhost:3400/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": signature }, body: payload }));

describe("payout readiness (section 4)", () => {
  it("ready = payouts on and the transfers capability active; charges_enabled doesn't matter", () => {
    expect(payoutReadyOf({ payouts_enabled: true, capabilities: { transfers: "active" } })).toBe(true); // transfers-only, charges off
    expect(payoutReadyOf({ payouts_enabled: false, capabilities: { transfers: "active" } })).toBe(false); // payouts off
    expect(payoutReadyOf({ payouts_enabled: true, capabilities: { transfers: "pending" } })).toBe(false); // transfers pending
    expect(payoutReadyOf({ payouts_enabled: true })).toBe(false);
  });
  it("refreshPayoutStatus uses the rule with Stripe's account object", async () => {
    const { user } = await makeUser({ tester: true });
    const acct = "acct_" + uniq();
    await db.user.update({ where: { id: user.id }, data: { stripeAccountId: acct } });
    let obj: Record<string, unknown> = { id: acct, payouts_enabled: true, charges_enabled: false, capabilities: { transfers: "active" } };
    setStripeForTests({ accounts: { retrieve: async () => obj } } as unknown as Stripe);
    expect(await refreshPayoutStatus(user.id)).toBe(true);
    obj = { id: acct, payouts_enabled: true, charges_enabled: true, capabilities: { transfers: "pending" } };
    expect(await refreshPayoutStatus(user.id)).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).payoutsReady).toBe(false);
  });
});

describe("Connect webhook secret (section 5)", () => {
  it("accepts an event signed with either secret, and refuses a wrong one with 400", async () => {
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_connect_test";
    const { user } = await makeUser({ tester: true });
    const acct = "acct_" + uniq();
    await db.user.update({ where: { id: user.id }, data: { stripeAccountId: acct } });
    const ev = (ready: boolean) => JSON.stringify({ id: "evt_" + uniq(), type: "account.updated", account: acct, data: { object: { id: acct, payouts_enabled: ready, details_submitted: true, capabilities: { transfers: ready ? "active" : "inactive" } } } });
    // The platform endpoint's secret (vitest sets STRIPE_WEBHOOK_SECRET=whsec_test).
    const a = ev(false);
    expect((await post(a, signed(a, "whsec_test"))).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).payoutProblemAt).not.toBeNull();
    // The Connect endpoint's secret.
    const b = ev(true);
    expect((await post(b, signed(b, "whsec_connect_test"))).status).toBe(200);
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(u.payoutsReady).toBe(true);
    expect(u.payoutProblemAt).toBeNull();
    // A wrong secret: 400, nothing runs.
    const c = ev(false);
    expect((await post(c, signed(c, "whsec_wrong"))).status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).payoutsReady).toBe(true);
  });
});
