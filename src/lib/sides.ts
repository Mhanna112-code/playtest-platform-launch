// (NEXT-UI 6) One account can be a developer, a tester, or both (the full app's lib/sides.ts, on lean's flags). `side` is the
// side in use right now (kept on the account, "developer" | "tester"); an account with one side only is always on it.
export type Side = "developer" | "tester";
type Sided = { isDeveloper: boolean; isTester: boolean; side?: string };

export const hasSide = (u: Sided, side: Side) => (side === "developer" ? u.isDeveloper : u.isTester);
/** Both sides? (Shows the switch in the header.) */
export const hasBoth = (u: Sided) => u.isDeveloper && u.isTester;

/**
 * Which side a page belongs to, from its address: developer pages (their tests), tester pages (Find, their sessions),
 * or shared ones (dashboard, chat, calls, notifications, payments, profile: null). The saved side controls the header; an opposite-side page shows a switch notice.
 */
export function sideForPath(path: string): Side | null {
  const p = path.split(/[?#]/)[0];
  if (p === "/app/tests" || p.startsWith("/app/tests/") || p === "/app/testers" || p.startsWith("/app/testers/")) return "developer";
  if (["/app/find", "/app/sessions", "/app/developers"].some((x) => p === x || p.startsWith(`${x}/`))) return "tester";
  return null;
}

/** The current saved side, or the only side the account has. Opening a page never changes it. */
export function sideFor(u: Sided, path: string): Side | null {
  if (!u.isDeveloper && !u.isTester) return null;
  if (!hasBoth(u)) return u.isDeveloper ? "developer" : "tester";
  void path;
  return u.side === "tester" ? "tester" : "developer";
}

/**
 * Links go straight to the page. Its layout explains if an explicit side switch is needed.
 */
export function sideLink(u: Sided, href: string) {
  void u;
  return href;
}
