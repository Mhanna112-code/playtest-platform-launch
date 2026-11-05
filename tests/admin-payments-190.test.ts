import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import React, { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { DevPaidList, TesterEarnedList } from "@/components/PaymentLists";
import { AdminPersonBoxes } from "@/app/admin/AdminBoxes";
import { accountPaymentsForAdmin, stripeUrl } from "@/lib/server/paymentLists";
import { owedForBox, startHold } from "@/lib/server/holds";
import { withDateZone } from "@/lib/server/dateZone";
import { makeUser } from "./helpers";
import { joined, sact, settle, setup } from "./fixtures";

// (Owner, Nov 4, §190) A person's admin box shows the team the SAME payments lists that person sees on Payments (the developer's "What you've paid" and its total,
// "What you owe" during a hold; the tester's "Your earnings"), read-only, dates in the admin's zone, and a "Stripe" link on each payment with a PaymentIntent.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, adminAway() {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/payments", useRouter: () => ({ refresh() {} }), useSearchParams: () => new URLSearchParams(), notFound() { throw new Error("notFound"); } }));
(globalThis as unknown as { React: typeof React }).React = React;
const key = process.env.STRIPE_SECRET_KEY;
afterEach(() => { process.env.STRIPE_SECRET_KEY = key; });

/** The first element in a server-rendered tree matching `is` (the tree's own elements: function components are not called). */
function find(node: ReactNode, is: (e: ReactElement<Record<string, unknown>>) => boolean): ReactElement | undefined {
  if (Array.isArray(node)) { for (const n of node) { const f = find(n, is); if (f) return f; } return; }
  if (!isValidElement(node)) return;
  const e = node as ReactElement<Record<string, unknown>>;
  return is(e) ? e : find(e.props.children as ReactNode, is);
}
/** One list's section in rendered markup. */
const sectionOf = (html: string, side: "developer" | "tester") => html.match(new RegExp(`<section[^>]*data-paid-list="${side}"[\\s\\S]*?</section>`))?.[0] ?? "";

/** The person's own Payments page, as they get it: the list element it draws, rendered. */
async function ownList(u: User, side: "developer" | "tester") {
  auth.user = u;
  const { default: Payments } = await import("@/app/app/payments/page");
  const tree = await Payments({ searchParams: Promise.resolve({}) });
  const el = find(tree, (e) => e.type === (side === "developer" ? DevPaidList : TesterEarnedList));
  expect(el, `Payments draws the ${side} list`).toBeTruthy();
  return renderToStaticMarkup(el!);
}
/** The admin box on the person's profile: the team's copy of their lists, rendered (with the Stripe key's mode as given). */
async function adminView(userId: string, adminId: string, mode: "test" | "live" = "test") {
  const tree = await AdminPersonBoxes({ userId, adminId, developer: true, tester: true });
  const el = find(tree, (e) => "theirs" in e.props);
  if (!el) return "";
  process.env.STRIPE_SECRET_KEY = mode === "test" ? "sk_test_x" : "sk_live_x";
  try { return renderToStaticMarkup(el); } finally { process.env.STRIPE_SECRET_KEY = key; }
}
/** The team's copy with what only the team gets taken out (each Stripe link; a test opens its team page, not the developer's own): the developer's markup. */
const asOwn = (html: string) => html.replace(/ · <a href="https:\/\/dashboard\.stripe\.com\/[^"]*" target="_blank" rel="noreferrer" data-stripe-link="">Stripe<\/a>/g, "").replace(/href="\/app\/find\//g, 'href="/app/tests/');

async function admin(timeZone = "America/New_York") {
  const a = await makeUser({ dev: true, name: "Team Admin" });
  return db.user.update({ where: { id: a.user.id }, data: { isAdmin: true, timeZone } });
}

/** A developer (zone New York) with every way a payment is made: Pay, Pay more, Confirm all, confirmed with the bank, Pay what you owe, a chargeback won after it was repaid. */
async function world() {
  const s = await setup();
  const t: (Awaited<ReturnType<typeof joined>> & { sub: { id: string } })[] = [];
  for (const name of ["Ana Silva", "Ben Okafor", "Cid Moreau"]) {
    const j = await joined(s.testId, name);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
    t.push({ ...j, sub: await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } }) });
  }
  await settle();
  const devId = s.dev.user.id;
  await db.user.update({ where: { id: devId }, data: { timeZone: "America/New_York" } });
  const pi = () => "pi_" + randomUUID().replace(/-/g, "").slice(0, 20);
  let at = Date.parse("2026-10-20T15:00:00Z");
  const next = () => new Date((at += 3_600_000));
  const piece = (i: number) => ({ contractId: t[i].sessionId, submissionId: t[i].sub.id, developerId: devId, testerId: t[i].tester.user.id });
  const pay = (i: number, cents: number, over: Record<string, unknown> = {}) =>
    db.payment.create({ data: { kind: "review", ...piece(i), amountCents: cents, feeCents: Math.round(cents / 10), testerCents: cents - Math.round(cents / 10), status: "charged", transferStatus: "sent", stripePaymentIntentId: pi(), createdAt: next(), ...over } });
  const one = (note: string, cents: number) => db.payment.create({ data: { kind: "owed", developerId: devId, testerId: devId, amountCents: cents, feeCents: cents, testerCents: 0, status: "bundled", note, stripePaymentIntentId: pi(), settledAt: new Date(), createdAt: next() } });
  const normal = await pay(0, 1000);
  const more = await pay(0, 500, { kind: "extra" });
  const all = await one("press:all", 1200);
  const confirmAll = await pay(1, 1200, { settledAt: new Date(), coveredById: all.id, stripePaymentIntentId: all.stripePaymentIntentId });
  const bank = await pay(2, 800, { settledAt: new Date() });
  const owe = await one("press", 900);
  const bundle = await pay(2, 900, { kind: "extra", owedUntil: new Date(), settledAt: new Date(), coveredById: owe.id, stripePaymentIntentId: owe.stripePaymentIntentId });
  // A chargeback won after it was repaid: the reversed payment stays listed ("your bank reversed this"), its repayment is refunded (listed, out of the total).
  const reversed = await pay(1, 1000, { chargebackAt: new Date(), chargeback: "won" });
  const repay = await db.payment.create({ data: { kind: "chargeback", developerId: devId, testerId: t[1].tester.user.id, contractId: t[1].sessionId, amountCents: 2500, feeCents: 2500, testerCents: 0, status: "refunded", repaysId: reversed.id, stripePaymentIntentId: pi(), createdAt: next() } });
  // A tester's share delayed until her payout account is ready (recorded with payments not set up: no PaymentIntent).
  const delayed = await pay(0, 700, { status: "not_set_up", transferStatus: "waiting", stripePaymentIntentId: null });
  return { ...s, devId, t, pays: { normal, more, confirmAll, bank, bundle, reversed, repay, delayed } };
}

/** (§246) The markup without the rows' arrows (the only buttons in a read-only list). */
const noArrows = (html: string) => html.replace(/<button[^>]*data-whole-toggle=""[^>]*>[\s\S]*?<\/button>/g, "");

describe("§190 the team sees a person's Payments lists as they do", () => {
  it("a developer: the same rows, labels and total as their own Payments; a Stripe link (test mode) on each payment with a PaymentIntent; no button", async () => {
    const w = await world();
    const a = await admin("America/New_York"); // the same zone as the developer: the two lists are the same markup
    const dev = await db.user.findUniqueOrThrow({ where: { id: w.devId } });
    const own = await ownList(dev, "developer");
    const team = sectionOf(await adminView(w.devId, a.id), "developer");
    expect(team).not.toBe("");
    expect(asOwn(team)).toBe(own);
    // The set: each way of paying reads as the developer reads it.
    // (Owner, Nov 5, §246) A row's "what" is cut at 50 (§251) with its arrow; the whole of it is the row's hover (title), so the set is read from the markup too.
    const raw = own.replace(/&#x27;/g, "'"), text = raw.replace(/<[^>]+>/g, "");
    for (const s of [
      "Ana Silva's written answers on “Harbor Run”", "Pay more for Ana Silva's written answers", "Confirm all", "confirmed with your bank",
      "Pay what you owe", "Repaid the reversed $10.00 payment for Ben Okafor's written answers", "refunded (your bank's chargeback was reversed)",
      "your bank reversed this, then decided in your favour (chargeback won)", "recorded (payments not set up)",
    ]) expect(raw, s).toContain(s);
    // Total: everything that went through; the refunded repayment is out, the won chargeback's payment counts (paidOutTotal).
    expect(text).toContain(`Total $${((1000 + 500 + 1200 + 800 + 900 + 1000 + 700) / 100).toFixed(2)}`);
    // Stripe: each payment with a PaymentIntent, test mode; none for the one without.
    for (const p of Object.values(w.pays)) if (p.stripePaymentIntentId) expect(team).toContain(`href="https://dashboard.stripe.com/test/payments/${p.stripePaymentIntentId}"`);
    // (Owner, Nov 4, §192) And the refunded repayment's own negative refund line, linking the PaymentIntent it was refunded from.
    expect(team.match(/data-stripe-link=""/g)).toHaveLength(Object.values(w.pays).filter((p) => p.stripePaymentIntentId).length + 1);
    expect(raw).toContain("title=\"Refunded: your bank's chargeback on your $10.00 Pay for Ben Okafor's written answers on “Harbor Run” was reversed in your favour\"");
    expect(text).toContain("· −$25.00");
    // (§246) The only buttons: each cut row's arrow.
    expect(noArrows(team)).not.toContain("<button");
    expect(team).not.toMatch(/>(Pay|Confirm|Cancel)[^<]*<\/button>/);
    // The test opens its team page.
    expect(team).toContain(`href="/app/find/${w.testId}"`);
  });

  it("dates are in the admin's zone; live keys link to the live Dashboard", async () => {
    const w = await world();
    const a = await admin("Asia/Tokyo");
    const team = sectionOf(await adminView(w.devId, a.id, "live"), "developer");
    const { fmtDateTimeIn } = await import("@/lib/format");
    expect(team).toContain(fmtDateTimeIn(w.pays.normal.createdAt, "Asia/Tokyo"));
    expect(team).not.toContain(fmtDateTimeIn(w.pays.normal.createdAt, "America/New_York"));
    expect(team).toContain(`href="https://dashboard.stripe.com/payments/${w.pays.normal.stripePaymentIntentId}"`);
    expect(team).not.toContain("dashboard.stripe.com/test/");
    expect(stripeUrl(null)).toBe("");
    expect(stripeUrl("ch_123")).toBe(""); // only a PaymentIntent
  });

  it("a tester: the same Your earnings (delayed share marked as hers) as her own Payments", async () => {
    const w = await world();
    const a = await admin("America/New_York");
    const ana = await db.user.update({ where: { id: w.t[0].tester.user.id }, data: { timeZone: "America/New_York" } });
    const own = await ownList(ana, "tester");
    const team = sectionOf(await adminView(ana.id, a.id), "tester");
    expect(team).not.toBe("");
    expect(asOwn(team)).toBe(own);
    expect(own).toContain("delayed until your payout account is ready");
    expect(own.replace(/<[^>]+>/g, "")).toContain(`Total $${((900 + 450 + 630) / 100).toFixed(2)}`);
    expect(team).toContain(`https://dashboard.stripe.com/test/payments/${w.pays.normal.stripePaymentIntentId}`);
    expect(noArrows(team)).not.toContain("<button");
  });

  it("What you owe during a hold: the developer's lines, read-only", async () => {
    const w = await world();
    const a = await admin();
    // (§251) A 20-character name, so the owed line's "what" (54 characters) is longer than the 50 shown and is cut.
    await db.user.update({ where: { id: w.t[1].tester.user.id }, data: { name: "Benedikt Okafor-Diaz" } });
    await db.payment.create({ data: { kind: "review", contractId: w.t[1].sessionId, submissionId: w.t[1].sub.id, developerId: w.devId, testerId: w.t[1].tester.user.id, amountCents: 800, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(), stripePaymentIntentId: "pi_failed123" } });
    await startHold(w.devId, "unpaid");
    // The lines as owedForBox writes them, dates in the admin's zone (as the box reads them).
    const lines = await withDateZone(a.timeZone, () => owedForBox(w.devId));
    expect(lines.length).toBeGreaterThan(0);
    const html = (await adminView(w.devId, a.id)).replace(/&#x27;/g, "'");
    const box = html.match(/<section[^>]*data-owed-readonly=""[\s\S]*?<\/section>/)?.[0] ?? "";
    // (§246) Each line's "what" (cut at 50, §251; whole in its hover) and its amount and status outside the cut.
    expect(lines.some((l) => Array.from(l.what).length > 50)).toBe(true);
    for (const l of lines) {
      expect(box).toContain(Array.from(l.what).length > 50 ? `title="${l.what.replace(/&/g, "&amp;")}"` : l.what.replace(/&/g, "&amp;"));
      expect(box).toContain(l.rest.replace(/&/g, "&amp;"));
    }
    expect(box).toContain("https://dashboard.stripe.com/test/payments/pi_failed123");
    expect(noArrows(box)).not.toContain("<button");
  });

  it("only admins: anyone else gets nothing", async () => {
    const w = await world();
    const other = await makeUser({ dev: true, name: "Not Admin" });
    expect(await accountPaymentsForAdmin(other.user, w.devId)).toBeNull();
    expect(await adminView(w.devId, other.user.id)).toBe("");
    // A suspended admin isn't an admin.
    const a = await admin();
    const paused = await db.user.update({ where: { id: a.id }, data: { devSuspendedAt: new Date() } });
    expect(await accountPaymentsForAdmin(paused, w.devId)).toBeNull();
    expect(await accountPaymentsForAdmin(await admin(), w.devId)).not.toBeNull();
    // And the box itself is drawn only for an admin viewing someone else's profile.
    for (const f of ["src/app/app/developers/[id]/page.tsx", "src/app/app/testers/[id]/page.tsx"]) expect(readFileSync(f, "utf8")).toContain("{isAdmin(viewer) && !mine && <AdminPersonBoxes");
  });
});
