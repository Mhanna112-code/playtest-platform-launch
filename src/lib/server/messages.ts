import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { HttpError } from "./http";
import { notify } from "./notify";

// Per-test chat between the developer and one tester (owner rule): open to testers in the test, invited testers
// (open invite), applicants (pending) and past participants; never after a block. Bell: "Nora Lane · Harbor Run:
// <first words>" while the test is open and the tester is in / invited / applied; otherwise "New message from Nora
// Lane". Email follows each person's setting.

export async function chatAccess(userId: string, testId: string, testerId: string) {
  const test = await db.test.findUnique({ where: { id: testId } });
  if (!test || (userId !== testerId && userId !== test.developerId) || testerId === test.developerId) throw new HttpError(404, "not_found", "That chat doesn't exist.");
  // (NEWEST+11) Only testers who are or were in the test: never an applicant or an invited tester before they join.
  const contract = await db.contract.findUnique({ where: { testId_testerId: { testId, testerId } } });
  if (!contract) throw new HttpError(404, "not_found", "That chat doesn't exist.");
  const blocked = (await db.block.count({ where: { OR: [{ blockerId: testerId, blockedId: test.developerId }, { blockerId: test.developerId, blockedId: testerId }] } })) > 0;
  const active = test.status !== "stopped" && contract.status === "working";
  // (Design doc 2) A deleted account's chats are read-only.
  const gone = (await db.user.count({ where: { id: { in: [testerId, test.developerId] }, deletedAt: { not: null } } })) > 0;
  return { test, contract, blocked: blocked || gone, active };
}

/** Kept for the session page (by contract). */
export async function chatFor(userId: string, contractId: string) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: true } });
  if (!c || (c.testerId !== userId && c.test.developerId !== userId)) throw new HttpError(404, "not_found", "That chat doesn't exist.");
  return c;
}

export const firstWords = (s: string, max = 60) => (s.length <= max ? s : s.slice(0, max).replace(/\s+\S*$/, "") + "…");

export async function sendChat(user: { id: string; name: string; email: string }, testId: string, testerId: string, raw: unknown) {
  const a = await chatAccess(user.id, testId, testerId);
  if (a.blocked) throw new HttpError(409, "closed", "This chat is closed.");
  const body = typeof raw === "string" ? raw.trim().slice(0, 4000) : "";
  if (!body) throw new HttpError(400, "empty", "Type a message first.");
  const m = await db.message.create({ data: { testId, testerId, contractId: a.contract.id, senderId: user.id, body } });
  const toDev = user.id === testerId;
  const recipient = await db.user.findUniqueOrThrow({ where: { id: toDev ? a.test.developerId : testerId } });
  const from = displayName(user);
  const line = a.active ? `${from} · ${a.test.title}: ${firstWords(body)}` : `New message from ${from}`;
  const link = toDev ? `/app/tests/${testId}` : `/app/sessions/${a.contract.id}`;
  await notify(recipient.email, line, [line, "", body], link, { about: user.id });
  return m;
}

export async function sendMessage(user: { id: string; name: string; email: string }, contractId: string, raw: unknown) {
  const c = await chatFor(user.id, contractId);
  return sendChat(user, c.testId, c.testerId, raw);
}

export const chatMessages = (testId: string, testerId: string) =>
  db.message.findMany({ where: { testId, testerId }, orderBy: { createdAt: "asc" }, include: { sender: true }, take: 300 });

/** (NEXT-UI 4) Unread: the other side's messages in this chat after the person last opened it. */
export async function unreadCount(userId: string, testId: string, testerId: string) {
  const read = await db.chatRead.findUnique({ where: { userId_testId_testerId: { userId, testId, testerId } } });
  return db.message.count({ where: { testId, testerId, senderId: { not: userId }, ...(read ? { createdAt: { gt: read.readAt } } : {}) } });
}

/** Opening the chat page marks it read. */
export async function markChatRead(userId: string, testId: string, testerId: string) {
  await db.chatRead.upsert({
    where: { userId_testId_testerId: { userId, testId, testerId } },
    update: { readAt: new Date() },
    create: { userId, testId, testerId },
  });
}
