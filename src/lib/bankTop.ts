import { money, zoneOpt } from "@/lib/format";
import { disputeDecisionName, partOf, pieceName } from "@/lib/rules";

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
 * What a row is for, after the amount: (Owner, Nov 2, §131) a piece named by its tester, part and test (rules.ts pieceName: "Ana Silva's written answers on “Harbor
 * Run”", "Ana Silva's live call on “Harbor Run” (Oct 30)"), the team's dispute decision on a piece, "what you owe" (an automatic retry of what's owed during a payment
 * hold) or (batch 25 section 2) a retried chargeback, worded as on the test page: "a payment your bank had reversed (Ana Silva's written answers on “Harbor Run”)".
 */
export const pieceWords = {
  // (Owner, Nov 4, §175) `whose`: the tester's possessive pronoun in place of their name (the test page's Confirm with your bank, under the tester's name).
  part: (name: string, kind: string, test: string, full = false, whose?: string) => pieceName({ tester: name, part: partOf(null, kind || "written"), test, full, whose }),
  call: (name: string, day: string, test: string, full = false, whose?: string) => pieceName({ tester: name, part: "live call", test, when: day, full, whose }),
  dispute: (piece: string) => disputeDecisionName(piece),
  work: (name: string, test: string, full = false, whose?: string) => pieceName({ tester: name, part: "work", test, full, whose }),
  reversed: (piece?: string | null) => (piece ? `a payment your bank had reversed (${piece})` : "a payment your bank had reversed"),
  owed: "what you owe",
} as const;

/**
 * The row's line before "confirm by": "$12.50 · Ana Silva's written answers on “Harbor Run”" (§131: the piece names its test), "$5.00 on “Harbor Run” · what you
 * owe", or a renewal's "$9.00 for your plan".
 */
export const bankTopLead = (cents: number, test: string | null, what: string | null) =>
  what == null ? `${money(cents)} for your plan` : `${money(cents)}${test ? ` on “${test}”` : ""} · ${what}`;

/** `full`: the lead with the names uncut, the row's hover (§131). */
export type BankTopRow = { id: string; lead: string; full: string; by: string; soon: boolean; href: string; at: number; /** (Owner, Nov 2) the tests its quoted names link to */ tests?: { name: string; href: string }[]; /** (§147) an open Confirm all check (drawn by Confirm all, not as a row) */ all?: boolean; /** (§147) its amount: over $200 its Confirm needs the tick */ cents?: number };

/** The dashboard poll's fingerprint for the box: a row appearing, leaving or turning red refreshes it. */
export const bankTopV = (rows: BankTopRow[]) => rows.map((r) => `${r.id}:${r.lead}:${r.by}:${r.soon ? 1 : 0}`).join(",");
