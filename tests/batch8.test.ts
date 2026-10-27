import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { POST as subPOST } from "@/app/api/payments/subscription/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import * as S from "@/lib/subscription";
import { chargebackOpened, liftHoldIfClear, owed, payOwed, startHold } from "@/lib/server/holds";
import { deleteAccount, reinstateAccount } from "@/lib/server/restrictions";
import { freeLaunchNotices, hasPerks, LAPSED_LINE, launchState, renewSubscriptions, setFreeUntil, subscriptionWebhook } from "@/lib/server/subscription";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, listingBody, seen, settle } from "./fixtures";

// Batch 8 (owner, Oct 28): the developer subscription, $7/month.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const DAY = 86_400_000;
const KEYS = ["free-until", "free-told-30", "free-told-7", "free-ended"];
afterEach(async () => {
  setStripeForTests(null);
  // The free-during-launch setting is shared by every test file: always leave it as it was (no row: free with no end).
  await db.appState.deleteMany({ where: { key: { in: KEYS } } });
  // Nobody made here keeps a running subscription for later runs' daily jobs.
  await db.user.updateMany({ where: { email: { endsWith: "@test.playtest.test" }, subscriptionStatus: { in: ["active", "past_due"] } }, data: { subscriptionStatus: "ended", subscriptionEndReason: "cancelled" } });
});
/** Free during launch is over (the perks need a subscription). */
const freeOver = () => db.appState.upsert({ where: { key: "free-until" }, update: { value: new Date(Date.now() - DAY).toISOString() }, create: { key: "free-until", value: new Date(Date.now() - DAY).toISOString() } });
const sub = (cookie: string, action: string) => subPOST(req("/api/payments/subscription", { cookie, body: { action } })).then(json);
const post = (cookie: string, over: Record<string, unknown> = {}) => testsPOST(req("/api/tests", { cookie, body: listingBody(over) })).then(json);
const adm = (action: string, cookie: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const ok = () => setStripeForTests({ paymentIntents: { create: async () => ({ id: "pi_" + randomUUID(), status: "succeeded" }) } } as unknown as Stripe);
const decline = () => setStripeForTests({ paymentIntents: { create: async () => { throw new Error("declined"); } } } as unknown as Stripe);
const withCard = (userId: string) => db.user.update({ where: { id: userId }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
const userOf = (id: string) => db.user.findUniqueOrThrow({ where: { id } });
/** A developer with a saved card, subscribed (charged through the tests' Stripe stand-in). */
async function subscriber() {
  const dev = await makeUser({ dev: true, name: "Nora Lane" });
  await withCard(dev.user.id);
  ok();
  expect((await sub(dev.cookie, "subscribe")).status).toBe(200);
  setStripeForTests(null);
  return dev;
}

describe("batch 8: the rules", () => {
  it("$7/month in one constant; monthly from the sign-up day, the 31st on the last day of shorter months; the perk lines", () => {
    expect(S.SUBSCRIPTION_CENTS).toBe(700);
    expect(S.SUBSCRIPTION_PRICE).toBe("$7/month");
    expect(S.periodEnd(new Date("2026-01-31T10:00:00Z"), new Date("2026-02-01T00:00:00Z")).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(S.periodEnd(new Date("2026-01-31T10:00:00Z"), new Date("2026-03-01T00:00:00Z")).toISOString()).toBe("2026-03-31T10:00:00.000Z");
    expect(S.periodEnd(new Date("2026-01-15T10:00:00Z"), new Date("2026-01-20T00:00:00Z")).toISOString()).toBe("2026-02-15T10:00:00.000Z");
    expect(S.perkLine("approved")).toBe("Approved-only testers need a subscription ($7/month).");
    expect(S.perkLine("nextRound")).toBe("Next round needs a subscription ($7/month).");
    expect(S.perkLine("invite")).toBe("Inviting testers needs a subscription ($7/month).");
    expect(S.perkLine("several")).toBe("Running several open tests needs a subscription ($7/month).");
    expect(S.SECOND_TEST_LINE).toBe("You already have an open test. Subscribe ($7/month) to run several at once.");
    expect(S.launchFrom(null)).toEqual({ free: true, until: null });
    expect(S.launchFrom("")).toEqual({ free: true, until: null });
    expect(S.launchFrom(new Date(Date.now() + DAY).toISOString()).free).toBe(true);
    expect(S.launchFrom(new Date(Date.now() - DAY).toISOString()).free).toBe(false);
  });
});

describe("batch 8 items 1-2: the free plan and the perks", () => {
  it("one open test at a time (Open, Full and Paused count; Draft, Stopped and Closed don't); the second Post is refused with a Payments link", async () => {
    await freeOver();
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    const first = await post(dev.cookie);
    expect(first.status).toBe(200);
    const second = await post(dev.cookie);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({ code: "subscription", message: S.SECOND_TEST_LINE });
    expect(S.isPerkRefusal(second.body.error.message)).toBe(true);
    expect(src("components/Err.tsx")).toContain("<SubscribeLink />");
    expect(src("components/SubscribeLink.tsx")).toContain('target="_blank"');
    // A paused test still counts; a stopped or closed one doesn't.
    await db.test.update({ where: { id: first.body.id }, data: { adminPausedAt: new Date() } });
    expect((await post(dev.cookie)).status).toBe(409);
    await db.test.update({ where: { id: first.body.id }, data: { adminPausedAt: null, status: "closed" } });
    expect((await post(dev.cookie)).status).toBe(200);
  });

  it("the perks on the free plan are refused, each naming itself; existing uses carry on", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    // Made during the free launch: an Approved-only test.
    const t = await post(dev.cookie, { joinMode: "apply" });
    expect(t.status).toBe(200);
    await freeOver();
    expect((await post(dev.cookie, { joinMode: "apply" })).body.error.message).toMatch(/You already have an open test/);
    await db.test.update({ where: { id: t.body.id }, data: { status: "closed" } });
    expect((await post(dev.cookie, { joinMode: "apply" })).body.error.message).toBe("Approved-only testers need a subscription ($7/month).");
    await db.test.update({ where: { id: t.body.id }, data: { status: "open" } });
    expect((await act(t.body.id, "next-round", dev.cookie, { seenAt: seen(), confirmed: true })).body.error.message).toBe("Next round needs a subscription ($7/month).");
    const ann = await makeUser({ tester: true });
    expect((await act(t.body.id, "invite", dev.cookie, { testerIds: [ann.user.id], seenAt: seen(), confirmed: true })).body.error.message).toBe("Inviting testers needs a subscription ($7/month).");
    // The Approved-only test stays so and keeps working: other edits save; applications can be answered.
    const v = (await db.test.findUniqueOrThrow({ where: { id: t.body.id } })).version;
    expect((await act(t.body.id, "edit", dev.cookie, { version: v, fields: { description: "Sail on" } })).status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: t.body.id } })).joinMode).toBe("apply");
    expect((await act(t.body.id, "apply", ann.cookie, { listingVersion: (await db.test.findUniqueOrThrow({ where: { id: t.body.id } })).listingVersion, note: "Hi" })).status).toBe(200);
    const app = await db.application.findFirstOrThrow({ where: { testId: t.body.id, testerId: ann.user.id } });
    expect((await act(t.body.id, "application", dev.cookie, { applicationId: app.id, decision: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    // Switching another test to Approved-only is a new use.
    const other = await db.test.create({ data: { developerId: dev.user.id, title: "B", spots: 2, deadlineDays: 7, devices: [], languages: [], categories: ["Game"], writtenCents: 1000, questions: ["Q?"], status: "closed" } });
    expect((await act(other.id, "edit", dev.cookie, { version: other.version, fields: { joinMode: "apply" } })).body.error.message).toBe("Approved-only testers need a subscription ($7/month).");
    // The tags.
    expect(src("app/app/tests/TestForm.tsx")).toContain("{!perks && <>");
    expect(src("app/app/tests/[id]/TopPanel.tsx")).toContain("Next round{p.perks === false && <SubscribersTag />}");
    expect(src("app/app/tests/[id]/InvitePanel.tsx")).toContain("Invite testers{p.perks === false && <SubscribersTag />}");
  });

  it("a subscriber has every perk", async () => {
    await freeOver();
    const dev = await subscriber();
    expect(await hasPerks(await userOf(dev.user.id))).toBe(true);
    const a = await post(dev.cookie, { joinMode: "apply" });
    expect(a.status).toBe(200);
    expect((await post(dev.cookie)).status).toBe(200);
    expect((await act(a.body.id, "next-round", dev.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
  });
});

describe("batch 8 items 2-3: Payments, subscribe, cancel, keep", () => {
  it("Subscribe needs a saved card; it charges $7 with a receipt line; active since / renews on; Cancel; Keep", async () => {
    await freeOver();
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    ok();
    expect((await sub(dev.cookie, "subscribe")).body.error.message).toBe("Add a card first, then subscribe.");
    await withCard(dev.user.id);
    const r = await sub(dev.cookie, "subscribe");
    expect(r.status).toBe(200);
    const u = await userOf(dev.user.id);
    expect(u).toMatchObject({ subscriptionStatus: "active", subscriptionId: "manual", subscriptionCanceling: false });
    expect(Math.round((u.subscriptionRenewsAt!.getTime() - Date.now()) / DAY)).toBeGreaterThanOrEqual(28);
    const p = await db.payment.findFirstOrThrow({ where: { developerId: dev.user.id, kind: "subscription" } });
    expect(p).toMatchObject({ amountCents: 700, status: "charged", testerCents: 0 });
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "Receipt: you paid $7.00 for your subscription ($7/month)" } })).toBe(1);
    expect(S.subState(u)).toBe("active");
    expect((await sub(dev.cookie, "subscribe")).body.error.message).toBe("You're already subscribed.");
    expect((await sub(dev.cookie, "cancel")).status).toBe(200);
    expect(S.subState(await userOf(dev.user.id))).toBe("cancelled");
    expect(await hasPerks(await userOf(dev.user.id))).toBe(true); // until the end of the paid month
    expect((await sub(dev.cookie, "keep")).status).toBe(200);
    expect(S.subState(await userOf(dev.user.id))).toBe("active");
    const box = src("app/app/payments/SubscriptionBox.tsx");
    for (const t of ["Subscribe for ${SUBSCRIPTION_PRICE}", "Cancel subscription", "Keep my subscription", "you won&apos;t be charged again", "Active since"]) expect(box).toContain(t);
  });

  it("a declined subscribe charge starts no hold", async () => {
    await freeOver();
    const dev = await makeUser({ dev: true });
    await withCard(dev.user.id);
    decline();
    const r = await sub(dev.cookie, "subscribe");
    expect(r.status).toBe(402);
    expect((await userOf(dev.user.id))).toMatchObject({ subscriptionStatus: "none", holdStartedAt: null });
  });

  it("a cancel runs to the end of the paid month, then the free plan: running tests carry on, new uses are refused, an open page stops once", async () => {
    await freeOver();
    const dev = await subscriber();
    const a = await post(dev.cookie, { joinMode: "apply" });
    const b = await post(dev.cookie);
    await sub(dev.cookie, "cancel");
    const loaded = seen();
    await settle();
    await db.user.update({ where: { id: dev.user.id }, data: { subscriptionRenewsAt: new Date(Date.now() - 1000) } });
    expect((await renewSubscriptions()).ended).toBe(1);
    const u = await userOf(dev.user.id);
    expect(u).toMatchObject({ subscriptionStatus: "ended", subscriptionEndReason: "cancelled" });
    expect(await db.payment.count({ where: { developerId: dev.user.id, kind: "subscription" } })).toBe(1); // never charged again
    // Both tests still run, the Approved-only one stays so.
    expect((await db.test.findUniqueOrThrow({ where: { id: a.body.id } })).status).toBe("open");
    expect((await db.test.findUniqueOrThrow({ where: { id: a.body.id } })).joinMode).toBe("apply");
    expect((await db.test.findUniqueOrThrow({ where: { id: b.body.id } })).status).toBe("open");
    expect((await post(dev.cookie)).body.error.message).toBe(S.SECOND_TEST_LINE);
    // A page open at that moment: the next press stops once with "Your subscription ended."
    const stop = await act(b.body.id, "stop", dev.cookie, { seenAt: loaded });
    expect(stop.body.error.code).toBe("stop_once");
    expect(stop.body.error.changes.map((c: { text: string }) => c.text)).toContain("Your subscription ended.");
  });
});

describe("batch 8 item 4: a declined renewal lapses, with no hold", () => {
  it("past due (perks continue, a notice sent even with email Off), retried daily, lapsed after a week; testers never affected", async () => {
    await freeOver();
    const dev = await subscriber();
    await db.user.update({ where: { id: dev.user.id }, data: { subscriptionRenewsAt: new Date(Date.now() - 1000) } });
    decline();
    expect((await renewSubscriptions()).failed).toBe(1);
    let u = await userOf(dev.user.id);
    expect(u).toMatchObject({ subscriptionStatus: "past_due", holdStartedAt: null });
    expect(await hasPerks(u)).toBe(true);
    const n = await db.notification.findFirstOrThrow({ where: { userId: dev.user.id, text: { startsWith: "Your $7 subscription payment didn't go through. Update your card by " } } });
    expect(n).toMatchObject({ mustEmail: true, groupKey: "payhold" });
    // Retried the next day (still declined): still past due.
    await renewSubscriptions(new Date(Date.now() + DAY));
    expect((await userOf(dev.user.id)).subscriptionStatus).toBe("past_due");
    // After the last retry: lapsed, no hold.
    await renewSubscriptions(new Date(Date.now() + 8 * DAY));
    u = await userOf(dev.user.id);
    expect(u).toMatchObject({ subscriptionStatus: "ended", subscriptionEndReason: "lapsed", holdStartedAt: null });
    expect(await db.notification.findFirstOrThrow({ where: { userId: dev.user.id, text: LAPSED_LINE } })).toMatchObject({ mustEmail: true });
    expect(S.subState(u)).toBe("lapsed");
  });

  it("a retry that goes through renews it; a chargeback on a subscription payment starts a chargeback hold and is owed", async () => {
    await freeOver();
    const dev = await subscriber();
    await db.user.update({ where: { id: dev.user.id }, data: { subscriptionRenewsAt: new Date(Date.now() - 1000) } });
    decline();
    await renewSubscriptions();
    ok();
    expect((await renewSubscriptions(new Date(Date.now() + DAY))).renewed).toBe(1);
    expect((await userOf(dev.user.id)).subscriptionStatus).toBe("active");
    const p = await db.payment.findFirstOrThrow({ where: { developerId: dev.user.id, kind: "subscription" }, orderBy: { createdAt: "desc" } });
    expect(p.stripePaymentIntentId).toBeTruthy();
    expect(await chargebackOpened(p.stripePaymentIntentId!)).toBe(true);
    expect((await userOf(dev.user.id))).toMatchObject({ holdReason: "chargeback" });
    expect((await owed(dev.user.id)).map((x) => x.id)).toContain(p.id);
  });

  it("Stripe Billing webhook events: a failed invoice, a paid invoice, the end", async () => {
    const dev = await makeUser({ dev: true });
    await db.user.update({ where: { id: dev.user.id }, data: { subscriptionStatus: "active", subscriptionId: "sub_" + randomUUID(), subscribedAt: new Date(), subscriptionAnchorAt: new Date(), subscriptionRenewsAt: new Date(Date.now() + 5 * DAY) } });
    const id = (await userOf(dev.user.id)).subscriptionId!;
    await subscriptionWebhook("invoice.payment_failed", { subscription: id });
    expect((await userOf(dev.user.id)).subscriptionStatus).toBe("past_due");
    await subscriptionWebhook("invoice.paid", { subscription: id, amount_paid: 700, payment_intent: "pi_" + randomUUID(), lines: { data: [{ period: { end: Math.floor((Date.now() + 30 * DAY) / 1000) } }] } });
    expect((await userOf(dev.user.id)).subscriptionStatus).toBe("active");
    expect(await db.payment.count({ where: { developerId: dev.user.id, kind: "subscription" } })).toBe(1);
    await subscriptionWebhook("customer.subscription.deleted", { id });
    expect((await userOf(dev.user.id))).toMatchObject({ subscriptionStatus: "ended", subscriptionEndReason: "cancelled" });
    expect(src("app/api/stripe/webhook/route.ts")).toContain("subscriptionWebhook(event.type, event.data.object)");
  });
});

describe("batch 8 item 5: holds, suspensions, deletion", () => {
  it("a hold pauses billing; the paid days left resume when it lifts; Subscribe is refused, Cancel and Keep still work", async () => {
    await freeOver();
    const dev = await subscriber();
    const before = (await userOf(dev.user.id)).subscriptionRenewsAt!;
    await startHold(dev.user.id, "unpaid");
    expect((await userOf(dev.user.id)).subscriptionPausedAt).not.toBeNull();
    expect(S.subState(await userOf(dev.user.id))).toBe("paused");
    // No renewal is charged while it lasts.
    await renewSubscriptions(new Date(Date.now() + 40 * DAY));
    expect(await db.payment.count({ where: { developerId: dev.user.id, kind: "subscription" } })).toBe(1);
    expect((await sub(dev.cookie, "cancel")).status).toBe(200);
    expect((await sub(dev.cookie, "keep")).status).toBe(200);
    const other = await makeUser({ dev: true });
    await startHold(other.user.id, "unpaid");
    expect((await sub(other.cookie, "subscribe")).body.error.message).toBe("You can subscribe once your account is active again.");
    // Paused 3 days ago; lifted now → the renewal moves 3 days later.
    await db.user.update({ where: { id: dev.user.id }, data: { subscriptionPausedAt: new Date(Date.now() - 3 * DAY) } });
    expect((await payOwed(await userOf(dev.user.id))).lifted).toBe(true);
    const u = await userOf(dev.user.id);
    expect(u.subscriptionPausedAt).toBeNull();
    expect(Math.round((u.subscriptionRenewsAt!.getTime() - before.getTime()) / DAY)).toBe(3);
  });

  it("a suspension pauses billing too; with a hold left after the reinstatement it stays paused until both lift", async () => {
    await freeOver();
    const dev = await subscriber();
    const a = await makeUser({ name: "Admin" });
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    expect((await adm("suspend", a.cookie, { id: dev.user.id, note: "Check" })).status).toBe(200);
    expect((await userOf(dev.user.id)).subscriptionPausedAt).not.toBeNull();
    await startHold(dev.user.id, "unpaid");
    await reinstateAccount(dev.user.id);
    expect((await userOf(dev.user.id)).subscriptionPausedAt).not.toBeNull();
    expect(await liftHoldIfClear(dev.user.id)).toBe(true);
    expect((await userOf(dev.user.id)).subscriptionPausedAt).toBeNull();
  });

  it("deleting the account ends the subscription at once, with no refund; the warning says so", async () => {
    await freeOver();
    const dev = await subscriber();
    await deleteAccount(dev.user.id, "self");
    expect(await userOf(dev.user.id)).toMatchObject({ subscriptionStatus: "ended", subscriptionEndReason: "deleted" });
    expect(await db.payment.count({ where: { developerId: dev.user.id, kind: "subscription", status: "refunded" } })).toBe(0);
    expect(S.DELETE_ENDS_SUBSCRIPTION).toBe("Your subscription ends now, with no refund for the rest of the month.");
    expect(src("app/app/account/page.tsx")).toContain("subscriptionLine={subscribed(u) ? DELETE_ENDS_SUBSCRIPTION : \"\"}");
  });
});

describe("batch 8 item 6: free during launch", () => {
  it("no date: free with no end (everyone has the perks; nothing to subscribe to); a date must be 30+ days away", async () => {
    expect(await launchState()).toEqual({ free: true, until: null });
    const dev = await makeUser({ dev: true });
    expect(await hasPerks(await userOf(dev.user.id))).toBe(true);
    expect((await post(dev.cookie)).status).toBe(200);
    expect((await post(dev.cookie)).status).toBe(200);
    expect((await sub(dev.cookie, "subscribe")).body.error.message).toBe("Everything is free during launch: there's nothing to subscribe to yet.");
    await expect(setFreeUntil(new Date(Date.now() + 10 * DAY).toISOString())).rejects.toThrow("Pick a date at least 30 days away.");
  });

  it("the 30-day and 7-day notices (sent even with email Off); moving the date after a notice sends '...now from'; clearing it: 'The extras stay free for now.'", async () => {
    const dev = await makeUser({ dev: true });
    const until = new Date(Date.now() + 40 * DAY);
    await setFreeUntil(until.toISOString());
    expect(await freeLaunchNotices()).toBe(0); // 40 days away: not yet
    expect(await freeLaunchNotices(new Date(Date.now() + 11 * DAY))).toBe(1);
    const n = await db.notification.findFirstOrThrow({ where: { userId: dev.user.id, text: { startsWith: "Free during launch ends soon" } } });
    expect(n.text).toBe(`Free during launch ends soon: the extras need a $7/month subscription from ${S.fmtSubDay(until)}.`);
    expect(n.mustEmail).toBe(true);
    expect(await freeLaunchNotices(new Date(Date.now() + 12 * DAY))).toBe(0); // once
    expect(await freeLaunchNotices(new Date(Date.now() + 34 * DAY))).toBe(1); // 7 days before
    const later = new Date(Date.now() + 60 * DAY);
    await setFreeUntil(later.toISOString());
    expect(await db.notification.count({ where: { userId: dev.user.id, text: `Free during launch ends soon: the extras need a $7/month subscription now from ${S.fmtSubDay(later)}.` } })).toBe(1);
    await setFreeUntil("");
    expect(await db.notification.count({ where: { userId: dev.user.id, text: "The extras stay free for now." } })).toBe(1);
    expect(await launchState()).toEqual({ free: true, until: null });
  });

  it("subscribing during the free launch charges nothing until that date; Payments says so; when it ends it works like a lapse", async () => {
    const until = new Date(Date.now() + 40 * DAY);
    await setFreeUntil(until.toISOString());
    const dev = await makeUser({ dev: true });
    await withCard(dev.user.id);
    ok();
    expect((await sub(dev.cookie, "subscribe")).status).toBe(200);
    expect(await db.payment.count({ where: { developerId: dev.user.id, kind: "subscription" } })).toBe(0);
    expect((await userOf(dev.user.id)).subscriptionRenewsAt!.getTime()).toBe(until.getTime());
    expect(src("app/app/payments/SubscriptionBox.tsx")).toContain("Free during launch until");
    expect(src("app/app/payments/SubscriptionBox.tsx")).toContain("Subscribe to keep the extras after that.");
    // The end, for someone who didn't subscribe: running tests carry on, the open page stops once.
    const free = await makeUser({ dev: true });
    const t = await post(free.cookie);
    const loaded = seen();
    await settle();
    await db.appState.update({ where: { key: "free-until" }, data: { value: new Date(Date.now() - 1000).toISOString() } });
    await freeLaunchNotices();
    expect((await act(t.body.id, "stop", free.cookie, { seenAt: loaded })).body.error.changes.map((c: { text: string }) => c.text)).toContain("Free during launch ended: the extras need a subscription now.");
    expect((await post(free.cookie)).body.error.message).toBe(S.SECOND_TEST_LINE);
  });
});

describe("batch 8 item 7: admin", () => {
  it("each user row shows the subscription state; the settings hold the free-until date", async () => {
    const now = new Date();
    const base = { subscriptionRenewsAt: new Date("2026-12-01T00:00:00Z"), subscriptionCanceling: false };
    expect(S.adminSubLine({ subscriptionStatus: "none", subscriptionRenewsAt: null, subscriptionCanceling: false }, now)).toBe("free plan");
    expect(S.adminSubLine({ ...base, subscriptionStatus: "active" }, now)).toBe("subscribed, renews Dec 1, 2026");
    expect(S.adminSubLine({ ...base, subscriptionStatus: "active", subscriptionCanceling: true }, now)).toBe("cancelled until Dec 1, 2026");
    expect(S.adminSubLine({ ...base, subscriptionStatus: "ended", subscriptionEndReason: "lapsed" }, now)).toBe("lapsed");
    expect(S.adminSubLine({ ...base, subscriptionStatus: "active", subscriptionPausedAt: now }, now)).toBe("paused (hold or suspension)");
    expect(src("lib/server/adminLists.ts")).toContain("adminSubLine(x)");
    const a = await makeUser({ name: "Admin" });
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    expect((await adm("set-free-until", a.cookie, { id: "free-until", date: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10) })).body.error.message).toBe("Pick a date at least 30 days away.");
    expect((await adm("set-free-until", a.cookie, { id: "free-until", date: new Date(Date.now() + 45 * DAY).toISOString().slice(0, 10) })).status).toBe(200);
    expect((await launchState()).until).not.toBeNull();
    expect(src("app/admin/page.tsx")).toContain('action="set-free-until"');
  });

  it("testers never see any of it: a subscription payment is not the tester side's income", async () => {
    await freeOver();
    const dev = await subscriber();
    expect(src("app/app/payments/page.tsx")).toContain('tester ? db.payment.findMany({ where: { testerId: u.id, kind: { not: "subscription" }');
    expect(src("app/app/page.tsx")).toContain('db.payment.aggregate({ where: { testerId: userId, kind: { not: "subscription" }');
    expect(await db.payment.count({ where: { testerId: dev.user.id, kind: { not: "subscription" } } })).toBe(0);
  });
});
