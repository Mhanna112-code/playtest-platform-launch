"use client";
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Change } from "@/components/ChangesBox";
import { ratingChangedLine, testerNeedsChangedLines, type Needs } from "./testerState";
export type ShownTester = { id: string; name: string; seen: Needs; changedAt?: string };
export function redrawTesterChanges(current: Change[] | null, before: Map<string, Needs>, rows: ShownTester[], needs: Needs): Change[] | null {
  if (!current) return current;
  const next = current.flatMap((c) => {
    const row = rows.find((r) => c.key === `needs:${r.id}`);
    const old = row && before.get(row.id);
    if (!row || !old || !row.changedAt || new Date(row.changedAt) < new Date(c.at)) return [c];
    const lines = testerNeedsChangedLines(row.name, old, row.seen, needs);
    const rating = ratingChangedLine(row.name, old.rating ?? null, row.seen.rating ?? null);
    if (rating) lines.push(rating);
    return lines.length ? [{ ...c, text: lines.join(" · "), at: row.changedAt ?? c.at }] : [];
  });
  if (!next.length) return null;
  return JSON.stringify(next) === JSON.stringify(current) ? current : next;
}
/** A row redraw also refreshes an existing line about that tester, without another press. */
export function useTesterChanges(setChanges: Dispatch<SetStateAction<Change[] | null>>, before: RefObject<Map<string, Needs>>, rows: ShownTester[], needs: Needs) {
  useEffect(() => {
    setChanges((current) => redrawTesterChanges(current, before.current, rows, needs));
  }, [setChanges, before, rows, needs]);
}
