import { CRITICAL_FIELDS, LIMITS, type CriticalField } from "@/lib/limits";

/**
 * (Batch 30 §9) A limited field (group) that used its 3 changes while this Edit tab still holds a change to it (another tab's Save locked it meanwhile): the line at
 * Save names the change, with Put it back beside it. "Your change to the live call rate ($24.00/h → $30.00/h) can't be saved: you've changed the parts and prices 3
 * times since testers joined." Long values (the steps, questions) are named without their text.
 */
export type LockedItem = { key: string; name: string; before?: string; now?: string };

const SHORT = 60;
/** A value short enough to show in the line (one line, at most 60 characters). */
export const shortValue = (v: string | string[]) => (typeof v === "string" && v.length <= SHORT && !v.includes("\n") ? v : null);

export function lockedChangeParts(field: CriticalField, items: LockedItem[]) {
  return {
    head: items.length === 1 ? "Your change to" : "Your changes to",
    items: items.map((i, n) => ({ ...i, value: i.before != null && i.now != null ? ` (${i.before} → ${i.now})` : "", sep: n === 0 ? " " : n === items.length - 1 ? " and " : ", " })),
    tail: ` can't be saved: you've changed the ${CRITICAL_FIELDS[field]} ${LIMITS.criticalChanges} times since testers joined.`,
  };
}

/** The whole line as text. */
export function lockedChangeLine(field: CriticalField, items: LockedItem[]) {
  const p = lockedChangeParts(field, items);
  return `${p.head}${p.items.map((i) => `${i.sep}the ${i.name}${i.value}`).join("")}${p.tail}`;
}
