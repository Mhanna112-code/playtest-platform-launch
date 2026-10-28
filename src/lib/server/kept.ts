import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { HttpError } from "./http";

// (NEXT-UI 10) Typed but not sent: kept per person and form on the server (so it follows them to any device and survives
// signing out). ONLY these kinds of form (a key starts with one of them); never sign-in / sign-up.
const KINDS = ["written:", "chat:", "dispute:", "rate:", "reject:", "test:"];
const MAX_BYTES = 400_000; // (batch 14) room for a 50,000-character written part

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
  await db.keptForm.upsert({
    where: { userId_key: { userId, key: k } },
    update: { data: data as Prisma.InputJsonValue },
    create: { userId, key: k, data: data as Prisma.InputJsonValue },
  });
  return { kept: true };
}
