import { devRestricted, type Restrictable } from "@/lib/restricted";

type Who = Restrictable & { isDeveloper: boolean; isTester: boolean; side?: string };

/**
 * (Owner, Oct 28) The ONLY signed-in pages a restricted account may open: the dashboard, Payments (receipts, Pay what you owe, Change card, payout setup), Settings
 * (the account page and Blocked people, Contact us, the email setting; the profile editor stays hidden) and the bell list (with the email setting). The side switch is a
 * redirect, not a page. Every other signed-in page moves them to the dashboard top: tester and developer profile pages, session pages, call pages, Find tests and
 * test listings, Messages and chat, Edit, test pages, Post a test and the profile editor.
 */
export const OPEN_FOR_RESTRICTED = ["/app", "/app/payments", "/app/account", "/app/help", "/app/notifications", "/app/switch"] as const;

const clean = (path: string) => path.split(/[?#]/)[0].replace(/\/$/, "") || "/";
export const openForRestricted = (path: string) => {
  const p = clean(path);
  return OPEN_FOR_RESTRICTED.some((x) => p === x || (x !== "/app" && p.startsWith(`${x}/`)));
};

/**
 * Is the account restricted on this side? A suspended tester, and a developer under a suspension, a payment hold or a chargeback hold (on their developer side).
 * An admin suspension closes both sides; a payment or chargeback hold restricts only the developer side, so an account with both sides keeps its tester side open.
 * A tester whose DEVELOPER is suspended or on hold is not restricted (their test is only paused).
 */
export function restrictedOn(u: Who, side?: string | null) {
  if (u.suspendedAt) return true;
  return u.isDeveloper && devRestricted(u, side);
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
  if (!u.suspendedAt && !role && byRole(p) && u.isDeveloper && u.isTester) return false;
  return restrictedOn(u, role ?? side);
}
