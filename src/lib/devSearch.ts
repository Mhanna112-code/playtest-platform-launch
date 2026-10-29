import { exactFirst, nameMatches } from "./nameSearch";
// (Owner, Oct 28, batch 16 section 13) The tester dashboard's "Search by developer": every test the tester has been in (working, finished, left, ended,
// stopped, closed), narrowed by the developer's name. Pure, so the dashboard's client box and the tests share it.

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
 * The tests whose developer's name matches `typed` (any case; batch 20 section 9: from 1 character, 1-2 characters the start of a word in the name or the whole
 * name, 3+ any part), the exact name first, then most recent first (by when the tester joined). Blank: none (the normal dashboard shows).
 */
export function searchByDeveloper(rows: DevSearchRow[], typed: string): DevSearchRow[] {
  const q = typed.trim().toLowerCase();
  if (!q) return [];
  return exactFirst(rows.filter((r) => nameMatches(r.developer, q)).sort((a, b) => b.joinedAt.localeCompare(a.joinedAt)), q, (r) => [r.developer]);
}

/** No match: "No tests with a developer named “nora”." */
export const noDevMatchLine = (typed: string) => `No tests with a developer named “${typed.trim()}”.`;
