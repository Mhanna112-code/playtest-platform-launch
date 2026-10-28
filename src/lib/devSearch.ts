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

/** The tests whose developer's name contains `typed` (any part, any case), most recent first (by when the tester joined). Blank: none (the normal dashboard shows). */
export function searchByDeveloper(rows: DevSearchRow[], typed: string): DevSearchRow[] {
  const q = typed.trim().toLowerCase();
  if (!q) return [];
  return rows.filter((r) => r.developer.toLowerCase().includes(q)).sort((a, b) => b.joinedAt.localeCompare(a.joinedAt));
}

/** No match: "No tests with a developer named “nora”." */
export const noDevMatchLine = (typed: string) => `No tests with a developer named “${typed.trim()}”.`;
