import { db } from "@/lib/db";
import { cutTo, partWhen } from "@/lib/rules";
import { T } from "@/lib/tz";
import { callAtFor } from "./dateFormat";

// (Owner, Nov 4, §177) "Nina Park disputed the pay for her live call": she had three live calls on that test, so the developer couldn't tell WHICH call. Every
// change line names its part precisely: a tester has one written answers and one recording on a test, so those keep their plain name; a live call is always named
// with its date and time ("live call on Tue, Oct 27, 8:00 AM"), as the call lines already were.

type Piece = { callId?: string | null; submissionId?: string | null };
type Reader = { timeZone?: string | null } | null | undefined;

/** The call's start as a line stored for `reader` writes it (their saved zone, else this request's). */
export const callAt = (reader?: Reader) => (d: Date) => callAtFor(d, reader);

/**
 * A part's words in a change line: "written answers", "recording", "live call on Tue, Oct 27, 8:00 AM". `at`: how the call's start is written (a stored line: its
 * reader's zone, callAt; a bell or an own action line: a time token, rendered for each reader).
 */
export async function partWords(p: Piece, at: (d: Date) => string = callAt()) {
  if (p.callId) {
    const x = await db.call.findUnique({ where: { id: p.callId }, select: { startsAt: true } });
    return partWhen("live call", x ? at(x.startsAt) : null);
  }
  const s = p.submissionId ? await db.submission.findUnique({ where: { id: p.submissionId }, select: { kind: true } }) : null;
  return s?.kind === "recording" ? "recording" : "written answers";
}

/**
 * A part named in a bell or an email (which names the test too): "her live call on “Harbor Run” (Tue, Oct 27, 2:00 PM EST)", "her written answers on “Harbor Run”"
 * (the call's start as a time token, written in each reader's zone). `poss`: "her", "your"…
 */
export async function partOnTest(p: Piece, poss: string, title: string) {
  const call = p.callId ? await db.call.findUnique({ where: { id: p.callId }, select: { startsAt: true } }) : null;
  const part = p.callId ? "live call" : await partWords(p);
  return `${poss} ${part} on “${title}”${call ? ` (${T(call.startsAt)})` : ""}`;
}

/** A part named in a payment line read away from its test (pieceName's order, the call's date and time in brackets): "his live call on “Harbor Run” (Tue, Oct 27, 8:00 AM)". */
export async function partAway(p: Piece, poss: string, title: string, at: (d: Date) => string = callAt()) {
  const call = p.callId ? await db.call.findUnique({ where: { id: p.callId }, select: { startsAt: true } }) : null;
  const part = p.callId ? "live call" : await partWords(p);
  return `${poss} ${part} on “${cutTo(title)}”${call ? ` (${at(call.startsAt)})` : ""}`;
}
