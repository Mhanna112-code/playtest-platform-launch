// (Owner, Nov 2, batch 35 §132) THE CALL WINDOW: a call time is at least the lead ahead (24 hours on the live site: lib/callLead.ts) and no later than when testers'
// work on the test ends (the END: workDeadlineOf in rules.ts, the latest tester deadline and no earlier than Open until). A Daily / Weekly row runs up to the end: its
// calls after it are dropped, Forever reads "until testers' work ends". Its wording and the request forms' choices, the same for the server and the pages. Pure, and
// never reads the environment: the server passes its lead and the end down to the forms (CallWindowProps).
import { callsUntil, type RowRepeat } from "./callRows";

/**
 * What a page with a call request form passes down from the server besides its lead (`leadMinutes`): the end (ISO) and the end in the reader's words. null: no end
 * (a test with no deadline yet).
 */
export type CallEnd = {
  at: string;
  /** "Thu, Dec 3, 11:59 PM" (the reader's zone) */
  text: string;
  /** "Dec 3" */
  day: string;
} | null;

/** The lead in words: "24 hours", "1 hour", "90 minutes", "1 minute". */
export function leadWords(minutes: number) {
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** The time box's red line and the server's refusal for a time too soon: "Pick a time at least 24 hours from now." (no lead: "Pick a time in the future."). */
export const leadLine = (minutes: number) => (minutes > 0 ? `Pick a time at least ${leadWords(minutes)} from now.` : "Pick a time in the future.");

/** The time box's red line and the server's refusal for a time after the end: "Pick a time before Thu, Dec 3, 11:59 PM (when testers' work on this test ends)." */
export const beforeEndLine = (endText: string) => `Pick a time before ${endText} (when testers' work on this test ends).`;

/** A Daily / Weekly row running to the end: "until testers' work ends (Dec 3)" (the calls drop-down's last choice reads it with a capital U). */
export const untilEndWords = (endDay: string) => `until testers' work ends (${endDay})`;

/**
 * An Accept whose time is now too soon (less than the lead away): "Thu, Nov 5, 3:00 PM is less than 24 hours from now, so it can't be booked any more. Request a later
 * time instead."
 */
export const tooSoonToBookLine = (when: string, minutes: number) =>
  `${when} ${minutes > 0 ? `is less than ${leadWords(minutes)} from now` : "has passed"}, so it can't be booked any more. Request a later time instead.`;

/** The same in a waiting request's row (its Accept goes): "Less than 24 hours away now: it can't be booked any more." */
export const tooSoonNote = (minutes: number) => (minutes > 0 ? `Less than ${leadWords(minutes)} away now: it can't be booked any more.` : "Its time has passed.");

/** An Accept whose time is after the end (a request from before this rule): "Thu, Dec 10, 3:00 PM is after testers' work on this test ends (Thu, Dec 3, 11:59 PM), so it can't be booked." */
export const afterEndToBookLine = (when: string, endText: string) => `${when} is after testers' work on this test ends (${endText}), so it can't be booked.`;

/** Can a call at this time still be booked now (at least the lead ahead)? */
export const bookableNow = (at: Date | string, leadMinutes: number, now = Date.now()) => new Date(at).getTime() >= now + leadMinutes * 60_000;

/** Is no time left in the window (the end is less than the lead away)? Then nothing can be requested any more. */
export const windowShut = (end: Date | string | null | undefined, leadMinutes: number, now = Date.now()) => !!end && leadMinutes > 0 && new Date(end).getTime() < now + leadMinutes * 60_000;

/**
 * The request forms' line then (the form goes), and the server's refusal: "No more calls can be requested: testers' work on this test ends Thu, Dec 3, 11:59 PM,
 * less than 24 hours from now."
 */
export const windowShutLine = (endText: string, minutes: number) => `No more calls can be requested: testers' work on this test ends ${endText}, less than ${leadWords(minutes)} from now.`;

/** The calls drop-down's counts with no end to fit before: 2 to 8 calls. */
export const REPEAT_COUNTS = [2, 3, 4, 5, 6, 7, 8] as const;

/**
 * (Batch 35 §132) A Daily / Weekly row's choices at this time: how many calls fit before the end (`fit`; no time or no end: no limit), the counts that fit, and whether
 * the repeat can be picked at all (at least 2 calls before the end).
 */
export function repeatChoices(when: Date | null, repeat: RowRepeat, end: Date | null) {
  const fit = when && !isNaN(when.getTime()) ? callsUntil(when, repeat, end) : Number.POSITIVE_INFINITY;
  // (Owner, Nov 3) With an end, EVERY count that fits is listed (2 up to the most), and there's no separate "until testers' work ends" choice.
  const counts = Number.isFinite(fit) ? Array.from({ length: Math.max(0, fit - 1) }, (_, i) => i + 2) : [...REPEAT_COUNTS];
  return { fit, counts, ok: fit >= 2 };
}

/** Why a repeat can't be picked at this time: "Weekly isn't offered: only one call fits before testers' work ends (Dec 3)." ("" when every repeat fits.) */
export function repeatOffLine(off: RowRepeat[], endDay: string) {
  if (!off.length) return "";
  const names = off.map((r) => (r === "daily" ? "Daily" : "Weekly"));
  return `${names.join(" and ")} ${names.length === 1 ? "isn't" : "aren't"} offered: only one call fits before testers' work ends (${endDay}).`;
}
