// (Owner, Oct 28, batch 20 section 9) Name searches work from 1 character: the invite panel's "Search by name", the admin's Accounts search, Find's search and the
// tester dashboard's "Search by developer". 1-2 characters match a name equal to it or with a word starting with it (any case), so results stay short; from 3
// characters any part matches (as before). An exact match always comes first. Pure, so the pages, the server and the tests share it.

/** From this many characters, any part of the name matches; below it, only the start of a word (or the whole name). */
export const ANY_PART_FROM = 3;

const norm = (s: string) => s.trim().toLowerCase();

/** Whether `text` (a name, a title) matches what was typed. Blank typed: no match. */
export function nameMatches(text: string, typed: string) {
  const q = norm(typed), n = norm(text);
  if (!q) return false;
  if (n === q) return true;
  if (q.length >= ANY_PART_FROM) return n.includes(q);
  return n.split(/[\s\-_.@]+/).some((w) => w.startsWith(q));
}

/** Exact matches first (in their order), then the rest in theirs. */
export function exactFirst<T>(rows: T[], typed: string, texts: (r: T) => string[]) {
  const q = norm(typed);
  const exact = (r: T) => texts(r).some((t) => norm(t) === q);
  return [...rows.filter(exact), ...rows.filter((r) => !exact(r))];
}

/**
 * The same rule as a Prisma string filter list (any of them): 1-2 characters: equal, the start of the text, or the start of a later word (after a space); 3+:
 * contains. `wordsOnly`: emails and other one-word values match only from their start.
 */
export function textFilters(typed: string, wordsOnly = false) {
  const q = typed.trim();
  const mode = "insensitive" as const;
  if (q.length >= ANY_PART_FROM) return [{ contains: q, mode }];
  return [{ equals: q, mode }, { startsWith: q, mode }, ...(wordsOnly ? [] : [{ contains: ` ${q}`, mode }, { contains: `-${q}`, mode }])];
}
