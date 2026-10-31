// (NEXT-UI 6) One account can be a developer, a tester, or both (the full app's lib/sides.ts, on lean's flags). `side` is the
// side in use right now (kept on the account, "developer" | "tester"); an account with one side only is always on it.
export type Side = "developer" | "tester";
type Sided = { isDeveloper: boolean; isTester: boolean; side?: string };

export const hasSide = (u: Sided, side: Side) => (side === "developer" ? u.isDeveloper : u.isTester);
/** Both sides? (Shows the switch in the header.) */
export const hasBoth = (u: Sided) => u.isDeveloper && u.isTester;

/**
 * Which side a page belongs to, from its address: developer pages (their tests, testers' profiles), tester pages (Find, their sessions, developers'
 * profiles), or shared ones (dashboard, chat, calls, notifications, payments, profile: null). (Owner, Oct 30, batch 34 §5) The two sides are like two
 * separate accounts: the side in use (the account's `side`) is changed only by the switch button, and a page of the other side shows a notice instead.
 * `userId`: your own public profile belongs to the side it shows (/app/testers/<you> is your tester side's "How developers see you").
 */
export function sideForPath(path: string, userId?: string): Side | null {
  const p = path.split(/[?#]/)[0].replace(/\/$/, "");
  if (userId && p === `/app/testers/${userId}`) return "tester";
  if (userId && p === `/app/developers/${userId}`) return "developer";
  if (p === "/app/tests" || p.startsWith("/app/tests/") || p === "/app/testers" || p.startsWith("/app/testers/")) return "developer";
  if (["/app/find", "/app/sessions", "/app/developers"].some((x) => p === x || p.startsWith(`${x}/`))) return "tester";
  return null;
}

/**
 * The side in use: the account's saved side (changed only by the switch button), or the only side the account has. (Batch 34 §5) Opening a page never
 * changes it, and a page's address no longer decides it (`path` is kept for the callers' readability).
 */
export function sideFor(u: Sided, path?: string): Side | null {
  void path;
  if (!u.isDeveloper && !u.isTester) return null;
  if (!hasBoth(u)) return u.isDeveloper ? "developer" : "tester";
  return u.side === "tester" ? "tester" : "developer";
}

/**
 * (Batch 34 §5) The other side, when this page belongs to it (an account with both sides, on the other one): the page shows only "This page is on your
 * <side> side." with the switch button. Null otherwise. Admin accounts have no side (callers leave them out).
 */
export function otherSideOfPage(u: Sided & { id?: string }, path: string): Side | null {
  if (!hasBoth(u)) return null;
  const page = sideForPath(path, u.id);
  return page && page !== sideFor(u) ? page : null;
}

/** (Batch 34 §5) Links go straight to the page (no in-between switch page): a page of the other side shows the notice with the switch button. */
export function sideLink(u: Sided, href: string) {
  void u;
  return href;
}
