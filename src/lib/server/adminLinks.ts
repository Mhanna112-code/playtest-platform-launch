import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import type { Rich, Seg } from "@/lib/rich";
import { REPORTED_LABEL } from "./reports";

// (Owner, Oct 30, batch 33 §1) The links of the admin console and the admin boxes: every developer or tester named opens their profile (with its admin box), shown as
// "Nora Lane (nora@…)" with the name as the link; every test named opens its page (with its admin box); every Stripe id opens that object in the Stripe Dashboard.

export type Who = { id: string; email: string; name: string; isDeveloper: boolean; deletedAt: Date | null };

/** The profile page an admin opens for an account (the one the Accounts list links to): the developer's, or else the tester's. Both carry the admin box. */
export const profileHref = (u: { id: string; isDeveloper: boolean }) => (u.isDeveloper ? `/app/developers/${u.id}` : `/app/testers/${u.id}`);

/** A test's page (the team's Find view, with the test's admin box). */
export const testHref = (testId: string) => `/app/find/${testId}`;

/** "Nora Lane (nora@…)": the name opens the profile; a person reported more than 3 times keeps that label after it. */
export function person(u: Who | null | undefined, flagged = false): Seg[] {
  if (!u) return ["a deleted account"];
  return [{ t: displayName(u), href: profileHref(u) }, ` (${u.email})${flagged ? ` (${REPORTED_LABEL})` : ""}`];
}
/** Just the name, as a link (where the email was already given on the row). */
export const personName = (u: Who | null | undefined): Seg => (u ? { t: displayName(u), href: profileHref(u) } : "a deleted account");

/** “Harbor Run”, opening the test's page. */
export const testLink = (t: { id: string; title: string } | null | undefined): Seg => (t ? { t: `“${t.title}”`, href: testHref(t.id) } : "“?”");

/** The accounts by id, for the links (deleted ones too: they still open their profile's admin box). */
export async function whoById(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, Who>();
  const rows = await db.user.findMany({ where: { id: { in: list } }, select: { id: true, email: true, name: true, isDeveloper: true, deletedAt: true } });
  return new Map(rows.map((u) => [u.id, u]));
}

/**
 * (Batch 33 §1) A Stripe object's page in the Stripe Dashboard: test mode for a test key (https://dashboard.stripe.com/test/payments/<id>), live otherwise. Built here on
 * the server from the key's prefix only; the key itself never leaves the server. "" for an id that isn't a Stripe object's.
 */
export function stripeDashboardUrl(id: string | null | undefined) {
  if (!id) return "";
  const test = /^[sr]k_test_/.test(process.env.STRIPE_SECRET_KEY?.trim() ?? "");
  const base = `https://dashboard.stripe.com/${test ? "test/" : ""}`;
  if (/^(pi|ch|py)_/.test(id)) return `${base}payments/${id}`;
  if (/^tr_/.test(id)) return `${base}connect/transfers/${id}`;
  if (/^(dp|du)_/.test(id)) return `${base}disputes/${id}`;
  if (/^re_/.test(id)) return `${base}refunds/${id}`;
  return "";
}
/** A Stripe id as a link to its Dashboard page (new tab), or the id alone when it isn't a Stripe object's. */
export const stripeLink = (id: string): Seg => {
  const href = stripeDashboardUrl(id);
  return href ? { t: id, href, ext: true } : id;
};
/** " · pi_… · tr_…": a payment's Stripe ids (its PaymentIntent, else its charge; and its transfer), each a Dashboard link. Nothing when it has none. */
export function stripeIds(p: { stripePaymentIntentId?: string | null; stripeChargeId?: string | null; stripeTransferId?: string | null }): Rich {
  const ids = [p.stripePaymentIntentId || p.stripeChargeId, p.stripeTransferId].filter((x): x is string => !!x);
  return ids.flatMap((id) => [" · ", stripeLink(id)]);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * (Batch 33 §1) A line already written in words ("Nora Lane paid Ana Silva $10.00 …"): each of these people's names becomes their profile link with the email after it.
 * Whole words only (never inside an email), longest name first.
 */
export function linkNames(text: string, people: (Who | null | undefined)[]): Rich {
  const known = new Map<string, Who>();
  for (const u of people) if (u && !known.has(displayName(u))) known.set(displayName(u), u);
  const names = [...known.keys()].filter((n) => n.length > 1).sort((a, b) => b.length - a.length);
  if (!names.length) return [text];
  // Never inside an email address ("ana@…", "dev+ana@…").
  const re = new RegExp(`(?<![\\p{L}\\p{N}@.+_-])(${names.map(esc).join("|")})(?![\\p{L}\\p{N}@]|\\.[\\p{L}\\p{N}])`, "gu");
  const out: Rich = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push(text.slice(at, m.index));
    out.push(...person(known.get(m[1])));
    at = m.index! + m[1].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
