import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { ratingSummary } from "@/lib/server/ratings";
import type { Side } from "@/lib/sides";

/** What PersonHover needs for one person: their name, the profile it links to and the summary lines. */
export type PersonHoverInfo = { name: string; href: string; summary: string[]; /** (§335) */ pronoun: string };

/**
 * (Batch 35 §124) The profile hover for the other person in Messages and in a chat, as the session page's developer name has it: their rating line (or
 * "No ratings yet"); (owner, Nov 3, §166) the name is the link to the profile. The profile linked is the one for the side in use (a developer's from the tester side, a tester's from the
 * developer side), else the one they have. None (a plain name) for your own name, a deleted account, someone who blocked you (their profile isn't
 * available to you: "This profile isn't available."), or an account with no profile (an admin).
 */
export async function personHoverFor(viewerId: string, side: Side | null, other: User | null | undefined): Promise<PersonHoverInfo | null> {
  if (!other || other.id === viewerId || other.deletedAt) return null;
  const dev = other.isDeveloper ? `/app/developers/${other.id}` : null, tester = other.isTester ? `/app/testers/${other.id}` : null;
  const href = side === "developer" ? (tester ?? dev) : (dev ?? tester);
  if (!href) return null;
  if ((await db.block.count({ where: { blockerId: other.id, blockedId: viewerId } })) > 0) return null;
  // (Owner, Nov 5, §276) The rating of the profile linked: their tester-side ratings for a tester's profile, their developer-side ones for a developer's.
  return { name: displayName(other), href, pronoun: other.pronoun, summary: [(await ratingSummary(other.id, href === tester ? "tester" : "developer")).line || "No ratings yet"] };
}
