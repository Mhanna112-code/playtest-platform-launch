import { money, zoneOpt } from "@/lib/format";

// (Owner, Oct 29, batch 24 section 1) "Your bank wants you to confirm" at the very top of the developer dashboard: every charge made while the developer was away that
// their bank wants confirmed (a tester's Charge, a dispute decision, an automatic retry of what's owed, a renewal), soonest deadline first. Not confirmed by its date, a
// charge counts as declined (a payment hold) and a renewal lapses. (Batch 25 section 1) Times are in the developer's own saved time zone (`tz`), never the server's clock:
// the time, "today" / "tomorrow" and the red under-24-hours check (no saved zone: the server's clock).

const DAY = 86_400_000;
const zoned = (tz?: string | null) => zoneOpt(tz);
const dayKey = (d: Date, tz?: string | null) => d.toLocaleDateString("en-CA", zoned(tz));
const clock = (d: Date, tz?: string | null) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...zoned(tz) });
/** "Oct 30" */
export const shortDay = (d: Date, tz?: string | null) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...zoned(tz) });

export const bankTopHeading = (n: number) => `Your bank wants you to confirm (${n})`;

/**
 * "confirm by Nov 2, 3:10 PM". Under 24 hours left it is red (`soon`) and names the day: "confirm by today, 3:10 PM" (or "tomorrow, 3:10 PM" when the 24 hours
 * cross midnight).
 */
export function confirmByText(by: Date, now: Date, tz?: string | null) {
  const soon = by.getTime() - now.getTime() < DAY;
  const day = !soon ? shortDay(by, tz) : dayKey(by, tz) === dayKey(now, tz) ? "today" : "tomorrow";
  return { text: `confirm by ${day}, ${clock(by, tz)}`, soon };
}

/**
 * What a row is for, after the amount: a piece ("Ana Silva's written answers", "Ana Silva's call on Oct 30"), the team's decision, "what you owe" (an automatic retry of
 * what's owed during a payment hold) or (batch 25 section 2) a retried chargeback, worded as on the test page: "a payment your bank had reversed (Ana Silva's written answers)".
 */
export const pieceWords = {
  part: (name: string, kind: string) => `${name}'s ${kind === "recording" ? "recording" : "written answers"}`,
  call: (name: string, day: string) => `${name}'s call on ${day}`,
  dispute: (name: string) => `the team's decision on ${name}'s dispute`,
  work: (name: string) => `${name}'s work`,
  reversed: (piece?: string | null) => (piece ? `a payment your bank had reversed (${piece})` : "a payment your bank had reversed"),
  owed: "what you owe",
} as const;

/** The row's line before "confirm by": "$12.50 on “Harbor Run” · Ana Silva's written answers", or a renewal's "$9.00 for your plan". */
export const bankTopLead = (cents: number, test: string | null, what: string | null) =>
  what == null ? `${money(cents)} for your plan` : `${money(cents)}${test ? ` on “${test}”` : ""} · ${what}`;

export type BankTopRow = { id: string; lead: string; by: string; soon: boolean; href: string; at: number };

/** The dashboard poll's fingerprint for the box: a row appearing, leaving or turning red refreshes it. */
export const bankTopV = (rows: BankTopRow[]) => rows.map((r) => `${r.id}:${r.lead}:${r.by}:${r.soon ? 1 : 0}`).join(",");
