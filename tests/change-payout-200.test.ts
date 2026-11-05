import React, { isValidElement, type ReactElement, type ReactNode } from "react";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/payments/payout-dashboard/route";
import { PayoutBanner } from "@/components/PayoutBanner";
import { AdminPersonBoxes } from "@/app/admin/AdminBoxes";
import { logAccountChange } from "@/lib/server/accountChanges";
import { PAYMENTS_OFF, payoutDashboardUrl, setStripeForTests } from "@/lib/server/stripe";
import { CHANGE_PAYOUT, PAYOUT_PRESSES, pressLabelOf } from "@/lib/pressLabels";
import { makeUser } from "./helpers";
import { settle } from "./fixtures";

// (Owner, Nov 5, §200) "Change payout details": a connected tester opens Stripe's own Express dashboard for their account (a login link), where the bank account is
// changed. The payout problem's "Update payout details" goes the same way; while Stripe still needs details, both go to Stripe's onboarding for the same account.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, adminAway() {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/payments", useRouter: () => ({ refresh() {} }), useSearchParams: () => new URLSearchParams(), notFound() { throw new Error("notFound"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const BASE = "http://localhost:3400";
const env = { key: process.env.STRIPE_SECRET_KEY, allow: process.env.STRIPE_ALLOW_LIVE, fake: process.env.STRIPE_FAKE };
afterEach(() => {
  setStripeForTests(null);
  process.env.STRIPE_SECRET_KEY = env.key ?? "";
  for (const [k, v] of [["STRIPE_ALLOW_LIVE", env.allow], ["STRIPE_FAKE", env.fake]] as const) {
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
});

const missing = () => Object.assign(new Error("No such account: 'acct_test123'"), { type: "StripeInvalidRequestError", code: "resource_missing", param: "account", raw: { code: "resource_missing", param: "account", message: "No such account" } });

/** A Stripe stand-in: `accounts` maps each account it knows to its state; anything else is unknown (resource_missing). */
function stripe(accounts: Record<string, { details_submitted: boolean; due?: string[] }>) {
  const calls = { login: [] as string[], links: [] as { account: string; type: string; return_url: string }[] };
  const known = (id: string) => { if (!accounts[id]) throw missing(); return accounts[id]; };
  setStripeForTests({
    accounts: {
      retrieve: async (id: string) => { const a = known(id); return { id, details_submitted: a.details_submitted, payouts_enabled: a.details_submitted, capabilities: { transfers: "active" }, requirements: { currently_due: a.due ?? [], past_due: [] } }; },
      createLoginLink: async (id: string) => { const a = known(id); if (!a.details_submitted) throw new Error("Cannot create a login link for an account that has not completed onboarding."); calls.login.push(id); return { url: `https://connect.stripe.test/express/${id}` }; },
    },
    accountLinks: { create: async (p: { account: string; type: string; return_url: string }) => { known(p.account); calls.links.push(p); return { url: `https://connect.stripe.test/setup/${p.account}` }; } },
  } as unknown as Stripe);
  return calls;
}

const acct = () => "acct_" + randomUUID().replace(/-/g, "").slice(0, 16);
async function tester(over: { connected?: boolean; account?: string | null; problem?: boolean; unconfirmed?: boolean } = {}) {
  const t = await makeUser({ tester: true, name: "Ana Silva", unconfirmed: over.unconfirmed });
  const account = over.account === undefined ? acct() : over.account;
  await db.user.update({ where: { id: t.user.id }, data: { stripeAccountId: account, payoutsReady: over.connected ?? true, payoutProblemAt: over.problem ? new Date() : null } });
  return { ...t, account: account ?? "" };
}
const press = (cookie: string, fields: Record<string, string> = {}, headers: Record<string, string> = { origin: BASE }) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return POST(new Request(`${BASE}/api/payments/payout-dashboard`, { method: "POST", headers: { cookie, ...headers }, body: f }));
};
const to = (r: Response) => r.headers.get("location");
const userOf = (id: string) => db.user.findUniqueOrThrow({ where: { id } });

function section(node: ReactNode, id: string): ReactElement | undefined {
  if (Array.isArray(node)) return node.map((n) => section(n, id)).find(Boolean);
  if (!isValidElement(node)) return;
  const e = node as ReactElement<{ id?: string; children?: ReactNode }>;
  return e.props.id === id ? e : section(e.props.children, id);
}
async function payments(userId: string, q: Record<string, string> = {}) {
  const { default: Page } = await import("@/app/app/payments/page");
  auth.user = await userOf(userId);
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(q) })).replace(/&#x27;/g, "'");
}
async function payoutBox(userId: string) {
  const { default: Page } = await import("@/app/app/payments/page");
  auth.user = await userOf(userId);
  return renderToStaticMarkup(section(await Page({ searchParams: Promise.resolve({}) }), "payout")!).replace(/&#x27;/g, "'");
}

describe("§200 the button", () => {
  it("shows under the connected line only when the payout account is connected", async () => {
    stripe({});
    const t = await tester();
    const box = await payoutBox(t.user.id);
    expect(box).toContain("Your payout account is connected. Each payment is sent to it.");
    expect(box).toContain('action="/api/payments/payout-dashboard"');
    expect(box).toContain(CHANGE_PAYOUT);
    expect(box).toContain("Opens Stripe, where you change the bank account payments go to. Payments already sent stay where they went.");
    expect(box.indexOf("Your payout account is connected.")).toBeLessThan(box.indexOf(CHANGE_PAYOUT));
    expect(box).not.toContain("Continue setup");
    // Not connected: setup's buttons, never Change payout details.
    for (const t2 of [await tester({ connected: false }), await tester({ account: null, connected: false })]) {
      const b = await payoutBox(t2.user.id);
      expect(b).not.toContain(CHANGE_PAYOUT);
      expect(b).not.toContain("payout-dashboard");
      expect(b).toContain(t2.account ? "Continue setup" : "Connect a payout account");
    }
  });

  it("no button without Stripe set up", async () => {
    const t = await tester();
    expect(await payoutBox(t.user.id)).not.toContain(CHANGE_PAYOUT);
  });

  it("the team's read-only view of the person (§190) has no such button", async () => {
    stripe({});
    const t = await tester();
    const a = await makeUser({ dev: true, name: "Team Admin" });
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    const tree = await AdminPersonBoxes({ userId: t.user.id, adminId: a.user.id, developer: false, tester: true });
    expect(JSON.stringify(tree, (_k, v) => (typeof v === "function" ? undefined : v))).not.toContain("payout-dashboard");
    const src = fs.readFileSync(path.resolve(__dirname, "../src/app/admin/AdminBoxes.tsx"), "utf8") + fs.readFileSync(path.resolve(__dirname, "../src/components/PaymentLists.tsx"), "utf8");
    expect(src).not.toContain("payout-dashboard");
    expect(src).not.toContain("CHANGE_PAYOUT");
  });

  it("the press is named (§156)", () => {
    expect(PAYOUT_PRESSES).toContain(CHANGE_PAYOUT);
    expect(pressLabelOf("/api/payments/payout-dashboard")).toBe(CHANGE_PAYOUT);
    expect(pressLabelOf("/api/payments/payout-dashboard", { press: "Update payout details" })).toBe("Update payout details");
  });
});

describe("§200 the route", () => {
  it("a connected account: to Stripe's Express dashboard for the tester's own account (a login link)", async () => {
    const t = await tester();
    const calls = stripe({ [t.account]: { details_submitted: true } });
    const r = await press(t.cookie, { seenAt: new Date().toISOString(), tab: "tabA" });
    expect(r.status).toBe(303);
    expect(to(r)).toBe(`https://connect.stripe.test/express/${t.account}`);
    expect(calls.login).toEqual([t.account]);
    expect(calls.links).toEqual([]);
    expect(await userOf(t.user.id)).toMatchObject({ stripeAccountId: t.account, payoutsReady: true }); // the same account
  });

  it("Stripe still needs details: its onboarding for the same account (a login link only works once onboarding is done)", async () => {
    const a = await tester({ connected: false });
    const b = await tester();
    const calls = stripe({ [a.account]: { details_submitted: false }, [b.account]: { details_submitted: true, due: ["external_account"] } });
    expect(to(await press(a.cookie))).toBe(`https://connect.stripe.test/setup/${a.account}`);
    expect(to(await press(b.cookie))).toBe(`https://connect.stripe.test/setup/${b.account}`);
    expect(calls.links).toEqual([
      expect.objectContaining({ account: a.account, type: "account_onboarding", return_url: `${BASE}/api/payments/payout-return` }),
      expect.objectContaining({ account: b.account, type: "account_onboarding" }),
    ]);
    expect(calls.login).toEqual([]);
  });

  it("an account unknown to Stripe (§130): cleared, back to Payments, which offers Connect a payout account again", async () => {
    const t = await tester({ problem: true });
    stripe({});
    expect(to(await press(t.cookie))).toBe(`${BASE}/app/payments?error=payout_gone&press=change#payout`);
    expect(await userOf(t.user.id)).toMatchObject({ stripeAccountId: null, payoutsReady: false, payoutProblemAt: null });
    expect(await db.actionLog.count({ where: { userId: t.user.id, testId: "account", text: { contains: '"field":"payout"' } } })).toBe(1);
    const page = await payments(t.user.id, { error: "payout_gone", press: "change" });
    expect(page).toContain("Your Change payout details didn't go through: Stripe doesn't know your payout account any more, so it was removed here. Connect a payout account to be paid.");
    expect(page).toContain("Connect a payout account to receive money for your work.");
    expect(page).not.toContain(`>${CHANGE_PAYOUT}`);
    expect(page).not.toContain("data-payout-banner");
  });

  it("no payout account any more (cleared meanwhile): back to Payments saying so", async () => {
    const t = await tester({ account: null, connected: false });
    const calls = stripe({});
    expect(to(await press(t.cookie))).toBe(`${BASE}/app/payments?error=payout_none&press=change#payout`);
    expect(calls.login).toEqual([]);
  });

  it("only the signed-in tester's own account; never from another site; signed out goes nowhere near Stripe", async () => {
    const a = await tester();
    const b = await tester();
    const calls = stripe({ [a.account]: { details_submitted: true }, [b.account]: { details_submitted: true } });
    expect(to(await press(b.cookie))).toBe(`https://connect.stripe.test/express/${b.account}`);
    expect(calls.login).toEqual([b.account]);
    // Another site's form: refused before anything.
    const x = await press(a.cookie, {}, { origin: "https://evil.example" });
    expect(x.status).toBe(403);
    // Signed out.
    expect(to(await press(""))).toBe(`${BASE}/app/payments?error=dashboard&press=change#payout`);
    expect(calls.login).toEqual([b.account]);
  });

  it("a GET goes back to Payments", async () => {
    const r = await GET(new Request(`${BASE}/api/payments/payout-dashboard`));
    expect(r.status).toBe(303);
    expect(to(r)).toBe(`${BASE}/app/payments#payout`);
  });

  it("payments switched off (live key without STRIPE_ALLOW_LIVE): back to Payments with the paused line naming the press", async () => {
    const t = await tester();
    process.env.STRIPE_SECRET_KEY = "sk_live_fake";
    delete process.env.STRIPE_ALLOW_LIVE;
    expect(to(await press(t.cookie))).toBe(`${BASE}/app/payments?error=paused&press=change#payout`);
    expect(await userOf(t.user.id)).toMatchObject({ stripeAccountId: t.account, payoutsReady: true }); // nothing cleared
    process.env.STRIPE_SECRET_KEY = "";
    stripe({});
    expect(await payments(t.user.id, { error: "paused", press: "change" })).toContain(`Your ${CHANGE_PAYOUT} didn't go through: ${PAYMENTS_OFF}`);
  });

  it("Stripe isn't set up: back to Payments", async () => {
    const t = await tester();
    expect(to(await press(t.cookie))).toBe(`${BASE}/app/payments?error=off&press=change#payout`);
  });

  it("a Stripe error: back to Payments with a plain line", async () => {
    const t = await tester();
    setStripeForTests({ accounts: { retrieve: async () => { throw new Error("boom"); } } } as unknown as Stripe);
    expect(to(await press(t.cookie))).toBe(`${BASE}/app/payments?error=dashboard&press=change#payout`);
    stripe({});
    expect(await payments(t.user.id, { error: "dashboard", press: "change" })).toContain(`Your ${CHANGE_PAYOUT} didn't go through: We couldn't open Stripe. Try again.`);
  });

  it("a payout account changed in another tab since the page opened: stops once with the box under the button; the next press goes on", async () => {
    const t = await tester();
    const calls = stripe({ [t.account]: { details_submitted: true } });
    const seenAt = new Date(Date.now() - 5_000).toISOString();
    await logAccountChange(t.user.id, "tabA", { scopes: ["payments"], field: "payout", label: "Payout account", before: "not connected", after: "connected" });
    await settle();
    const r = await press(t.cookie, { seenAt, tab: "tabB" });
    expect(to(r)).toMatch(/^http:\/\/localhost:3400\/app\/payments\?stop=payout&since=.+&tab=tabB#payout$/);
    expect(calls.login).toEqual([]);
    expect(to(await press(t.cookie, { seenAt, tab: "tabB", confirmed: "1", boxAt: new Date().toISOString() }))).toBe(`https://connect.stripe.test/express/${t.account}`);
  });

  it("open to a suspended tester (still paid)", async () => {
    const t = await tester();
    await db.user.update({ where: { id: t.user.id }, data: { testerSuspendedAt: new Date() } });
    stripe({ [t.account]: { details_submitted: true } });
    expect(to(await press(t.cookie))).toBe(`https://connect.stripe.test/express/${t.account}`);
  });

  it("payouts only to a confirmed email address, as setup", async () => {
    const t = await tester({ unconfirmed: true });
    const calls = stripe({ [t.account]: { details_submitted: true } });
    expect(to(await press(t.cookie))).toBe(`${BASE}/app/payments?error=confirm&press=change#payout`);
    expect(calls.login).toEqual([]);
  });
});

describe("§200 the payout problem's Update payout details", () => {
  it("the banner posts here, naming its press; a connected account goes to the dashboard (setup refused it: 'already connected')", async () => {
    const html = renderToStaticMarkup(React.createElement(PayoutBanner));
    expect(html).toContain('action="/api/payments/payout-dashboard"');
    expect(html).toContain('name="press" value="Update payout details"');
    const t = await tester({ problem: true });
    const calls = stripe({ [t.account]: { details_submitted: true } });
    expect(to(await press(t.cookie, { press: "Update payout details" }))).toBe(`https://connect.stripe.test/express/${t.account}`);
    expect(calls.login).toEqual([t.account]);
  });

  it("an account Stripe stopped paying out to until it gets details: onboarding; a refusal names Update payout details", async () => {
    const t = await tester({ connected: false, problem: true });
    stripe({ [t.account]: { details_submitted: true, due: ["external_account"] } });
    expect(to(await press(t.cookie, { press: "Update payout details" }))).toBe(`https://connect.stripe.test/setup/${t.account}`);
    setStripeForTests({ accounts: { retrieve: async () => { throw new Error("boom"); } } } as unknown as Stripe);
    expect(to(await press(t.cookie, { press: "Update payout details" }))).toBe(`${BASE}/app/payments?error=dashboard&press=update#payout`);
  });
});

describe("§200 the local fake Stripe (evidence runs)", () => {
  it("makes an Express dashboard login link", async () => {
    process.env.STRIPE_FAKE = "1";
    process.env.STRIPE_SECRET_KEY = "";
    const ok = `acct_fake_${randomUUID().slice(0, 8)}`, needs = `acct_fake_due${randomUUID().slice(0, 8)}`;
    const t = await tester({ account: ok });
    expect(await payoutDashboardUrl(await userOf(t.user.id), BASE)).toEqual({ url: `https://connect.stripe.test/express/${ok}`, kind: "dashboard" });
    const due = await tester({ account: needs, connected: false });
    expect(await payoutDashboardUrl(await userOf(due.user.id), BASE)).toEqual({ url: `https://connect.stripe.test/setup/${needs}`, kind: "onboarding" });
  });
});
