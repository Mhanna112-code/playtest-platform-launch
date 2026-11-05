import { exactFirst, nameMatches } from "./nameSearch";
// (Owner, Oct 28, batch 16 section 13) The tester dashboard's "Search by developer": every test the tester has been in (working, finished, left, ended,
// stopped, closed), narrowed by the developer's name. (Owner, Nov 5, §204) Now "Search by developer or test": the developer's name or the test's
// name. Pure, so the dashboard's client box and the tests share it.

/** One test the tester has been in, as the search lists it. */
export type DevSearchRow = { id: string; title: string; developer: string; status: string; joinedAt: string; href: string | null };

/** The status word on a result row, from the contract (never says why a session ended). */
export function testStatusWord(c: { status: string; endKind: string }) {
  if (c.status === "working") return "Working on it";
  if (c.endKind === "rated") return "Finished";
  if (c.endKind === "stopped") return "Stopped";
  if (c.endKind === "closed") return "Closed";
  if (c.endKind === "suspended") return "Removed";
  if (c.status === "left") return "You left";
  return "Ended";
}

/**
 * (Owner, Nov 5, §204) Whether a test matches the box: its developer's name OR the test's name, by the name-search rule (batch 20 section 9: any case; 1-2
 * characters the start of a word or the whole text, 3+ any part). Blank: no match (the box is empty; callers show everything).
 */
export const devOrTestMatches = (r: { title: string; developer: string }, typed: string) => nameMatches(r.developer, typed) || nameMatches(r.title, typed);

/**
 * The tests whose developer's name or (Owner, Nov 5, §204) test name matches `typed` (devOrTestMatches), an exact developer or test name first, then most recent
 * first (by when the tester joined). Blank: none (the normal dashboard shows).
 */
export function searchByDeveloper(rows: DevSearchRow[], typed: string): DevSearchRow[] {
  const q = typed.trim().toLowerCase();
  if (!q) return [];
  return exactFirst(rows.filter((r) => devOrTestMatches(r, q)).sort((a, b) => b.joinedAt.localeCompare(a.joinedAt)), q, (r) => [r.developer, r.title]);
}

/** (§204) The box's label and placeholder. */
export const DEV_SEARCH_LABEL = "Search by developer or test";
/** No match (§204: either name): "No tests match “nora”." */
export const noDevMatchLine = (typed: string) => `No tests match “${typed.trim()}”.`;
/** (§204) To do while the box is typed in: only its rows for the matching tests; none: "No tests in To do match “nora”." */
export const noTodoMatchLine = (typed: string) => `No tests in To do match “${typed.trim()}”.`;
