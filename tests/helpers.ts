import { randomBytes } from "node:crypto";
import { TERMS_VERSION } from "@/lib/termsOfUse";
import { db } from "@/lib/db";
import { createSession, SESSION_COOKIE } from "@/lib/server/session";

export const uniq = () => randomBytes(5).toString("hex");
export const email = (tag = "u") => `${tag}-${uniq()}@test.playtest.test`;

export async function makeUser(over: { name?: string; dev?: boolean; tester?: boolean; email?: string; pronoun?: string; unconfirmed?: boolean; termsVersion?: number; /** (batch 20 section 5) false: hasn't confirmed 18+ yet */ ageConfirmed?: boolean; /** (Batch 34 §6) false: deliberately test an account without a saved card */ savedCard?: boolean } = {}) {
  const user = await db.user.create({
    data: { email: over.email ?? email(), name: over.name ?? "Test Person", pronoun: over.pronoun ?? "", isDeveloper: over.dev ?? false, isTester: over.tester ?? false, emailVerifiedAt: over.unconfirmed ? null : new Date(), termsVersion: over.termsVersion ?? TERMS_VERSION, ageConfirmedAt: over.ageConfirmed === false ? null : new Date(), ...(over.dev && over.savedCard !== false ? { stripeCustomerId: `cus_${uniq()}`, stripePaymentMethodId: `pm_${uniq()}`, cardExpMonth: 12, cardExpYear: 2030 } : {}) },
  });
  if (over.tester) await db.testerProfile.create({ data: { userId: user.id, devices: ["Windows PC"], languages: ["English"], categories: [] } });
  const { token } = await createSession(user.id);
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}

export function req(path: string, opts: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new Request("http://localhost:3400" + path, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

export async function json(res: Response) {
  return { status: res.status, body: await res.json() };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * (Batch 30 §10; batch 35 §34) The tester's listing line: since batch 35 §34 ONE line for every edit since the page's seen time, with no field list and no time in
 * its text ("Nora Lane edited the listing"): `rest` (the fields the edits changed) stays in the calls as what the line covers (its See it marks them). The join
 * page's NDA line keeps its words: "Nora Lane changed the NDA: read and accept it again below".
 */
export const saveRe = (who: string, rest: string, verb = "edited the listing") => new RegExp(`^${esc(who)} ${verb}${verb === "edited the listing" ? "" : `: ${esc(rest)}`}$`);

/**
 * (Batch 35 §148) A one payment for what's owed made while the developer was away (the new-card charge of what's owed before §148, the daily retry before §145).
 * The app no longer makes one, but rows like it may still be open (a 3-day "Confirm with your bank", a lost answer): tests that check how such a row ends set it up here.
 */
export async function legacyAwayOwed(devId: string) {
  const u = await db.user.findUnique({ where: { id: devId } });
  if (!u?.holdStartedAt || u.deletedAt || u.holdReason === "chargeback") return null;
  const { stripeOn } = await import("@/lib/server/stripe");
  if (!stripeOn() || !u.stripeCustomerId || !u.stripePaymentMethodId) return null;
  const holds = await import("@/lib/server/holds");
  const once = await import("@/lib/server/owedOnce");
  await once.resumeStaleOwed(devId, new Date());
  const locks = await once.owedLocks(devId);
  const list = holds.withDebt((await holds.payable(devId)).filter((p) => !locks.has(p.id)));
  if (!list.length) return null;
  const r = await once.chargeOwedTotal(u, list, "away");
  const cents = r.result === "paid" ? r.cents : 0;
  const lifted = cents > 0 ? await holds.liftHoldIfClear(devId) : false;
  return { cents, lifted };
}

/**
 * (Owner, Nov 5, batch 35 §246) Rendered markup with every cut "what" (WhatLine, closed: its first 30 characters, "…" and the arrow) put back whole, as its hover
 * (title) holds it, the way the arrow opens it: for tests that read a payment or confirm row's whole words.
 */
export const openWhats = (html: string) => html.replace(/<span title="([^"]*)" data-what-cut="">[\s\S]*?<button[^>]*data-whole-toggle=""[^>]*>[\s\S]*?<\/button>/g, "$1");

