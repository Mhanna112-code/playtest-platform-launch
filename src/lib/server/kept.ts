import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "./http";
import { trimAtSignIn } from "@/lib/keptText";

// (NEXT-UI 10) Typed but not sent: kept per person and form on the server (so it follows them to any device and survives
// signing out). ONLY these kinds of form (a key starts with one of them); never sign-in / sign-up.
// (Batch 20 section 18) Also Request a time (both sides), End early's and Stop's reasons. (Batch 35 §8) And the Pay / Pay more boxes' note ("pay:", "more:"; the
// boxes that replaced Reject in batch 15 kept under these keys, which this list never had, so their notes were never kept).
const KINDS = ["written:", "chat:", "dispute:", "rate:", "reject:", "pay:", "more:", "test:", "request:", "endearly:", "stop:"];
const MAX_BYTES = 1_100_000; // (batch 15 sections 3 and 17) room for 20 questions and the steps at 20,000 characters each, or a 50,000-character written part with its questions
/** (Batch 15 section 41, L2) Kept forms per person. */
export const MAX_KEPT = 50;

function checkKey(key: unknown) {
  if (typeof key !== "string" || key.length > 160 || !/^[A-Za-z0-9:_.-]+$/.test(key) || !KINDS.some((k) => key.startsWith(k))) throw new HttpError(400, "bad_key", "That form isn't kept.");
  return key;
}

export async function getKept(userId: string, key: unknown) {
  const k = checkKey(key);
  const row = await db.keptForm.findUnique({ where: { userId_key: { userId, key: k } } });
  return { data: row?.data ?? null };
}

/** Keep what's typed (data), or forget it (data = null: the form was sent, or emptied). */
export async function setKept(userId: string, key: unknown, data: unknown) {
  const k = checkKey(key);
  if (data === null || data === undefined) {
    await db.keptForm.deleteMany({ where: { userId, key: k } });
    return { kept: false };
  }
  if (JSON.stringify(data).length > MAX_BYTES) throw new HttpError(413, "too_big", "That's too much to keep.");
  // (Batch 15 section 41, L2) At most 50 kept forms per person: a new one drops the oldest.
  if (!(await db.keptForm.findUnique({ where: { userId_key: { userId, key: k } }, select: { key: true } }))) {
    const extra = (await db.keptForm.count({ where: { userId } })) - (MAX_KEPT - 1);
    if (extra > 0) {
      const oldest = await db.keptForm.findMany({ where: { userId }, orderBy: { updatedAt: "asc" }, take: extra, select: { key: true } });
      await db.keptForm.deleteMany({ where: { userId, key: { in: oldest.map((o) => o.key) } } });
    }
  }
  await db.keptForm.upsert({
    where: { userId_key: { userId, key: k } },
    update: { data: data as Prisma.InputJsonValue },
    create: { userId, key: k, data: data as Prisma.InputJsonValue },
  });
  return { kept: true };
}

/**
 * (Owner, Oct 30, batch 35 §8) The person just signed in (after signing out, or after another account signed in on this browser): each of their drafts is marked,
 * so every form comes back with its latest draft as "Draft" (with "Use saved"). With SIGN_IN_DRAFTS "written" (lib/keptText.ts) a draft keeps only its written
 * parts (every selection or number shows its SAVED value) and a draft with nothing written (a call request's times) goes. Run at every sign-in
 * (lib/server/session.ts createSession), so it holds on every device.
 */
export async function trimDraftsAtSignIn(userId: string) {
  const rows = await db.keptForm.findMany({ where: { userId }, select: { key: true, data: true } });
  for (const r of rows) {
    const t = trimAtSignIn(r.key, r.data);
    if (!t) await db.keptForm.deleteMany({ where: { userId, key: r.key } });
    else if (JSON.stringify(t) !== JSON.stringify(r.data)) await db.keptForm.update({ where: { userId_key: { userId, key: r.key } }, data: { data: t as Prisma.InputJsonValue } });
  }
}
