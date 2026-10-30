import { money } from "@/lib/format";
import { fmtIn } from "@/lib/tz";

// ---------- (Batch 30 §3) Late work: no Charge ----------

/** The server's refusal (and the line a Charge / Let it go press on late work gets). */
export const NO_CHARGE_LATE = "You can't charge for work sent after your deadline.";
/** The developer's review reminders for late listed work: the same countdown, no "after that <tester> can charge". */
export const LATE_REMINDER_TAIL = " (it was sent late: any amount, $0 included)";
/** The tester, above Send once their own deadline passed (a listed part). */
export const lateBeforeSendLine = (date: string, dev: string) => `Your deadline passed on ${date}. You can still send this: ${dev} decides what to pay for late work, and you can't charge for it.`;
/** The tester, after sending late (while it's unpaid). */
export const lateSentLine = (date: string, dev: string) => `Sent late (deadline was ${date}): ${dev} decides what to pay. You can't charge for late work.`;

// ---------- (Batch 30 §2) Sending a part again after it's paid ----------

/** The tester, above Send on a paid part: below its cap, at its cap, or after Pay more closed (close-out). */
export function updateAboveSendLine(dev: string, paidCents: number, allCents: number, closedOn: string | null) {
  if (allCents <= paidCents) return `This part is already paid the most it can be (${money(paidCents)}): ${dev} can't pay more for an update.`;
  if (closedOn) return `${dev} has paid ${money(paidCents)} for this. Pay more closed on ${closedOn}, so ${dev} can't pay more for an update.`;
  return `${dev} has paid ${money(paidCents)} for this. An update can be paid more, up to ${money(allCents)} in all.`;
}
/** The developer's Needs you row for an update below the cap. */
export const updateRowLine = (name: string, paidCents: number, moreCents: number) => `${name} sent an updated version after you paid (${money(paidCents)} paid · up to ${money(moreCents)} more)`;
/** The developer's tester row when an update came at the cap. */
export const UPDATED_AT_CAP = "Updated after you paid · already paid the most";
/** The developer's live-box lines: below the cap (a stop-once "sent" line) and at the cap (quiet). */
export const updatedAfterPaidLive = (name: string, poss: string, part: string) => `${name} sent an updated version of ${poss} ${part} after you paid`;
export const updatedAtCapLive = (name: string, poss: string, part: string) => `${name} sent an updated version of ${poss} ${part} (already paid the most)`;
/** The tester's line once the developer closed their update at $0. */
export const updateClosedZeroLine = (dev: string) => `${dev} paid $0 more for your update.`;

// ---------- (Batch 30 §5) The team closes open reviews at $0 ----------

/** The tester's line on a piece the team closed (the reason is the team's). */
export const teamClosedLine = (reason: string) => `The team closed this for $0: “${reason}”`;
export const TEAM_CLOSED_NO_DISPUTE = "The team closed this for $0, so it can't be disputed.";
export const TEAM_CLOSED_NO_CHANGE = "The team closed this for $0, so it can't be changed.";
export const TEAM_CLOSED_NO_PAY = "The team closed this for $0.";
/** Reason rules: 5 to 1,000 characters (testers read it). */
export const TEAM_CLOSE_REASON = "Say why the team closes these (at least 5 characters; the testers read it).";

/** (Batch 30 §2) A paid piece whose latest update hasn't been answered by a Pay more yet (any amount, $0 included). The caller also checks the cap and Pay more's close-out. */
export const updateWaiting = (s: { paidUpdateAt: Date | null; paidUpdateDoneAt: Date | null; review?: { rejected: boolean; teamClosedById?: string | null } | null }) =>
  !!s.paidUpdateAt && !!s.review && !s.review.rejected && !s.review.teamClosedById && (!s.paidUpdateDoneAt || s.paidUpdateDoneAt.getTime() < s.paidUpdateAt.getTime());
/** (Batch 30 §2) Whether the tester may send a part again: not sent yet, unpaid, or paid (not an old rejection, not closed by the team). */
export const canSendAgain = (s: { review?: { rejected: boolean; teamClosedById?: string | null } | null } | null | undefined) => !s?.review || (!s.review.rejected && !s.review.teamClosedById);

// ---------- (Batch 30 §20) One date for a piece on both sides ----------

/**
 * (Owner, Oct 29, batch 30 §20) A piece's review / charge date ("Oct 30"), as both sides read it: the same instant, written in the reader's own saved zone (no zone:
 * UTC), never in the server's clock. The developer's "If you don't pay by …", the tester's "If <dev> hasn't paid by …", and the listed call's automatic charge.
 */
export const pieceDay = (at: Date, tz: string | null | undefined) => fmtIn(tz, at, "date");
