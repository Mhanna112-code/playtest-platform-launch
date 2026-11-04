import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, pronouns } from "@/lib/format";
import { ratingSummary } from "@/lib/server/ratings";
import type { Side } from "@/lib/sides";

/** What PersonHover needs for one person: their name, the profile it links to and the summary lines. */
export type PersonHoverInfo = { name: string; href: string; summary: string[]; /** (batch 35 §162) their possessive, for "See her profile" */ poss?: string };

/**
 * (Batch 35 §124) The profile hover for the other person in Messages and in a chat, as the session page's developer name has it: their rating line (or
 * "No ratings yet") and "See their profile". The profile linked is the one for the side in use (a developer's from the tester side, a tester's from the
 * developer side), else the one they have. None (a plain name) for your own name, a deleted account, someone who blocked you (their profile isn't
 * available to you: "This profile isn't available."), or an account with no profile (an admin).
 */
export async function personHoverFor(viewerId: string, side: Side | null, other: User | null | undefined): Promise<PersonHoverInfo | null> {
  if (!other || other.id === viewerId || other.deletedAt) return null;
  const dev = other.isDeveloper ? `/app/developers/${other.id}` : null, tester = other.isTester ? `/app/testers/${other.id}` : null;
  const href = side === "developer" ? (tester ?? dev) : (dev ?? tester);
  if (!href) return null;
  if ((await db.block.count({ where: { blockerId: other.id, blockedId: viewerId } })) > 0) return null;
  return { name: displayName(other), href, poss: pronouns(other.pronoun).poss, summary: [(await ratingSummary(other.id)).line || "No ratings yet"] };
}
