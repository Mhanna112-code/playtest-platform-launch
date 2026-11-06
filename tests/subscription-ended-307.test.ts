import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { POST as subPOST } from "@/app/api/payments/subscription/route";
import * as S from "@/lib/subscription";
import { freeLaunchNotices, renewSubscriptions, subscriptionWebhook } from "@/lib/server/subscription";
import { sendSummaries } from "@/lib/server/notify";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, listingBody, seen } from "./fixtures";

// (Owner, Nov 6, §307) "Your subscription ended: …" on the day it actually ends (the developer's own cancel, Stripe ending it), and "Free during launch ended: …"
// when the free launch ends: ONE bell line (always, in the subscription's "Payments and holds" stack, linking to the subscription) and its line in that day's
// email, never twice for the same end. The presses that need a subscription stay refused as before.

const DAY = 86_400_000;
afterEach(async () => {
  setStripeForTests(null);
  delete process.env.FREE_UNTIL;
  await db.appState.deleteMany({ where: { key: { in: ["free-until", "free-told-30", "free-told-7", "free-ended"] } } });
  await db.user.updateMany({ where: { email: { endsWith: "@test.playtest.test" }, subscriptionStatus: { in: ["active", "past_due"] } }, data: { subscriptionStatus: "ended", subscriptionEndReason: "cancelled" } });
});
const freeOver = () => { process.env.FREE_UNTIL = new Date(Date.now() - DAY).toISOString(); };
const sub = (cookie: string, action: string) => subPOST(req("/api/payments/subscription", { cookie, body: { action } })).then(json);
const ok = () => setStripeForTests({ paymentIntents: { create: async () => ({ id: "pi_" + randomUUID(), status: "succeeded" }) } } as unknown as Stripe);
const lines = (userId: string, text: string) => db.notification.findMany({ where: { userId, text } });
const mails = (to: string) => db.outboxEmail.findMany({ where: { to }, orderBy: { createdAt: "asc" } });

async function subscriber(emailPref = "daily") {
  const dev = await makeUser({ dev: true, name: "Nora Lane" });
  await db.user.update({ where: { id: dev.user.id }, data: { emailPref } });
  ok();
  expect((await sub(dev.cookie, "subscribe")).status).toBe(200);
  setStripeForTests(null);
  return dev;
}

describe("§307 the subscription ended, on the day it ends", () => {
  it("the developer's own cancel: one bell line and one email line on the day it ends (even with email Off), never twice; Next round is still refused", async () => {
    freeOver();
    const dev = await subscriber("off");
    const t = await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ title: `Harbor Run ${randomUUID().slice(0, 6)}` }) })).then(json);
    expect(t.status).toBe(200);
    expect((await sub(dev.cookie, "cancel")).status).toBe(200);
    expect(await lines(dev.user.id, S.SUBSCRIPTION_ENDED_LINE)).toHaveLength(0); // not before it ends
    await db.user.update({ where: { id: dev.user.id }, data: { subscriptionRenewsAt: new Date(Date.now() - 1000) } });
    expect((await renewSubscriptions(new Date(), [dev.user.id])).ended).toBe(1);
    const [n] = await lines(dev.user.id, S.SUBSCRIPTION_ENDED_LINE);
    expect(S.SUBSCRIPTION_ENDED_LINE).toBe("Your subscription ended: you're on the free plan now, which runs one open test at a time.");
    expect(n).toMatchObject({ link: "/app/payments#subscription", mustEmail: true, payment: true, groupKey: "payhold", side: "developer" });
    // Never twice: the job again, and Stripe's end arriving for an end already made.
    expect((await renewSubscriptions(new Date(), [dev.user.id])).ended).toBe(0);
    await db.user.update({ where: { id: dev.user.id }, data: { subscriptionId: `sub_${randomUUID()}` } });
    await subscriptionWebhook("customer.subscription.deleted", { id: (await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).subscriptionId! });
    expect(await lines(dev.user.id, S.SUBSCRIPTION_ENDED_LINE)).toHaveLength(1);
    // That day's email (email Off: the end-of-day email), once.
    await sendSummaries(new Date(), [dev.user.id]);
    await sendSummaries(new Date(), [dev.user.id]);
    const withLine = (await mails(dev.user.email)).filter((m) => m.text.includes(S.SUBSCRIPTION_ENDED_LINE));
    expect(withLine).toHaveLength(1);
    expect(withLine[0].text).toContain("/app/payments#subscription");
    // The presses that need a subscription are refused exactly as before.
    expect((await act(t.body.id, "next-round", dev.cookie, { seenAt: seen(), confirmed: true })).body.error).toMatchObject({ code: "subscription", message: "Next round needs a subscription ($7/month)." });
  });

  it("Stripe ending a subscription (not past due) gives the same one line, once", async () => {
    freeOver();
    const dev = await subscriber();
    const id = `sub_${randomUUID()}`;
    await db.user.update({ where: { id: dev.user.id }, data: { subscriptionId: id } });
    await subscriptionWebhook("customer.subscription.deleted", { id });
    await subscriptionWebhook("customer.subscription.deleted", { id });
    expect(await lines(dev.user.id, S.SUBSCRIPTION_ENDED_LINE)).toHaveLength(1);
  });

  it("the free launch ending: one bell line and one email line to a developer without a subscription, never twice; a perk is refused after it", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    const first = await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ title: `Harbor Run ${randomUUID().slice(0, 6)}` }) })).then(json);
    expect(first.status).toBe(200);
    process.env.FREE_UNTIL = new Date(Date.now() - 1000).toISOString();
    expect(await freeLaunchNotices()).toBeGreaterThanOrEqual(1);
    expect(await freeLaunchNotices()).toBe(0);
    const got = await lines(dev.user.id, S.FREE_LAUNCH_ENDED_LINE);
    expect(S.FREE_LAUNCH_ENDED_LINE).toBe("Free during launch ended: you're on the free plan now, which runs one open test at a time.");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ link: "/app/payments#subscription", mustEmail: true, payment: true, groupKey: "payhold", side: "developer" });
    await sendSummaries(new Date(), [dev.user.id]);
    await sendSummaries(new Date(), [dev.user.id]);
    expect((await mails(dev.user.email)).filter((m) => m.text.includes(S.FREE_LAUNCH_ENDED_LINE))).toHaveLength(1);
    // A second open test is refused as before.
    expect((await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ title: `Harbor Run ${randomUUID().slice(0, 6)}` }) })).then(json)).body.error.message).toBe(S.SECOND_TEST_LINE);
  });

  it("a subscription that ends the same day as the free launch: one line, not two", async () => {
    freeOver();
    const dev = await subscriber();
    await sub(dev.cookie, "cancel");
    await db.user.update({ where: { id: dev.user.id }, data: { subscriptionRenewsAt: new Date(Date.now() - 1000) } });
    await renewSubscriptions(new Date(), [dev.user.id]);
    process.env.FREE_UNTIL = new Date(Date.now() - 1000).toISOString();
    await freeLaunchNotices();
    expect(await lines(dev.user.id, S.SUBSCRIPTION_ENDED_LINE)).toHaveLength(1);
    expect(await lines(dev.user.id, S.FREE_LAUNCH_ENDED_LINE)).toHaveLength(0);
  });
});
