// (Owner, Oct 29, batch 27 section 6; owner, Nov 2, batch 35 §132) How soon a call request's time may start: 24 hours ahead on the live site (always, whatever the
// environment says); for local testing 1 minute by default, or CALL_MIN_AHEAD_MINUTES. Read once. Used by the server's check (every row's time, a Daily / Weekly set's
// first time, an Accept) and passed to the request forms' time box (its earliest time and red line): the browser never reads it. The other end of the window, when
// testers' work on the test ends, and the window's wording are in lib/callWindow.ts. The call room still opens 10 minutes before the start, as before. No imports:
// safe on the server and the pages.

/** (Batch 35 §132) The live site's lead: 24 hours. */
export const LIVE_CALL_LEAD_MINUTES = 24 * 60;

/** The lead for an environment: 24 hours in production (the setting is ignored there); otherwise the setting, or 1 minute. */
export function leadMinutesFor(nodeEnv: string | undefined, setting: string | undefined) {
  if (nodeEnv === "production") return LIVE_CALL_LEAD_MINUTES;
  const n = Number(setting ?? 1);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/** Minutes ahead a requested call time must be at least. */
export const CALL_MIN_AHEAD_MINUTES = leadMinutesFor(process.env.NODE_ENV, process.env.CALL_MIN_AHEAD_MINUTES);

/** Is this time far enough ahead to request (or book) a call at? */
export const farEnoughAhead = (at: Date, now = Date.now(), minutes = CALL_MIN_AHEAD_MINUTES) => at.getTime() >= now + minutes * 60_000;
