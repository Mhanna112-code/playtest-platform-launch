import { NAME_CUT, cutTo } from "./rules";

/**
 * (Owner, Nov 5, batch 35 §236) A line with names baked into its text (server text: a contract note, a terms history line): the line as shown, every long name cut
 * at NAME_CUT (20) with "…", and the whole line, for WholeLine (§220: each "…" opens its name in place, the arrow opens the whole line). Cut: each of `names` (the
 * developer's, the tester's, the test's titles) wherever it appears, and any quoted “…” longer than NAME_CUT (a test or product name in quotes, a renamed test's old
 * and new names). `full` is null when nothing was cut.
 */
export function cutNamesIn(text: string, names: (string | null | undefined)[], n = NAME_CUT): { shown: string; full: string | null } {
  let shown = text;
  const long = [...new Set(names.filter((x): x is string => !!x && Array.from(x).length > n))].sort((a, b) => b.length - a.length);
  for (const name of long) shown = shown.split(name).join(cutTo(name, n));
  shown = shown.replace(/“([^”]+)”/g, (m, inner: string) => (Array.from(inner).length > n && !inner.includes("…") ? `“${cutTo(inner, n)}”` : m));
  return { shown, full: shown === text ? null : text };
}
