// (Batch 17 §5 and §7) The admin lists: search boxes and tick boxes (Accounts, Tests), and the scroll box every admin list now is (no pages). Shared wording
// and the small rules the box follows, kept pure so the page, the server and the tests use the same ones.

/** (Batch 17 §5) The Accounts list's tick boxes. Within a group a row matches ANY ticked box; the two groups (roles, states) must both match. */
export const USER_TICKS = [
  { value: "developer", label: "Developer", group: "role" },
  { value: "tester", label: "Tester", group: "role" },
  { value: "suspended", label: "Suspended", group: "state" },
  { value: "hold", label: "On a hold", group: "state" },
  { value: "deleted", label: "Deleted", group: "state" },
] as const;
/** (Batch 17 §5) The Tests list's tick boxes (a test matches ANY ticked state). */
export const TEST_TICKS = [
  { value: "open", label: "Open" },
  { value: "joining-closed", label: "Joining closed" },
  { value: "paused", label: "Paused" },
  { value: "stopped", label: "Stopped / closed" },
  { value: "draft", label: "Draft" },
] as const;
export type UserTick = (typeof USER_TICKS)[number]["value"];
export type TestTick = (typeof TEST_TICKS)[number]["value"];

/** The lists with a search box and tick boxes, and what each box says. */
export const SEARCHABLE = {
  users: { label: "Search accounts", placeholder: "Name or email", ticks: USER_TICKS, none: "No accounts match." },
  tests: { label: "Search tests", placeholder: "Test, product or developer (name or email)", ticks: TEST_TICKS, none: "No tests match." },
} as const;
export type SearchKind = keyof typeof SEARCHABLE;
export const isSearchKind = (k: string): k is SearchKind => k === "users" || k === "tests";
/** A typed search is cut to this length (the server does the same). */
export const SEARCH_MAX = 200;
/** "After a short pause" (Batch 17 §5): the list reloads this long after the last key. */
export const SEARCH_PAUSE_MS = 300;

/** The ticks the server accepts for a list, from the request's comma-separated value (anything else is dropped). */
export function ticksOf(kind: string, raw: string | null | undefined): string[] {
  if (!isSearchKind(kind) || !raw) return [];
  const allowed = new Set<string>(SEARCHABLE[kind].ticks.map((t) => t.value));
  return [...new Set(raw.split(",").map((x) => x.trim()).filter((x) => allowed.has(x)))];
}
export const searchOf = (raw: string | null | undefined) => (raw ?? "").trim().slice(0, SEARCH_MAX);

// ---------- The scroll box (Batch 17 §7) ----------

export const LOADING_LINE = "Loading…";
const n = (x: number) => x.toLocaleString("en-US");
/** The end line once everything is loaded: "That's all (1,204)". */
export const endLine = (total: number) => `That's all (${n(total)})`;
/** The heading keeps the total: "Accounts (1,204)"; with a search or ticks, "Accounts: 12 match". */
export const headingText = (title: string, total: number, filtered: boolean) => (filtered ? `${title}: ${n(total)} match` : `${title} (${n(total)})`);
/** The pill over a box scrolled down when rows arrived live at its top. */
export const newRowsPill = (count: number) => `${count} new ↑`;

/** The next 25 load when the box is this close to its end. */
export const NEAR_END_PX = 240;
export const nearEnd = (b: { scrollTop: number; clientHeight: number; scrollHeight: number }) => b.scrollHeight - b.scrollTop - b.clientHeight < NEAR_END_PX;
/** Scrolled less than this: the box counts as "at the top" (live rows go straight in; no pill). */
export const AT_TOP_PX = 8;
export const atTop = (b: { scrollTop: number }) => b.scrollTop < AT_TOP_PX;
/** How often an open box (on screen, tab visible) looks for new rows at its top. */
export const LIVE_POLL_MS = 20_000;

/** The rows of a fresh first page that are ahead of every row already shown (the live arrivals). */
/**
 * (Batch 22 section 5; batch 27 section 5) The rows shown, each replaced by its fresh copy when the live check has one that differs (a pause lifted elsewhere: the row's
 * state line and its Pause / Lift the pause follow), searched list or not. The same array when nothing changed (no re-render).
 */
export function shownWithFresh<T extends { id: string }>(shown: T[], fresh: T[]): T[] {
  const byId = new Map(fresh.map((x) => [x.id, x]));
  return shown.some((x) => byId.has(x.id) && JSON.stringify(byId.get(x.id)) !== JSON.stringify(x)) ? shown.map((x) => byId.get(x.id) ?? x) : shown;
}

export function newRowsAhead<T extends { id: string }>(fresh: T[], shown: T[]): T[] {
  const known = new Set(shown.map((r) => r.id));
  const out: T[] = [];
  for (const r of fresh) {
    if (known.has(r.id)) break;
    out.push(r);
  }
  return out;
}

/**
 * The box after taking in a fresh first page: the new rows go on top of what is shown. When none of the fresh rows is shown yet (more than a page arrived, or the
 * list was empty), the box starts over from that page (`replaced`: its own cursor applies).
 */
export function mergeTop<T extends { id: string }>(fresh: T[], shown: T[]): { rows: T[]; replaced: boolean; added: number } {
  const ahead = newRowsAhead(fresh, shown);
  if (!fresh.length) return { rows: shown, replaced: false, added: 0 };
  if (ahead.length === fresh.length) return { rows: fresh, replaced: true, added: ahead.length };
  return { rows: [...ahead, ...shown], replaced: false, added: ahead.length };
}
