import { pronouns } from "./format";

export type Needs = { devices: string[]; languages: string[]; rating?: number | null };
/**
 * A rating change the page hadn't shown: a full star or more ("<name>'s rating went from 4.6 to 3.5"), or (owner, Oct 30, batch 35 §12) a first rating where the
 * page showed "No ratings yet" (`seen` null): "<name> got their first rating: 1.0". `seen` undefined = the page didn't say (no stop).
 */
export function ratingChangedLine(name: string, seen: number | null | undefined, current: number | null | undefined, /** (batch 35 §162) the tester's */ pronoun?: string | null) {
  if (seen === undefined || current == null) return "";
  if (seen === null) return `${name} got ${pronouns(pronoun).poss} first rating: ${Number(current.toFixed(1)).toFixed(1)}`;
  const before = Number(seen.toFixed(1));
  const after = Number((current ?? 0).toFixed(1));
  return Math.abs(Math.round(after * 10) - Math.round(before * 10)) >= 10 ? `${name}'s rating went from ${before.toFixed(1)} to ${after.toFixed(1)}` : "";
}
