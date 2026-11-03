import React, { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import type Stripe from "stripe";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { POST as cardPOST } from "@/app/api/payments/card/route";
import { POST as payoutPOST } from "@/app/api/payments/payout/route";
import { POST as verifyPOST } from "@/app/api/payments/verify-card/route";
import { owed, retryOwed, startHold } from "@/lib/server/holds";
import { awayAction, expireActions, STALE_CHECK } from "@/lib/server/confirm";
import { dropCheck } from "@/lib/server/owedOnce";
import { savedCardLine } from "@/lib/server/savedCard";
import { cancelSubscription } from "@/lib/server/subscription";
import { ADD_CARD_FIRST, PAYMENTS_OFF, PAYMENTS_PROBLEM, cardSetupUrl, payoutSetupUrl, refreshPayoutStatus, setStripeForTests } from "@/lib/server/stripe";
import { MARKER_KEY, switchStripeMode } from "../scripts/stripe-mode-switch.mjs";
import { json, makeUser, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 2, batch 35 §130) Stripe ids from the other mode (test ids under live keys, or live ids under test keys): Stripe answers resource_missing. A stale id is
// never a decline (no hold, no debt, no retry counted), nothing is charged twice and no record is lost. Live keys without STRIPE_ALLOW_LIVE: "payments_off", the same.
// And the build's mode switch (scripts/stripe-mode-switch.mjs).

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, adminAway() {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/payments", useRouter: () => ({ refresh() {} }), useSearchParams: () => new URLSearchParams() }));
(globalThis as unknown as { React: typeof React }).React = React;

const DAY = 86_400_000;
const env = { key: process.env.STRIPE_SECRET_KEY, allow: process.env.STRIPE_ALLOW_LIVE };
afterEach(() => {
  setStripeForTests(null);
  process.env.STRIPE_SECRET_KEY = env.key ?? "";
  if (env.allow == null) delete process.env.STRIPE_ALLOW_LIVE;
  else process.env.STRIPE_ALLOW_LIVE = env.allow;
});

/** Stripe's resource_missing, as the SDK throws it. */
const missing = (what: string, param: string) => Object.assign(new Error(`No such ${what}: '${what.slice(0, 3)}_test123'`), { type: "StripeInvalidRequestError", rawType: "invalid_request_error", code: "resource_missing", param, raw: { code: "resource_missing", param, message: `No such ${what}` } });

/** A Stripe stand-in where every stored id is unknown (the other mode's), except what it was told is new. */
function liveStripe(opts: { create?: (p: Record<string, unknown>, o?: { idempotencyKey?: string }) => unknown } = {}) {
  const made: { p: Record<string, unknown>; key?: string }[] = [];
  const created = { customers: 0, accounts: 0, sessions: [] as string[], links: [] as string[] };
  setStripeForTests({
    paymentIntents: {
      create: async (p: Record<string, unknown>, o?: { idempotencyKey?: string }) => {
        made.push({ p, key: o?.idempotencyKey });
        if (opts.create) return opts.create(p, o);
        throw missing("customer", "customer");
      },
      retrieve: async () => { throw missing("payment_intent", "intent"); },
      cancel: async () => { throw missing("payment_intent", "intent"); },
      confirm: async () => { throw missing("payment_method", "payment_method"); },
    },
    paymentMethods: { retrieve: async () => { throw missing("payment_method", "payment_method"); } },
    customers: { create: async () => ({ id: `cus_live_${++created.customers}` }), update: async () => { throw missing("customer", "customer"); } },
    checkout: { sessions: { create: async (p: { customer: string }) => { if (!p.customer.startsWith("cus_live_")) throw missing("customer", "customer"); created.sessions.push(p.customer); return { url: "https://checkout.stripe.test/s" }; } } },
    accounts: { create: async () => ({ id: `acct_live_${++created.accounts}` }), retrieve: async () => { throw missing("account", "account"); } },
    accountLinks: { create: async (p: { account: string }) => { if (!p.account.startsWith("acct_live_")) throw missing("account", "account"); created.links.push(p.account); return { url: "https://connect.stripe.test/l" }; } },
    subscriptions: { update: async () => { throw missing("subscription", "subscription"); }, cancel: async () => { throw missing("subscription", "subscription"); } },
    transfers: { create: async () => { throw missing("destination", "destination"); } },
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
  } as unknown as Stripe);
  return { made, created };
}

const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const confirm = (cookie: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, body })).then(json);
const owedPress = (cookie: string, body: Record<string, unknown>) => owedPOST(req("/api/payments/owed", { cookie, body })).then(json);
const userOf = (id: string) => db.user.findUniqueOrThrow({ where: { id } });
const withCard = (id: string) => db.user.update({ where: { id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_" + randomUUID(), cardExpMonth: 12, cardExpYear: 2030 } });
const cardCleared = { stripeCustomerId: null, stripePaymentMethodId: null, cardExpMonth: null, cardExpYear: null };

/** Written answers sent on a test ($10 listed), with a saved (stale) card on the developer and a tester ready for payouts. */
async function sentWork() {
  const s = await setup({ writtenCents: "10.00" });
  const j = await joined(s.testId);
  const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
  await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await withCard(s.dev.user.id);
  await db.user.update({ where: { id: j.tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 12), payoutsReady: true } });
  return { ...s, ...j, sub };
}

describe("§130 a stale customer or card is 'no card saved', never a decline", () => {
  it("Pay: the stale card is cleared, the press says to add a card; nothing owed, no hold, the piece is free again", async () => {
    const w = await sentWork();
    liveStripe();
    const r = await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.body.error).toMatchObject({ code: "no_card", message: ADD_CARD_FIRST });
    expect(await userOf(w.dev.user.id)).toMatchObject({ ...cardCleared, holdStartedAt: null });
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: w.sub.id } });
    expect(p).toMatchObject({ status: "failed", owedUntil: null });
    expect(await owed(w.dev.user.id)).toHaveLength(0);
    expect(await db.review.count({ where: { submissionId: w.sub.id } })).toBe(0);
  });

  it("a tester's Charge: the tester reads the plain problem line, the developer isn't held and owes nothing; the Charge can be pressed again", async () => {
    const w = await sentWork();
    await db.submission.update({ where: { id: w.sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
    liveStripe({ create: async () => { throw missing("payment_method", "payment_method"); } });
    const c = await sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true });
    expect(c.body.error).toMatchObject({ code: "payments_problem", message: PAYMENTS_PROBLEM });
    expect(await userOf(w.dev.user.id)).toMatchObject({ ...cardCleared, holdStartedAt: null });
    expect(await db.payment.count({ where: { submissionId: w.sub.id } })).toBe(0);
    expect(await db.review.count({ where: { submissionId: w.sub.id } })).toBe(0);
  });

  it("a daily retry during a hold on a stale card: not counted as a try, nothing more owed, the stale card cleared", async () => {
    const w = await sentWork();
    const base = { contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, feeCents: 0, testerCents: 0 };
    const debt = await db.payment.create({ data: { ...base, kind: "review", submissionId: w.sub.id, amountCents: 800, status: "failed", owedUntil: new Date() } });
    await startHold(w.dev.user.id, "unpaid");
    const before = await userOf(w.dev.user.id);
    liveStripe();
    expect(await retryOwed(w.dev.user.id)).toMatchObject({ cents: 0 });
    const after = await userOf(w.dev.user.id);
    expect(after).toMatchObject({ ...cardCleared, holdRetries: before.holdRetries });
    expect(after.holdRetryAt?.getTime() ?? null).toBe(before.holdRetryAt?.getTime() ?? null);
    expect(await db.payment.findUniqueOrThrow({ where: { id: debt.id } })).toMatchObject({ status: "failed", coveredById: null });
    expect((await owed(w.dev.user.id)).map((p) => p.id)).toEqual([debt.id]);
    // Pay what you owe now says to add a card (the no-card line), still nothing declined.
    await withCard(w.dev.user.id);
    const r = await owedPress(w.dev.cookie, { seenTotalCents: 800, seenIds: [debt.id] });
    expect(r.body.stillFailing).toEqual([expect.stringContaining(ADD_CARD_FIRST.replace(/\.$/, ""))]);
    expect(await userOf(w.dev.user.id)).toMatchObject(cardCleared);
  });

  it("a tester's payout account unknown to Stripe: cleared, and the charge goes through without it (the share waits); a repeat meets the same charge", async () => {
    const w = await sentWork();
    const st = liveStripe({
      create: async (p, o) => {
        if (p.transfer_data) throw missing("destination", "transfer_data[destination]");
        return { id: "pi_" + o?.idempotencyKey, status: "succeeded" };
      },
    });
    const r = await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.status).toBe(200);
    expect(await userOf(w.tester.user.id)).toMatchObject({ stripeAccountId: null, payoutsReady: false });
    expect(st.made.map((m) => !!m.p.transfer_data)).toEqual([true, false]);
    expect(st.made[1].key).toBe(`${st.made[0].key}-nodest`);
    expect(await db.payment.findFirstOrThrow({ where: { submissionId: w.sub.id, kind: "review" } })).toMatchObject({ status: "charged", transferStatus: "waiting" });
    expect((await userOf(w.dev.user.id)).stripeCustomerId).not.toBeNull(); // the developer's card is fine
  });

  it("Add a card with a stale customer makes a new customer; the Payments line reads no card and offers Add a card", async () => {
    const dev = await makeUser({ dev: true });
    const st = liveStripe();
    expect(await cardSetupUrl(await userOf(dev.user.id), "http://localhost:3400")).toBe("https://checkout.stripe.test/s");
    const u = await userOf(dev.user.id);
    expect(u.stripeCustomerId).toBe(st.created.sessions[0]);
    expect(u).toMatchObject({ stripePaymentMethodId: null, cardExpMonth: null });
    // The Payments card line on a stale card.
    const stale = await withCard(dev.user.id);
    expect(await savedCardLine(stale)).toBe("No card yet.");
    expect(stale.stripePaymentMethodId).toBeNull();
    expect(await userOf(dev.user.id)).toMatchObject(cardCleared);
  });

  it("a payout account unknown to Stripe: refreshing clears it; Connect a payout account makes a new one", async () => {
    const { user } = await makeUser({ tester: true });
    await db.user.update({ where: { id: user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 12), payoutsReady: true } });
    const st = liveStripe();
    expect(await refreshPayoutStatus(user.id)).toBe(false);
    expect(await userOf(user.id)).toMatchObject({ stripeAccountId: null, payoutsReady: false });
    await db.user.update({ where: { id: user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 12) } });
    expect(await payoutSetupUrl(await userOf(user.id), "http://localhost:3400")).toBe("https://connect.stripe.test/l");
    expect((await userOf(user.id)).stripeAccountId).toBe(st.created.links[0]);
  });
});

describe("§130 a PaymentIntent Stripe doesn't know is as good as cancelled, never paid", () => {
  async function awayCharge() {
    const w = await sentWork();
    await db.submission.update({ where: { id: w.sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
    const review = await db.review.create({ data: { submissionId: w.sub.id, contractId: w.sessionId, amountCents: 1000, payKey: "charge:" + randomUUID() } });
    const p = await db.payment.create({ data: { kind: "review", submissionId: w.sub.id, contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_confirmation", payKey: "choice:" + w.sub.id } });
    await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: "pi_test_" + randomUUID(), clientSecret: "" });
    return { ...w, p, review };
  }

  it("dropCheck says 'missing' (never succeeded)", async () => {
    liveStripe();
    expect(await dropCheck("pi_test_x")).toBe("missing");
  });

  it("a charge made while away whose check is unknown: at its time it's closed with nothing charged, never a decline (no hold); its part is unpaid again", async () => {
    const w = await awayCharge();
    liveStripe();
    await db.payment.update({ where: { id: w.p.id }, data: { actionBy: new Date(Date.now() - 1000) } });
    await expireActions();
    expect(await db.payment.findUniqueOrThrow({ where: { id: w.p.id } })).toMatchObject({ status: "cancelled", actionPi: null, failure: STALE_CHECK, owedUntil: null, payKey: null });
    expect((await userOf(w.dev.user.id)).holdStartedAt).toBeNull();
    expect(await db.review.count({ where: { id: w.review.id } })).toBe(0);
    expect(await owed(w.dev.user.id)).toHaveLength(0);
  });

  it("Confirm with your bank on an unknown check: 'cancelled: nothing was charged', closed the same way", async () => {
    const w = await awayCharge();
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_x";
    liveStripe();
    try {
      const r = await confirm(w.dev.cookie, { paymentId: w.p.id, start: true });
      expect(r.body.error).toMatchObject({ code: "cancelled", message: "This payment was cancelled: nothing was charged." });
    } finally {
      process.env.STRIPE_PUBLISHABLE_KEY = "";
    }
    expect(await db.payment.findUniqueOrThrow({ where: { id: w.p.id } })).toMatchObject({ status: "cancelled", actionPi: null });
    expect((await userOf(w.dev.user.id)).holdStartedAt).toBeNull();
  });
});

describe("§130 a subscription Stripe doesn't know ended, as a deleted one does", () => {
  it("Cancel on it ends it now (nothing charged) and forgets the id", async () => {
    const { user } = await makeUser({ dev: true });
    await db.user.update({ where: { id: user.id }, data: { subscriptionStatus: "active", subscriptionId: "sub_test_" + randomUUID(), subscribedAt: new Date(), subscriptionRenewsAt: new Date(Date.now() + 10 * DAY) } });
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    liveStripe();
    expect(await cancelSubscription(await userOf(user.id))).toMatchObject({ cancelled: true });
    expect(await userOf(user.id)).toMatchObject({ subscriptionStatus: "ended", subscriptionEndReason: "cancelled", subscriptionId: null });
  });
});

describe("§130 live keys while payments are switched off (no STRIPE_ALLOW_LIVE)", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_live_fake";
    delete process.env.STRIPE_ALLOW_LIVE;
  });
  const form = (handler: (r: Request) => Promise<Response>, path: string, cookie: string) => handler(new Request(`http://localhost:3400${path}`, { method: "POST", headers: { cookie, origin: "http://localhost:3400" } }));
  const cardRows = (userId: string) => db.loginAttempt.count({ where: { kind: "card", email: userId } });

  it("Add a card and payout setup go back to Payments with the line; not a card attempt", async () => {
    const dev = await makeUser({ dev: true, savedCard: false });
    const r = await form(cardPOST, "/api/payments/card", dev.cookie);
    expect(r.headers.get("location")).toBe("http://localhost:3400/app/payments?error=paused#card");
    expect(await cardRows(dev.user.id)).toBe(0);
    const tester = await makeUser({ tester: true });
    const p = await form(payoutPOST, "/api/payments/payout", tester.cookie);
    expect(p.headers.get("location")).toBe("http://localhost:3400/app/payments?error=paused#payout");
  });

  it("Verify a card says so and isn't a card attempt", async () => {
    const dev = await makeUser({ dev: true });
    const r = await verifyPOST(req("/api/payments/verify-card", { cookie: dev.cookie, body: {} })).then(json);
    expect(r.body.error).toMatchObject({ code: "payments_off", message: PAYMENTS_OFF });
    expect(await cardRows(dev.user.id)).toBe(0);
  });

  it("Pay says so: nothing owed, no hold", async () => {
    const w = await sentWork();
    const r = await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.body.error).toMatchObject({ code: "payments_off", message: PAYMENTS_OFF });
    expect((await userOf(w.dev.user.id)).holdStartedAt).toBeNull();
    expect(await owed(w.dev.user.id)).toHaveLength(0);
    expect((await userOf(w.dev.user.id)).stripeCustomerId).not.toBeNull(); // the card is kept
  });

  it("Pay what you owe says so, and a daily retry isn't counted", async () => {
    const w = await sentWork();
    const base = { contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, feeCents: 0, testerCents: 0 };
    const debt = await db.payment.create({ data: { ...base, kind: "review", submissionId: w.sub.id, amountCents: 800, status: "failed", owedUntil: new Date() } });
    await startHold(w.dev.user.id, "unpaid");
    const r = await owedPress(w.dev.cookie, { seenTotalCents: 800, seenIds: [debt.id] });
    expect(r.body.stillFailing).toEqual([expect.stringContaining(PAYMENTS_OFF.replace(/\.$/, ""))]);
    const before = (await userOf(w.dev.user.id)).holdRetries;
    await retryOwed(w.dev.user.id);
    expect((await userOf(w.dev.user.id)).holdRetries).toBe(before);
    expect(await db.payment.findUniqueOrThrow({ where: { id: debt.id } })).toMatchObject({ status: "failed", coveredById: null });
  });
});

describe("§130 after the switch: the normal Add a card / Connect a payout account", () => {
  function section(node: ReactNode, id: string): ReactElement | undefined {
    if (Array.isArray(node)) return node.map((n) => section(n, id)).find(Boolean);
    if (!isValidElement(node)) return;
    const e = node as ReactElement<{ id?: string; children?: ReactNode }>;
    return e.props.id === id ? e : section(e.props.children, id);
  }
  it("a developer whose card was cleared sees Add a card; a tester whose account was cleared sees Connect a payout account", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    liveStripe();
    const { default: Page } = await import("@/app/app/payments/page");
    const dev = await makeUser({ dev: true });
    auth.user = await userOf(dev.user.id); // still holds the stale card: the page's read clears it
    const html = renderToStaticMarkup(section(await Page({ searchParams: Promise.resolve({}) }), "card")!);
    expect(html).toContain("No card yet.");
    expect(html).toContain("Add a card");
    expect(html).not.toContain("Change card");
    const tester = await makeUser({ tester: true });
    auth.user = await userOf(tester.user.id);
    const page = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(page).toContain("Connect a payout account");
    // The paused line for a form post while payments are switched off.
    auth.user = await userOf(dev.user.id);
    expect(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ error: "paused" }) }))).toContain(PAYMENTS_OFF);
  });
});

describe("§130 the build's Stripe mode switch (scripts/stripe-mode-switch.mjs)", () => {
  const logs: string[] = [];
  const log = (s: string) => logs.push(s);
  const marker = () => db.appState.findUnique({ where: { key: MARKER_KEY } });
  beforeEach(async () => {
    logs.length = 0;
    await db.appState.deleteMany({ where: { key: MARKER_KEY } });
  });
  afterAll(() => db.appState.deleteMany({ where: { key: MARKER_KEY } }));

  /** Pre-switch data: ids and open Stripe objects made in the old mode. */
  async function oldModeData() {
    const w = await sentWork();
    const base = { contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, feeCents: 0, testerCents: 0 };
    await db.user.update({ where: { id: w.dev.user.id }, data: { subscriptionStatus: "active", subscriptionId: "sub_" + randomUUID(), subscribedAt: new Date(), chargebackCardVerifiedAt: new Date() } });
    // A tester's Charge waiting for the bank (its review), a debt with its own check, a debt plain, Pay what you owe's one payment at the bank covering a debt.
    const review = await db.review.create({ data: { submissionId: w.sub.id, contractId: w.sessionId, amountCents: 1000, payKey: "charge:" + randomUUID() } });
    const away = await db.payment.create({ data: { ...base, kind: "review", submissionId: w.sub.id, amountCents: 1000, status: "needs_confirmation", payKey: "choice:" + w.sub.id, actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + DAY) } });
    const debtCheck = await db.payment.create({ data: { ...base, kind: "dispute", amountCents: 300, status: "failed", owedUntil: new Date(), failure: "Your card was declined.", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + DAY) } });
    const one = await db.payment.create({ data: { ...base, testerId: w.dev.user.id, kind: "owed", amountCents: 500, status: "needs_confirmation", note: "away", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + DAY) } });
    const covered = await db.payment.create({ data: { ...base, kind: "call", amountCents: 500, status: "owed", coveredById: one.id } });
    const plain = await db.payment.create({ data: { ...base, kind: "review", amountCents: 200, status: "failed", owedUntil: new Date() } });
    const shared = await db.payment.create({ data: { ...base, kind: "review", amountCents: 900, testerCents: 720, status: "charged", stripePaymentIntentId: "pi_" + randomUUID(), transferStatus: "waiting" } });
    const reservation = await db.reservation.create({ data: { developerId: w.dev.user.id, amountCents: 800, covers: [plain.id], status: "reserved", stripePaymentIntentId: "pi_" + randomUUID(), expiresAt: new Date(Date.now() + 5 * DAY) } });
    await db.appState.upsert({ where: { key: "stripe-sub-product" }, create: { key: "stripe-sub-product", value: "prod_x" }, update: { value: "prod_x" } });
    return { ...w, review, away, debtCheck, one, covered, plain, shared, reservation };
  }
  const snapshot = async (d: Awaited<ReturnType<typeof oldModeData>>) => ({
    dev: await userOf(d.dev.user.id),
    tester: await userOf(d.tester.user.id),
    pays: Object.fromEntries(await Promise.all((["away", "debtCheck", "one", "covered", "plain", "shared"] as const).map(async (k) => [k, await db.payment.findUnique({ where: { id: d[k].id } })]))),
    reservation: await db.reservation.findUniqueOrThrow({ where: { id: d.reservation.id } }),
  });

  it("no key, or a test key with nothing stored (everything so far was test mode): nothing changes", async () => {
    const d = await oldModeData();
    const before = await snapshot(d);
    expect(await switchStripeMode({ db, env: {}, log })).toMatchObject({ ran: false, reason: "no_key" });
    expect(await switchStripeMode({ db, env: { STRIPE_SECRET_KEY: "sk_test_fake" }, log })).toMatchObject({ ran: false, reason: "same_mode" });
    expect(await snapshot(d)).toEqual(before);
    expect(await marker()).toBeNull();
  });

  it("test -> live: clears every id, closes what was open with nothing charged, keeps what's owed owed, stores the mode; a second run does nothing", async () => {
    const d = await oldModeData();
    const now = new Date();
    const r = await switchStripeMode({ db, env: { STRIPE_SECRET_KEY: "sk_live_fake" }, log, now });
    expect(r).toMatchObject({ ran: true, from: "test", to: "live" });
    expect(JSON.parse((await marker())!.value)).toEqual({ mode: "live", switchedAt: now.toISOString() });
    const s = await snapshot(d);
    expect(s.dev).toMatchObject({ ...cardCleared, subscriptionId: null, subscriptionStatus: "ended", subscriptionEndReason: "cancelled", chargebackCardVerifiedAt: null, holdStartedAt: null });
    expect(s.tester).toMatchObject({ stripeAccountId: null, payoutsReady: false });
    // The tester's Charge at the bank: cancelled, nothing charged, its part unpaid again (the review goes); never owed.
    expect(s.pays.away).toMatchObject({ status: "cancelled", actionPi: null, actionBy: null, failure: STALE_CHECK, owedUntil: null, payKey: null });
    expect(await db.review.count({ where: { id: d.review.id } })).toBe(0);
    // A debt with its own check: still owed, its failure kept, only the check goes.
    expect(s.pays.debtCheck).toMatchObject({ status: "failed", actionPi: null, failure: "Your card was declined." });
    // Pay what you owe's one payment: cancelled; what it covered is owed again.
    expect(s.pays.one).toMatchObject({ status: "cancelled", actionPi: null });
    expect(s.pays.covered).toMatchObject({ status: "owed", coveredById: null });
    expect(s.pays.plain).toMatchObject({ status: "failed" });
    // A share waiting on a test charge: closed, never marked sent or paid again.
    expect(s.pays.shared).toMatchObject({ status: "charged", transferStatus: "closed" });
    expect(s.reservation).toMatchObject({ status: "cancelled", endedAt: now });
    expect(await db.appState.findUnique({ where: { key: "stripe-sub-product" } })).toBeNull();
    // Counts only in the log: no ids, no emails.
    expect(logs.at(-1)).toMatch(/^\[stripe-mode\] switched from test to live: /);
    expect(logs.join("\n")).not.toMatch(/pi_|cus_|acct_|@/);
    // Idempotent.
    const after = await snapshot(d);
    expect(await switchStripeMode({ db, env: { STRIPE_SECRET_KEY: "sk_live_other" }, log })).toMatchObject({ ran: false, reason: "same_mode" });
    expect(await snapshot(d)).toEqual(after);
  });

  it("live -> test: the live ids are cleared the same way and the mode goes back to test", async () => {
    await db.appState.create({ data: { key: MARKER_KEY, value: JSON.stringify({ mode: "live", switchedAt: new Date(Date.now() - DAY).toISOString() }) } });
    const d = await oldModeData();
    const r = await switchStripeMode({ db, env: { STRIPE_SECRET_KEY: "sk_test_fake" }, log });
    expect(r).toMatchObject({ ran: true, from: "live", to: "test" });
    expect(JSON.parse((await marker())!.value).mode).toBe("test");
    const s = await snapshot(d);
    expect(s.dev).toMatchObject(cardCleared);
    expect(s.tester).toMatchObject({ stripeAccountId: null, payoutsReady: false });
    expect(s.pays.away).toMatchObject({ status: "cancelled" });
    expect(s.reservation).toMatchObject({ status: "cancelled" });
    // And back to live once more: runs again.
    await withCard(d.dev.user.id);
    expect(await switchStripeMode({ db, env: { STRIPE_SECRET_KEY: "sk_live_fake" }, log })).toMatchObject({ ran: true, from: "test", to: "live" });
    expect(await userOf(d.dev.user.id)).toMatchObject(cardCleared);
  });

  it("the build runs it after the migrations, before next build", async () => {
    const pkg = JSON.parse((await import("node:fs")).readFileSync("package.json", "utf8"));
    expect(pkg.scripts["vercel-build"]).toMatch(/prisma migrate deploy && node scripts\/stripe-mode-switch\.mjs && next build/);
  });
});

