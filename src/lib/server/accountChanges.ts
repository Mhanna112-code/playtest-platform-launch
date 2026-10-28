// (Owner, Oct 28, batch 16 section 27) Settings, the profile editor and Payments: what was changed in another tab or device. Each change is one ActionLog row
// (testId ACCOUNT, so no test page ever reads it; no new column): the page updates silently on its poll, and the FIRST press afterwards stops once
// with "Changed in another tab or device since you opened this page:" and a short line per change; the second press saves on top.
// A field changed elsewhere to exactly what this press sends isn't listed (section 17's same-value rule).
import { db } from "@/lib/db";
import { HttpError } from "./http";

/** The ActionLog "test" these rows belong to: never a real test id. */
export const ACCOUNT = "account";
/** Which page's presses a change stops. */
export type AccountScope = "payments" | "profile" | "settings";
/** One change: the field (to compare with what a press sends), its short label, and before → after (or a whole line). */
export type AccountChange = { scopes: AccountScope[]; field: string; label: string; before?: string; after?: string; line?: string; at?: boolean };
/** The heading of the stop box on these pages. */
export const ACCOUNT_STOP_HEADING = "Changed in another tab or device since you opened this page:";

const tabOf = (body: Record<string, unknown>) => (typeof body.tab === "string" ? body.tab.slice(0, 64) : "");
const dateOf = (v: unknown) => {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? d : null;
};

/** Records a change (no row when nothing changed). */
export async function logAccountChange(userId: string, tab: string, c: AccountChange) {
  if (c.before !== undefined && c.after !== undefined && c.before === c.after) return;
  await db.actionLog.create({ data: { userId, testId: ACCOUNT, tab: tab.slice(0, 64), text: JSON.stringify(c) } });
}

/** The newest change (any tab), for the pages' silent refresh. */
export async function latestAccountChange(userId: string) {
  return (await db.actionLog.findFirst({ where: { userId, testId: ACCOUNT }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }))?.createdAt ?? null;
}

/** The short form of a change: "Devices: Windows PC → Windows PC, iPad", "Password changed" (the box adds "at 3:10 PM"). */
export const changeLine = (c: AccountChange) => c.line ?? `${c.label}: ${c.before || "none"} → ${c.after || "none"}`;

/**
 * The changes another tab made since `since` for this page, one line per field (the first before, the latest after; a field changed and changed back
 * drops out). `sent`: the values this press sends, by field; a field changed elsewhere to exactly that value is not news.
 */
export async function accountChangesSince(userId: string, since: Date, scope: AccountScope, tab: string, sent: Record<string, string> = {}) {
  const rows = await db.actionLog.findMany({ where: { userId, testId: ACCOUNT, createdAt: { gt: since }, ...(tab ? { tab: { not: tab } } : {}) }, orderBy: { createdAt: "asc" }, take: 100 });
  const byField = new Map<string, { c: AccountChange; at: Date }>();
  for (const r of rows) {
    let c: AccountChange;
    try { c = JSON.parse(r.text) as AccountChange; } catch { continue; }
    if (!c || !Array.isArray(c.scopes) || !c.scopes.includes(scope)) continue;
    const prev = byField.get(c.field);
    byField.set(c.field, { c: prev && c.before !== undefined ? { ...c, before: prev.c.before } : c, at: r.createdAt });
  }
  return [...byField.values()]
    .filter(({ c }) => !(c.before !== undefined && c.after !== undefined && c.before === c.after))
    .filter(({ c }) => !(c.field in sent && c.after !== undefined && sent[c.field] === c.after))
    .map(({ c, at }) => ({ text: changeLine(c), at, kind: c.at ? "account-at" : "account" }));
}

/**
 * The gate for a press on these pages: the first press after a change elsewhere stops once with what changed; the second (confirmed, with the box's
 * time) goes ahead unless something newer happened. A press without the page's time (an older page, or an API call) goes ahead as before.
 */
export async function accountGate(userId: string, body: Record<string, unknown>, scope: AccountScope, sent: Record<string, string> = {}) {
  const boxAt = dateOf(body.boxAt);
  if (body.confirmed === true && !boxAt) return;
  const since = body.confirmed === true ? boxAt : dateOf(body.seenAt);
  if (!since) return;
  const changes = await accountChangesSince(userId, since, scope, tabOf(body), sent);
  if (changes.length) throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes, heading: ACCOUNT_STOP_HEADING, now: new Date().toISOString() });
}

// ---------- What each page's values read as, in the short form ----------

/** "Visa ending 4242" (or "a card" when the brand isn't known). */
export const cardLabel = (pm: { brand?: string | null; last4?: string | null } | null | undefined) =>
  pm?.last4 ? `${pm.brand ? pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1) : "Card"} ending ${pm.last4}` : pm ? "a card" : "no card";
/** A list of picks: "Windows PC, iPad" ("" = none). */
export const listLabel = (xs: string[]) => xs.join(", ");
/** The sides an account has: "developer", "tester", "developer and tester". */
export const sidesLabel = (dev: boolean, tester: boolean) => (dev && tester ? "developer and tester" : dev ? "developer" : tester ? "tester" : "none");

/**
 * The Payments page's plain form presses (Change card, payout setup), which go on to Stripe: the same gate from the form's hidden fields. Returns where
 * to go back to when it stops (the page shows the box under that button, from `since`), or null to go ahead.
 */
export async function formGate(userId: string, form: FormData, press: "card" | "payout", base: string) {
  const body: Record<string, unknown> = { seenAt: form.get("seenAt"), boxAt: form.get("boxAt"), confirmed: form.get("confirmed") === "1", tab: form.get("tab") };
  try {
    await accountGate(userId, body, "payments");
    return null;
  } catch (e) {
    if (!(e instanceof HttpError) || e.code !== "stop_once") throw e;
    const since = String(body.confirmed ? body.boxAt : body.seenAt);
    return `${base}/app/payments?stop=${press}&since=${encodeURIComponent(since)}&tab=${encodeURIComponent(String(body.tab ?? ""))}#${press}`;
  }
}
