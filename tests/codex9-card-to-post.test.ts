import { afterEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { POST as keptPOST } from "@/app/api/kept/route";
import { GetStarted } from "@/app/app/GetStarted";
import { cardExpiryReminders, setStripeForTests } from "@/lib/server/stripe";
import { sendSummaries } from "@/lib/server/notify";
import { json, makeUser, req } from "./helpers";
import { listingBody, setup } from "./fixtures";

afterEach(() => setStripeForTests(null));

describe("Batch 34 §6: a card before posting, expiry warnings, Get started", () => {
  it("keeps an unsent form without a card, refuses Post with a Payments link, and posts after a card is saved", async () => {
    const dev = await makeUser({ dev: true, savedCard: false });
    const draft = await keptPOST(req("/api/kept", { cookie: dev.cookie, body: { key: "test:draft:new", data: listingBody() } })).then(json);
    expect(draft.status).toBe(200);
    const refused = await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody() })).then(json);
    expect(refused.status).toBe(402);
    expect(refused.body.error).toMatchObject({ code: "card_required", message: "Add a card in Payments before posting: testers' pay is charged to it.", link: "/app/payments" });
    await db.user.update({ where: { id: dev.user.id }, data: { stripePaymentMethodId: "pm_test_saved", cardExpMonth: 12, cardExpYear: 2030 } });
    expect((await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody() })).then(json)).status).toBe(200);
  });

  it("treats Stripe resource_missing as the usual declined-card hold with the amount owed", async () => {
    const { POST: reviewPOST } = await import("@/app/api/review/route");
    const { joined, sact, seen } = await import("./fixtures");
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["answer", "answer"], seenAt: seen(), confirmed: true });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const { randomUUID } = await import("node:crypto");
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: `cus_${randomUUID()}`, stripePaymentMethodId: "pm_gone" } });
    setStripeForTests({ paymentIntents: { create: async () => { throw Object.assign(new Error("No such payment_method: pm_gone"), { type: "StripeInvalidRequestError", code: "resource_missing" }); } } } as unknown as Stripe);
    const result = await reviewPOST(req("/api/review", { cookie: dev.cookie, body: { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, payKey: randomUUID(), seenAt: seen() } })).then(json);
    expect(result.status).toBe(402);
    expect(await db.payment.findFirstOrThrow({ where: { submissionId: sub.id } })).toMatchObject({ status: "failed", amountCents: 1000, failure: "No card is saved on this account." });
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).not.toBeNull();
  });

  it("sends the 30-day, 7-day and expiry-day lines once each and refreshes expiry from Stripe", async () => {
    const user = await makeUser({ dev: true });
    await db.user.update({ where: { id: user.user.id }, data: { stripePaymentMethodId: "pm_expiring", cardExpMonth: 1, cardExpYear: 2027, emailPref: "off" } });
    setStripeForTests({ paymentMethods: { retrieve: async () => ({ id: "pm_expiring", card: { last4: "4242", exp_month: 2, exp_year: 2027 } }) } } as unknown as Stripe);
    const expireAt = new Date("2027-02-28T00:00:00.000Z");
    const thirty = new Date("2027-01-29T12:00:00.000Z");
    const seven = new Date("2027-02-21T12:00:00.000Z");
    await cardExpiryReminders(thirty);
    await sendSummaries(thirty);
    await cardExpiryReminders(thirty);
    await cardExpiryReminders(seven);
    await sendSummaries(seven);
    await cardExpiryReminders(expireAt);
    await sendSummaries(expireAt);
    const rows = await db.notification.findMany({ where: { userId: user.user.id, reminderKey: { startsWith: "card-expiry:" } } });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.text)).toEqual(Array(3).fill("Your card ending 4242 expires at the end of February: update it in Payments."));
    expect(rows.every((r) => r.payment && r.link === "/app/payments")).toBe(true);
    const mails = await db.outboxEmail.findMany({ where: { to: user.user.email } });
    expect(mails).toHaveLength(3);
    expect(mails.every((m) => m.text.includes("Your card ending 4242 expires at the end of February: update it in Payments."))).toBe(true);
    expect(await db.user.findUniqueOrThrow({ where: { id: user.user.id } })).toMatchObject({ cardExpMonth: 2, cardExpYear: 2027 });
  });

  it("shows side-specific Get started text and link, a check when done, and no box when all steps are done", async () => {
    const render = (steps: { label: string; done: boolean }[]) => renderToStaticMarkup(createElement(GetStarted, { steps }));
    expect(render([{ label: "Add a card (needed to post a test)", done: false }])).toContain("/app/payments");
    expect(render([{ label: "Add a card (needed to post a test)", done: false }])).toContain("Add a card (needed to post a test)");
    expect(render([{ label: "Set up payouts (to receive your pay)", done: false }])).toContain("Set up payouts (to receive your pay)");
    expect(render([{ label: "Add a card (needed to post a test)", done: true }, { label: "Set up payouts (to receive your pay)", done: false }])).toContain("✓ Add a card");
    const complete = render([{ label: "Add a card (needed to post a test)", done: true }]);
    expect(complete).toContain("✓ Add a card (needed to post a test)");
    expect(complete).not.toContain("data-get-started=\"\"");
  });

  it("puts the card prompt by Post and uses account state for both Get started sides", async () => {
    const { readFileSync } = await import("node:fs");
    const form = readFileSync("src/app/app/tests/TestForm.tsx", "utf8");
    const dashboard = readFileSync("src/app/app/page.tsx", "utf8");
    expect(form).toContain("Posting needs a card in Payments.");
    expect(dashboard).toContain("Set up payouts (to receive your pay)");
    expect(dashboard).toContain("Add a card (needed to post a test)");
  });
});
