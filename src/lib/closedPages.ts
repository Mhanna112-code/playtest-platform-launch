import { devRestricted, testerRestricted, type Restrictable } from "@/lib/restricted";

type Who = Restrictable & { isDeveloper: boolean; isTester: boolean; side?: string };

/**
 * (Owner, Oct 28) The ONLY signed-in pages a restricted account may open: the dashboard, Payments (receipts, Pay what you owe, Change card, payout setup), Settings
 * (the account page and Blocked people, Contact us, the email setting; the profile editor stays hidden) and the bell list (with the email setting). The side switch is a
 * redirect, not a page. Every other signed-in page moves them to the dashboard top: tester and developer profile pages, session pages, call pages, Find tests and
 * test listings, Messages and chat, Edit, test pages, Post a test and the profile editor.
 */
export const OPEN_FOR_RESTRICTED = ["/app", "/app/payments", "/app/account", "/app/help", "/app/notifications", "/app/switch"] as const;

/** (Owner, Oct 30, batch 15 section 29) A test page opens for a restricted developer in its restricted view (overview, Stop, End early, Booked calls); Edit and Post stay closed. */
export const isTestPage = (path: string) => /^\/app\/tests\/(?!new$)[^/]+$/.test(clean(path));

const clean = (path: string) => path.split(/[?#]/)[0].replace(/\/$/, "") || "/";
/** (Owner, Oct 28, batch 16 section 28) A session page opens for a suspended tester side only as the limited view of a test they were removed from: the page decides. */
export const isSessionPage = (path: string) => /^\/app\/sessions\/[^/]+$/.test(clean(path));
export const openForRestricted = (path: string) => {
  const p = clean(path);
  return OPEN_FOR_RESTRICTED.some((x) => p === x || (x !== "/app" && p.startsWith(`${x}/`)));
};

/**
 * Is the account restricted on this side? A tester whose tester side is suspended, and a developer under a developer-side suspension, a payment hold or a chargeback
 * hold. (Batch 15 section 16) Each restriction closes only its own side, so an account with both sides keeps the other side open.
 * A tester whose DEVELOPER is suspended or on hold is not restricted (their test is only paused).
 */
export function restrictedOn(u: Who, side?: string | null) {
  return testerRestricted(u, side) || devRestricted(u, side);
}

/** Pages whose side is the person's role in ONE contract (developer or tester there), not the address: the page itself decides from that role. */
const byRole = (p: string) => p.startsWith("/app/chat/") || p.startsWith("/app/calls/");

/**
 * (Design doc 2; owner, Oct 27-28) Is this signed-in page closed to the account on this side? `role` is the person's side on the page itself when the page knows it
 * (their role in a chat or a call). Without it, a chat or call page of an account with both sides and only a hold is left to the page (the layout can't know the role).
 */
export function closedForSuspended(path: string, u: Who, side?: string | null, role?: "developer" | "tester") {
  const p = clean(path);
  if (!(p === "/app" || p.startsWith("/app/")) || openForRestricted(p)) return false;
  if (isTestPage(p) && !testerRestricted(u, role ?? side)) return false; // its restricted view (the page decides what shows)
  // (Batch 16 section 28) A suspended tester side: a session page opens as the limited view of a test they were removed from; the page sends anything else to the dashboard.
  if (isSessionPage(p) && testerRestricted(u, "tester")) return false;
  // A chat or call of an account with both sides: the page knows the role and decides, unless both sides are restricted.
  if (!role && byRole(p) && u.isDeveloper && u.isTester) return restrictedOn(u, "developer") && restrictedOn(u, "tester");
  return restrictedOn(u, role ?? side);
}
