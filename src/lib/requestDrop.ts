import { pronouns } from "@/lib/format";

// (Owner, Nov 4, §184) The moment a call is booked, every OTHER waiting call request of either person in it (any test, sent by either side) whose time overlaps
// the call is dropped: a single time closes; a "choose one" request loses only the overlapping times (closing when none is left). Its stored reason says which of
// the request's two people is no longer free then, never who the call is with; each reader reads it in their own words (`dropReasonFor`).

/** The request's developer has the booked call. */
export const DROP_DEV_BUSY = "the developer is no longer free at that time";
/** The request's tester has the booked call. */
export const DROP_TESTER_BUSY = "the tester is no longer free at that time";
/** Both of the request's people are in the booked call (a request between the same two). */
export const DROP_BOTH = "you have a call together at that time";
export const DROP_REASONS: ReadonlySet<string> = new Set([DROP_DEV_BUSY, DROP_TESTER_BUSY, DROP_BOTH]);
export const isDropReason = (reason: string | null | undefined) => !!reason && DROP_REASONS.has(reason);

type Side = "developer" | "tester";
/** Is the reader (`side`) the one no longer free (or both of them)? */
export const readerBusy = (reason: string, side: Side) => reason === DROP_BOTH || (reason === DROP_DEV_BUSY ? side === "developer" : side === "tester");

/**
 * (§184) A dropped request's reason as `side` reads it, `other` being the request's other person: "fbbb is no longer free at that time" (the other one has the
 * call: never with whom), "you have another call at that time" (the reader has it), "you have a call with Ana Silva at that time" (both are in it).
 */
export function dropReasonFor(reason: string, side: Side, other: string) {
  if (reason === DROP_BOTH) return `you have a call with ${other} at that time`;
  return readerBusy(reason, side) ? "you have another call at that time" : `${other} is no longer free at that time`;
}

/**
 * (§184) The live line about one dropped request, for one of its two people (`fromReader`: the reader sent it). `when`: the request's time (closed) or the times
 * taken out of it (`partial`). The other person by pronoun (§162) after their name: "Ana Silva's request for Thu, Nov 5, 3:00 PM closed: she is no longer free
 * at that time"; "Your request to Nora Lane no longer offers Thu, Nov 5, 3:00 PM: she is no longer free at that time"; the reader's own: "… closed: you have
 * another call at that time"; both in the call: "… closed: you have a call with her at that time".
 */
export function dropLine(o: { reason: string; side: Side; fromReader: boolean; other: string; otherPronoun?: string | null; when: string; partial: boolean; /** (Owner, Nov 6, §312a) the bell's ` on “<test>”` */ on?: string }) {
  const p = pronouns(o.otherPronoun);
  const on = o.on ?? "";
  const head = o.partial
    ? o.fromReader ? `Your request to ${o.other}${on} no longer offers ${o.when}` : `${o.other}'s request${on} no longer offers ${o.when}`
    : o.fromReader ? `Your request to ${o.other}${on} for ${o.when} closed` : `${o.other}'s request${on} for ${o.when} closed`;
  const why = o.reason === DROP_BOTH ? `you have a call with ${p.obj} at that time` : readerBusy(o.reason, o.side) ? "you have another call at that time" : `${p.subj} ${p.is} no longer free at that time`;
  return `${head}: ${why}`;
}

/** (§184) The kinds of the lines: the developer's (a stop line under Call changes; their own: quiet, live box only) and the tester's (read by their session page). */
export const DROP_KINDS = { devClosed: "req_closed", devQuiet: "req_dropped", testerClosed: "t_req_closed", testerQuiet: "t_req_dropped" } as const;
