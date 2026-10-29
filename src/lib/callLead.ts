// (Owner, Oct 29, batch 27 section 6) How soon a call request's time may start: 5 minutes ahead in production (always, whatever the environment says); for local
// testing 1 minute by default, or CALL_MIN_AHEAD_MINUTES. Read once. Used by the server's check (every row's time, a Daily / Weekly set's first time) and by the request
// forms' time box (its earliest time and red line). The call room still opens 10 minutes before the start, as before. No imports: safe on the server and the pages.

const fromEnv = Number(process.env.CALL_MIN_AHEAD_MINUTES ?? 1);

/** Minutes ahead a requested call time must be at least. */
export const CALL_MIN_AHEAD_MINUTES = process.env.NODE_ENV === "production" ? 5 : Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : 1;

/** Is this time far enough ahead to request (or book) a call at? */
export const farEnoughAhead = (at: Date, now = Date.now(), minutes = CALL_MIN_AHEAD_MINUTES) => at.getTime() >= now + minutes * 60_000;
