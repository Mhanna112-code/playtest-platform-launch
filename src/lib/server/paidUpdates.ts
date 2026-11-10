import type { Prisma } from "@prisma/client";
import { TEAM_CLOSED_NO_CHANGE, addedWhat, updateRowLine, updatedAtCapLive } from "@/lib/moneyLines";

type Tx = Prisma.TransactionClient;

/**
 * (Batch 30 §2; batch 35 §136) After a part is paid, the tester can still ADD to it (more text or files, more recordings; what was sent stays). Refused only for an
 * old rejection and for a piece the team closed at $0 (final). Returns the refusal, or "".
 */
export function resendRefusal(review: { rejected: boolean; teamClosedById?: string | null } | null | undefined, part: "written" | "recording") {
  if (!review) return "";
  if (review.teamClosedById) return TEAM_CLOSED_NO_CHANGE;
  if (review.rejected) return part === "written" ? "Your written answers were already reviewed, so they can't be changed." : "Your recording was already reviewed, so it can't be changed.";
  return "";
}

/**
 * (Batch 30 §2) Where an update of a paid piece stands: `atCap` when nothing more can be paid on it (its cap reached, or Pay more closed on its own date: (Owner, Nov 11, §378) pieceCloseOut): then it
 * doesn't go into Needs you, only a quiet line.
 */
export async function paidUpdateRoom(tx: Tx, submissionId: string) {
  const { pieceOf, pieceRoom } = await import("./payments");
  const { closedOut, pieceCloseOut } = await import("./closeOut");
  const piece = await pieceOf({ submissionId }, tx);
  const room = piece ? await pieceRoom(piece, tx) : null;
  const shut = closedOut(await pieceCloseOut({ submissionId })); // (Owner, Nov 11, §378) this piece's own date
  return { atCap: !room || room.roomCents <= 0 || shut, paidCents: room?.paidCents ?? 0, roomCents: room?.roomCents ?? 0 };
}

/**
 * (Batch 30 §2) The developer's Work sent alert for an update of a paid piece: below the cap it opens the update's Needs you row; at the cap it says nothing more can
 * be paid (no other stop: the live box has its quiet line).
 */
export async function notifyPaidUpdate(
  c: { id: string; testId: string; title: string; test: { title: string; developer: { email: string } } },
  tester: { id: string; email: string; name: string; pronoun: string },
  submissionId: string,
  part: "written answers" | "recording",
  room: { atCap: boolean; paidCents: number; roomCents: number },
  /** (Batch 35 §136) how many recordings were added */ n = 1,
  /** (§167) the question added to */ question?: string,
) {
  const { displayName, pronouns } = await import("@/lib/format");
  const { notify } = await import("./notify");
  const name = displayName(tester), poss = pronouns(tester.pronoun).poss;
  if (room.atCap) {
    await notify(c.test.developer.email, `${name} ${addedWhat(poss, part, n, question)} for “${c.test.title}”`, [`${updatedAtCapLive(name, poss, part, n, question)}.`], `/app/tests/${c.testId}#tester-${c.id}`, { about: tester.id });
    return;
  }
  await notify(c.test.developer.email, `${name} ${addedWhat(poss, part, n, question)} for “${c.test.title}”`, [`${updateRowLine(name, room.paidCents, room.roomCents)}.`, "Pay more for it, or close it at $0, in Needs you."], `/app/tests/${c.testId}#update-${submissionId}`, { about: tester.id });
}

/** (Batch 30 §2) Whether a waiting update can still be paid more (below its cap, Pay more open): the dashboard's Needs review counts it then. */
export async function updateRoomLeft(submissionId: string) {
  const { db } = await import("@/lib/db");
  return !(await paidUpdateRoom(db, submissionId)).atCap;
}
