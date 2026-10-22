import { db } from "@/lib/db";
import { HttpError } from "./http";

/** The simple per-test chat between the developer and one tester. Only those two can read or write it. */
export async function chatFor(userId: string, contractId: string) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: true } });
  if (!c || (c.testerId !== userId && c.test.developerId !== userId)) throw new HttpError(404, "not_found", "That chat doesn't exist.");
  return c;
}

export async function sendMessage(user: { id: string }, contractId: string, raw: unknown) {
  const c = await chatFor(user.id, contractId);
  if ((await db.block.count({ where: { OR: [{ blockerId: c.testerId, blockedId: c.test.developerId }, { blockerId: c.test.developerId, blockedId: c.testerId }] } })) > 0) throw new HttpError(409, "closed", "This chat is closed.");
  const body = typeof raw === "string" ? raw.trim().slice(0, 4000) : "";
  if (!body) throw new HttpError(400, "empty", "Type a message first.");
  return db.message.create({ data: { contractId, senderId: user.id, body } });
}
