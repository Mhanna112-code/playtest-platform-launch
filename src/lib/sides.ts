// (NEXT-UI 6) One account can be a developer, a tester, or both (the full app's lib/sides.ts, on lean's flags). `side` is the
// side in use right now (kept on the account, "developer" | "tester"); an account with one side only is always on it.
export type Side = "developer" | "tester";
type Sided = { isDeveloper: boolean; isTester: boolean; side?: string };

export const hasSide = (u: Sided, side: Side) => (side === "developer" ? u.isDeveloper : u.isTester);
/** Both sides? (Shows the switch in the header.) */
export const hasBoth = (u: Sided) => u.isDeveloper && u.isTester;

/**
 * Which side a page belongs to, from its address: developer pages (their tests), tester pages (Find, their sessions),
 * or shared ones (dashboard, chat, calls, notifications, payments, profile: null). With both sides, each tab shows the
 * side of the page it is on, so a developer tab and a tester tab can sit side by side, each labelled correctly.
 */
export function sideForPath(path: string): Side | null {
  const p = path.split(/[?#]/)[0];
  if (p === "/app/tests" || p.startsWith("/app/tests/") || p === "/app/testers" || p.startsWith("/app/testers/")) return "developer";
  if (["/app/find", "/app/sessions", "/app/developers"].some((x) => p === x || p.startsWith(`${x}/`))) return "tester";
  return null;
}

/** The side a tab shows: the page's own side (with both sides), else the side used last, else the only side the account has. */
export function sideFor(u: Sided, path: string): Side | null {
  if (!u.isDeveloper && !u.isTester) return null;
  if (!hasBoth(u)) return u.isDeveloper ? "developer" : "tester";
  return sideForPath(path) ?? (u.side === "developer" || u.side === "tester" ? u.side : "developer");
}

/**
 * A link to a page for the other side (a notification about your own test while you're testing, say): through
 * /app/switch, which changes sides and then goes straight there. Other links stay as they are.
 */
export function sideLink(u: Sided, href: string) {
  const to = sideForPath(href);
  return hasBoth(u) && to && to !== u.side ? `/app/switch?to=${to}&next=${encodeURIComponent(href)}` : href;
}
