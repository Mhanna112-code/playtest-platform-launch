import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as profilePOST } from "@/app/api/profile/route";
import { POST as passwordPOST } from "@/app/api/auth/password/route";
import { POST as subPOST } from "@/app/api/payments/subscription/route";
import { POST as sidePOST } from "@/app/api/account/side/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { GET as changesGET } from "@/app/api/account/changes/route";
import { ACCOUNT_STOP_HEADING, accountChangesSince, cardLabel, formGate, logAccountChange } from "@/lib/server/accountChanges";
import { startHold } from "@/lib/server/holds";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { joined, settle, setup } from "./fixtures";

// Batch 16 section 27: Payments, the profile editor and Settings. A change in another tab or device updates the page silently; the first press afterwards
// stops once with what changed (short form); the second saves on top; the same value isn't listed; repeats are plain refusals.
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const past = () => new Date(Date.now() - 60_000).toISOString();
const post = (route: (r: Request) => Promise<Response>, url: string, cookie: string, body: Record<string, unknown>) => route(req(url, { cookie, body })).then(json);
afterEach(() => setStripeForTests(null));

describe("Payments (section 27)", () => {
  it("card changed in tab A: Cancel in tab B stops once with the card line; the second press cancels; a repeat is a plain refusal", async () => {
    const dev = await makeUser({ dev: true });
    await db.user.update({ where: { id: dev.user.id }, data: { subscriptionStatus: "active", subscribedAt: new Date(), subscriptionRenewsAt: new Date(Date.now() + 20 * 86_400_000), subscriptionId: "manual" } });
    const seenAt = past();
    await logAccountChange(dev.user.id, "tabA", { scopes: ["payments"], field: "card", label: "Card", before: "Visa ending 1111", after: "Visa ending 4242" });
    const stop = await post(subPOST, "/api/payments/subscription", dev.cookie, { action: "cancel", seenAt, tab: "tabB" });
    expect(stop.status).toBe(409);
    expect(stop.body.error.code).toBe("stop_once");
    expect(stop.body.error.heading).toBe(ACCOUNT_STOP_HEADING);
    expect(stop.body.error.changes.map((c: { text: string; kind: string }) => [c.text, c.kind])).toEqual([["Card: Visa ending 1111 → Visa ending 4242", "account"]]);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).subscriptionCanceling).toBe(false);
    // The tab that changed the card never stops for its own change.
    expect((await accountChangesSince(dev.user.id, new Date(seenAt), "payments", "tabA")).length).toBe(0);
    const go = await post(subPOST, "/api/payments/subscription", dev.cookie, { action: "cancel", seenAt, tab: "tabB", confirmed: true, boxAt: stop.body.error.now });
    expect(go.status).toBe(200);
    // Tab A (an old page) presses Cancel too: a plain refusal, no box. Keep twice: "You're already subscribed."
    const again = await post(subPOST, "/api/payments/subscription", dev.cookie, { action: "cancel", seenAt, tab: "tabA" });
    expect(again.body.error).toMatchObject({ code: "already", message: "Your subscription is already cancelled." });
    expect((await post(subPOST, "/api/payments/subscription", dev.cookie, { action: "keep", seenAt: new Date().toISOString(), tab: "tabB" })).status).toBe(200);
    const keep2 = await post(subPOST, "/api/payments/subscription", dev.cookie, { action: "keep", seenAt, tab: "tabA" });
    expect(keep2.body.error).toMatchObject({ code: "already", message: "You're already subscribed." });
    expect((await post(subPOST, "/api/payments/subscription", dev.cookie, { action: "subscribe", seenAt, tab: "tabA" })).body.error.message).toBe("You're already subscribed.");
    // The subscription changes were logged for other open pages.
    const lines = (await accountChangesSince(dev.user.id, new Date(seenAt), "payments", "tabC")).map((c) => c.text);
    expect(lines).toContain("Card: Visa ending 1111 → Visa ending 4242");
    expect(lines.some((l) => /^Subscription: kept, renews [A-Z][a-z]{2} \d{1,2}$/.test(l))).toBe(true);
    expect(cardLabel({ brand: "visa", last4: "4242" })).toBe("Visa ending 4242");
  });

  it("Change card / payout setup (plain forms): a stop goes back to Payments with the box under that button; the confirmed press goes on", async () => {
    const dev = await makeUser({ dev: true });
    const seenAt = past();
    await logAccountChange(dev.user.id, "tabA", { scopes: ["payments"], field: "card", label: "Card", before: "no card", after: "Visa ending 4242" });
    await settle(); // Windows' clock can lag by ~15 ms: the box comes clearly after the change
    const f = new FormData();
    f.set("seenAt", seenAt);
    f.set("tab", "tabB");
    const back = await formGate(dev.user.id, f, "card", "http://localhost:3400");
    expect(back).toMatch(/^http:\/\/localhost:3400\/app\/payments\?stop=card&since=.+&tab=tabB#card$/);
    f.set("confirmed", "1");
    f.set("boxAt", new Date().toISOString());
    expect(await formGate(dev.user.id, f, "card", "http://localhost:3400")).toBeNull();
    const page = src("app/app/payments/page.tsx");
    expect(page).toContain('<AccountFormButton action="/api/payments/card"');
    expect(page).toContain('<AccountFormButton action="/api/payments/payout"');
    expect(page).toContain("<AccountRefresh />");
  });

  it("Pay what you owe: stops once only when the owed total changed (a card change elsewhere doesn't stop it)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    const row = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    await startHold(dev.user.id, "unpaid");
    setStripeForTests({ paymentIntents: { create: async () => ({ id: "pi_" + randomUUID(), status: "succeeded" }) } } as unknown as Stripe);
    const press = (body: Record<string, unknown>) => post(owedPOST, "/api/payments/owed", dev.cookie, body);
    await logAccountChange(dev.user.id, "tabA", { scopes: ["payments"], field: "card", label: "Card", before: "Visa ending 1111", after: "Visa ending 4242" });
    // The total changed (a tester charged meanwhile): one stop with the new total.
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "owed" } });
    const stop = await press({ seenTotalCents: 800, seenIds: [row.id], seenAt: past(), tab: "tabB" });
    expect(stop.body.error.code).toBe("stop_once");
    expect(stop.body.error.totalCents).toBe(1300);
    // The total as shown: it pays at once, the card change elsewhere notwithstanding.
    const paid = await press({ seenTotalCents: 1300, seenIds: stop.body.error.ids, confirmed: true, seenAt: past(), tab: "tabB" });
    expect(paid.status).toBe(200);
    expect(src("lib/server/holds.ts")).not.toMatch(/accountGate/);
  });
});

describe("Profile editor (section 27)", () => {
  it("devices changed in tab A: Save in tab B stops once with the devices line and keeps B's typed bio; the second press saves on top", async () => {
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    const seenAt = past();
    const base = { name: "Ana Silva", pronoun: "", isDeveloper: false, isTester: true, devices: ["Windows PC"], categories: [], languages: ["English"], bio: "" };
    const a = await post(profilePOST, "/api/profile", t.cookie, { ...base, devices: ["Windows PC", "iPad"], seenAt, tab: "tabA" });
    expect(a.status).toBe(200);
    await settle();
    const b = await post(profilePOST, "/api/profile", t.cookie, { ...base, bio: "Roguelikes on PC.", seenAt, tab: "tabB" });
    expect(b.status).toBe(409);
    expect(b.body.error.changes.map((c: { text: string }) => c.text)).toEqual(["Devices: Windows PC → Windows PC, iPad"]);
    expect((await db.testerProfile.findUniqueOrThrow({ where: { userId: t.user.id } })).bio).toBe("");
    const b2 = await post(profilePOST, "/api/profile", t.cookie, { ...base, bio: "Roguelikes on PC.", seenAt, tab: "tabB", confirmed: true, boxAt: b.body.error.now });
    expect(b2.status).toBe(200);
    const p = await db.testerProfile.findUniqueOrThrow({ where: { userId: t.user.id } });
    expect(p.bio).toBe("Roguelikes on PC.");
    expect(p.devices).toEqual(["Windows PC"]); // B saved what it had on top (as Edit does)
  });

  it("the same value saved in both tabs isn't listed: Save goes straight through", async () => {
    const t = await makeUser({ tester: true, name: "Ben Okafor" });
    const seenAt = past();
    const base = { name: "Ben Okafor", pronoun: "", isDeveloper: false, isTester: true, devices: ["Windows PC", "iPad"], categories: [], languages: ["English"], bio: "" };
    expect((await post(profilePOST, "/api/profile", t.cookie, { ...base, seenAt, tab: "tabA" })).status).toBe(200);
    // Tab B typed exactly the same devices: not news.
    expect((await post(profilePOST, "/api/profile", t.cookie, { ...base, seenAt, tab: "tabB" })).status).toBe(200);
    // A different name elsewhere is news on Settings too (the name shows there).
    expect((await post(profilePOST, "/api/profile", t.cookie, { ...base, name: "Ben O.", seenAt: new Date().toISOString(), tab: "tabA" })).status).toBe(200);
    expect((await accountChangesSince(t.user.id, new Date(seenAt), "settings", "tabB")).map((c) => c.text)).toEqual(["Name: Ben Okafor → Ben O."]);
    // The page polls for changes and refreshes silently.
    const r = await changesGET(req("/api/account/changes", { method: "GET", cookie: t.cookie })).then(json);
    expect(typeof r.body.latest).toBe("string");
    const form = src("app/app/profile/ProfileForm.tsx");
    expect(form).toContain("if (!typed.current.has(k))");
    expect(src("app/app/profile/page.tsx")).toContain("<AccountRefresh />");
  });
});

describe("Settings (section 27)", () => {
  it("password changed in tab A: Change password in tab B stops once with 'Password changed' (the box adds the time); typed values kept; the second press goes on", async () => {
    const u = await makeUser({ dev: true });
    const seenAt = past();
    expect((await post(passwordPOST, "/api/auth/password", u.cookie, { password: "first-pass-1", confirm: "first-pass-1", seenAt, tab: "tabA" })).status).toBe(200);
    await settle();
    const b = await post(passwordPOST, "/api/auth/password", u.cookie, { current: "wrong-old", password: "second-pass-2", confirm: "second-pass-2", seenAt, tab: "tabB" });
    expect(b.body.error.code).toBe("stop_once");
    expect(b.body.error.changes.map((c: { text: string; kind: string }) => [c.text, c.kind])).toEqual([["Password changed", "account-at"]]);
    // Second press: checked as usual (the current password is now tab A's).
    const b2 = await post(passwordPOST, "/api/auth/password", u.cookie, { current: "first-pass-1", password: "second-pass-2", confirm: "second-pass-2", seenAt, tab: "tabB", confirmed: true, boxAt: b.body.error.now });
    expect(b2.status).toBe(200);
    expect(src("components/ChangesBox.tsx")).toContain('c.kind === "account-at" ? `${c.text} at ${time(c.at)}`');
    expect(src("components/ChangesBox.tsx")).toContain('"Changed in another tab or device since you opened this page:"');
  });

  it("a side added in tab A stops the side switch in tab B once", async () => {
    const u = await makeUser({ dev: true });
    const seenAt = past();
    expect((await post(sidePOST, "/api/account/side", u.cookie, { side: "tester", add: true, seenAt, tab: "tabA" })).status).toBe(200);
    await settle();
    const b = await post(sidePOST, "/api/account/side", u.cookie, { side: "developer", add: false, seenAt, tab: "tabB" });
    expect(b.body.error.changes.map((c: { text: string }) => c.text)).toEqual(["Sides: developer → developer and tester"]);
    expect((await post(sidePOST, "/api/account/side", u.cookie, { side: "developer", add: false, seenAt, tab: "tabB", confirmed: true, boxAt: b.body.error.now })).status).toBe(200);
    // Delete account, Sign out of all devices and the email setting keep their own rules (no gate there).
    expect(src("app/app/account/page.tsx")).toContain("<PasswordForm hasPassword={!!u.passwordHash} seenAt={seenAt} />");
  });
});
