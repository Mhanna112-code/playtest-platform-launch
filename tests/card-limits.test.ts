import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as cardPOST } from "@/app/api/payments/card/route";
import { POST as verifyPOST } from "@/app/api/payments/verify-card/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { CARD_ATTEMPTS_PER_ACCOUNT, CARD_ATTEMPTS_PER_NETWORK, TOO_MANY_CARD_ATTEMPTS, cardAttempt } from "@/lib/server/cardLimits";
import { chargebackOpened, startHold } from "@/lib/server/holds";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { joined, sact, setup } from "./fixtures";

// (Owner, Nov 2, batch 35 §127) Card attempts: 5 per account and 15 per network in a rolling 24 hours, against card testing.

afterEach(() => setStripeForTests(null));

const ipOf = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
let sessions = 0;
const fakeStripe = () => setStripeForTests({ checkout: { sessions: { create: async () => ({ url: `https://checkout.stripe.test/s${++sessions}` }) } } } as unknown as Stripe);
/** Add a card / Change card: the form POST from the Payments page. */
const addCard = (cookie: string, ip = "") =>
  cardPOST(new Request("http://localhost:3400/api/payments/card", { method: "POST", headers: { cookie, origin: "http://localhost:3400", ...(ip ? { "x-real-ip": ip } : {}) } }));
const cardRows = (userId: string) => db.loginAttempt.count({ where: { kind: "card", email: userId } });

async function chargedBack() {
  const { dev, testId } = await setup();
  await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: null, stripePaymentMethodId: null, cardExpMonth: null, cardExpYear: null } });
  const { tester, sessionId } = await joined(testId);
  await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
  const pi = "pi_" + randomUUID();
  await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 160, testerCents: 640, status: "charged", stripePaymentIntentId: pi } });
  expect(await chargebackOpened(pi)).toBe(true);
  return { dev };
}

describe("card attempts are limited (batch 35 §127)", () => {
  it("Add a card: 5 allowed, the 6th is refused with the line under the button; nothing goes to Stripe", async () => {
    fakeStripe();
    const dev = await makeUser({ dev: true });
    const ip = ipOf();
    for (let i = 0; i < CARD_ATTEMPTS_PER_ACCOUNT; i++) expect((await addCard(dev.cookie, ip)).headers.get("location")).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const before = sessions;
    const refused = await addCard(dev.cookie, ip);
    expect(refused.status).toBe(303);
    expect(refused.headers.get("location")).toBe("http://localhost:3400/app/payments?error=card_limit#card");
    expect(sessions).toBe(before);
    expect(await cardRows(dev.user.id)).toBe(5);
    expect(TOO_MANY_CARD_ATTEMPTS).toBe("Too many card attempts today. Try again tomorrow, or contact us.");
    expect(TOO_MANY_CARD_ATTEMPTS).not.toMatch(/fraud/i);
  });

  it("Verify a card: starting it and each card typed count; the 6th is a 429 with the line; the finish (Cancel this check) doesn't count", async () => {
    const { dev } = await chargedBack();
    const ip = ipOf();
    const press = (body: Record<string, unknown>) => verifyPOST(req("/api/payments/verify-card", { cookie: dev.cookie, body, headers: { "x-real-ip": ip } })).then(json);
    // The stand-in's Cancel (a finish that isn't verified): refused as not verified, never a card attempt.
    expect((await press({ finish: true, setupIntent: "" })).status).toBe(409);
    expect(await cardRows(dev.user.id)).toBe(0);
    for (let i = 0; i < 5; i++) expect((await press({ check: true })).body).toMatchObject({ simulated: true, standIn: true });
    const r = await press({ check: true });
    expect(r.status).toBe(429);
    expect(r.body.error).toMatchObject({ code: "too_many_cards", message: TOO_MANY_CARD_ATTEMPTS });
    // A typed card is refused the same way, before anything is confirmed.
    expect((await press({ setupIntent: "seti_x", paymentMethod: "pm_x" })).status).toBe(429);
    expect(await cardRows(dev.user.id)).toBe(5);
  });

  it("another account on the same network is stopped by the network cap (15 a day); another network isn't", async () => {
    fakeStripe();
    const ip = ipOf();
    for (let a = 0; a < CARD_ATTEMPTS_PER_NETWORK / CARD_ATTEMPTS_PER_ACCOUNT; a++) {
      const dev = await makeUser({ dev: true });
      for (let i = 0; i < 5; i++) expect((await addCard(dev.cookie, ip)).headers.get("location")).toMatch(/^https:\/\/checkout/);
    }
    const fresh = await makeUser({ dev: true });
    expect((await addCard(fresh.cookie, ip)).headers.get("location")).toContain("error=card_limit");
    expect(await cardRows(fresh.user.id)).toBe(0);
    expect((await addCard(fresh.cookie, ipOf())).headers.get("location")).toMatch(/^https:\/\/checkout/);
  });

  it("a day later it works again (rolling 24 hours)", async () => {
    const u = await makeUser({ dev: true });
    const ip = ipOf();
    const start = new Date("2026-11-02T10:00:00Z");
    for (let i = 0; i < 5; i++) await cardAttempt(u.user.id, ip, new Date(start.getTime() + i * 60_000));
    await expect(cardAttempt(u.user.id, ip, new Date(start.getTime() + 23 * 3_600_000))).rejects.toMatchObject({ status: 429, message: TOO_MANY_CARD_ATTEMPTS });
    // 24 hours after the first: that one has dropped out of the window.
    await cardAttempt(u.user.id, ip, new Date(start.getTime() + 24 * 3_600_000 + 1));
    await expect(cardAttempt(u.user.id, ip, new Date(start.getTime() + 24 * 3_600_000 + 2))).rejects.toMatchObject({ status: 429 });
    // A whole day after the last: room again.
    await cardAttempt(u.user.id, ip, new Date(start.getTime() + 48 * 3_600_000));
  });

  it("paying with the saved card (Pay what you owe) isn't counted", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    await startHold(dev.user.id, "unpaid");
    setStripeForTests({ paymentIntents: { create: async () => ({ id: "pi_" + randomUUID(), status: "succeeded" }) } } as unknown as Stripe);
    for (let i = 0; i < 7; i++) await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: {}, headers: { "x-real-ip": "10.9.9.9" } }));
    expect(await cardRows(dev.user.id)).toBe(0);
    expect(await db.loginAttempt.count({ where: { kind: "card", ip: "10.9.9.9" } })).toBe(0);
  });

  it("on a local dev server (no network) the network cap is skipped; the account limit still applies", async () => {
    fakeStripe();
    for (let a = 0; a < 4; a++) {
      const dev = await makeUser({ dev: true });
      for (let i = 0; i < 5; i++) expect((await addCard(dev.cookie)).headers.get("location")).toMatch(/^https:\/\/checkout/);
      expect((await addCard(dev.cookie)).headers.get("location")).toContain("error=card_limit");
    }
    expect(await db.loginAttempt.count({ where: { kind: "card", ip: "" } })).toBeGreaterThanOrEqual(20);
  });
});
