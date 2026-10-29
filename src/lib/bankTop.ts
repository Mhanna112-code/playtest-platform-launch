import { money } from "@/lib/format";

// (Owner, Oct 29, batch 24 section 1) "Your bank wants you to confirm" at the very top of the developer dashboard: every charge made while the developer was away that
// their bank wants confirmed (a tester's Charge, a dispute decision, an automatic retry of what's owed, a renewal), soonest deadline first. Not confirmed by its date, a
// charge counts as declined (a payment hold) and a renewal lapses. Times are the page's clock, like the test page's own "Confirm it by" line.

const DAY = 86_400_000;
const zoned = (tz?: string) => (tz ? { timeZone: tz } : {});
const dayKey = (d: Date, tz?: string) => d.toLocaleDateString("en-CA", zoned(tz));
const clock = (d: Date, tz?: string) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...zoned(tz) });
/** "Oct 30" */
export const shortDay = (d: Date, tz?: string) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...zoned(tz) });

export const bankTopHeading = (n: number) => `Your bank wants you to confirm (${n})`;

/**
 * "confirm by Nov 2, 3:10 PM". Under 24 hours left it is red (`soon`) and names the day: "confirm by today, 3:10 PM" (or "tomorrow, 3:10 PM" when the 24 hours
 * cross midnight).
 */
export function confirmByText(by: Date, now: Date, tz?: string) {
  const soon = by.getTime() - now.getTime() < DAY;
  const day = !soon ? shortDay(by, tz) : dayKey(by, tz) === dayKey(now, tz) ? "today" : "tomorrow";
  return { text: `confirm by ${day}, ${clock(by, tz)}`, soon };
}

/** What a row is for, after the amount: a piece ("Ana Silva's written answers", "Ana Silva's call on Oct 30"), the team's decision, or "what you owe" (a retry). */
export const pieceWords = {
  part: (name: string, kind: string) => `${name}'s ${kind === "recording" ? "recording" : "written answers"}`,
  call: (name: string, day: string) => `${name}'s call on ${day}`,
  dispute: (name: string) => `the team's decision on ${name}'s dispute`,
  work: (name: string) => `${name}'s work`,
  owed: "what you owe",
} as const;

/** The row's line before "confirm by": "$12.50 on “Harbor Run” · Ana Silva's written answers", or a renewal's "$9.00 for your plan". */
export const bankTopLead = (cents: number, test: string | null, what: string | null) =>
  what == null ? `${money(cents)} for your plan` : `${money(cents)}${test ? ` on “${test}”` : ""} · ${what}`;

export type BankTopRow = { id: string; lead: string; by: string; soon: boolean; href: string; at: number };

/** The dashboard poll's fingerprint for the box: a row appearing, leaving or turning red refreshes it. */
export const bankTopV = (rows: BankTopRow[]) => rows.map((r) => `${r.id}:${r.lead}:${r.by}:${r.soon ? 1 : 0}`).join(",");
