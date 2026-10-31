import { andList } from "./rules";
import { orList } from "./gaps";

export type Needs = { devices: string[]; languages: string[]; rating?: number | null };
/**
 * A rating change the page hadn't shown: a full star or more ("<name>'s rating went from 4.6 to 3.5"), or (owner, Oct 30, batch 35 §12) a first rating where the
 * page showed "No ratings yet" (`seen` null): "<name> got their first rating: 1.0". `seen` undefined = the page didn't say (no stop).
 */
export function ratingChangedLine(name: string, seen: number | null | undefined, current: number | null | undefined) {
  if (seen === undefined || current == null) return "";
  if (seen === null) return `${name} got their first rating: ${Number(current.toFixed(1)).toFixed(1)}`;
  const before = Number(seen.toFixed(1));
  const after = Number((current ?? 0).toFixed(1));
  return Math.abs(Math.round(after * 10) - Math.round(before * 10)) >= 10 ? `${name}'s rating went from ${before.toFixed(1)} to ${after.toFixed(1)}` : "";
}
export function testerNeedsChangedLines(name: string, seen: Needs, now: Needs, test: Needs) {
  const added: string[] = [], removed: string[] = [];
  for (const kind of ["languages", "devices"] as const) {
    const had = test[kind].filter((x) => seen[kind].includes(x));
    const has = test[kind].filter((x) => now[kind].includes(x));
    if (!had.length && has.length) added.push(...has);
    if (had.length && !has.length) removed.push(...had);
  }
  if (!added.length && !removed.length) return [];
  if (!removed.length) return [`${name} now lists ${andList(added)}, which this test needs.`];
  if (!added.length) return [`${name} no longer lists ${andList(removed)}, which this test needs.`];
  // Both: what the test needs, for each kind something was removed from.
  const needs = [
    ...(removed.some((x) => test.languages.includes(x)) ? [orList(test.languages)] : []),
    ...(removed.some((x) => test.devices.includes(x)) ? [orList(test.devices)] : []),
  ];
  return [`${name} now lists ${andList(added)} but no longer lists ${andList(removed)} (this test needs ${needs.join(", and ")}).`];
}
