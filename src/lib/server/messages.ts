import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { HttpError } from "./http";
import { notify } from "./notify";
import { CHAT_NOT_SENT } from "@/lib/rules";
import { clientMessageId } from "./pressKeys";

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

export const CHAT_UNABLE = "Unable to chat with this tester.";

/**
 * (Owner, Oct 30, batch 15 sections 1 and 16) Who in this chat is restricted right now: the test's developer when their developer side is suspended or they're on a
 * payment or chargeback hold; the tester when their tester side is suspended. Only chats where the person is on the restricted side are paused.
 */
export async function chatRestriction(testId: string, testerId: string) {
  const test = await db.test.findUniqueOrThrow({ where: { id: testId }, select: { developer: { select: { devSuspendedAt: true, holdStartedAt: true, holdReason: true } } } });
  const tester = await db.user.findUniqueOrThrow({ where: { id: testerId }, select: { testerSuspendedAt: true } });
  return { developer: !!(test.developer.devSuspendedAt || test.developer.holdStartedAt), tester: !!tester.testerSuspendedAt, dev: test.developer };
}

/**
 * (Owner, Oct 26) "Chat with <name>" on a tester's hover card and profile (developer side): opens the same per-test chat as the Testers panel's Chat button.
 * Where a block exists either way, or the chat would otherwise be refused (a suspended or deleted account), the press says only "Unable to chat with this tester."
 */
export const CHAT_UNABLE_DEV = "Unable to chat with this developer.";
export async function openTesterChat(who: { id: string; devSuspendedAt?: Date | null; testerSuspendedAt?: Date | null; holdStartedAt?: Date | null }, body: Record<string, unknown>) {
  const c = await db.contract.findUnique({ where: { id: String(body.contractId ?? "") }, include: { test: { include: { developer: true } }, tester: true } });
  if (!c || (c.test.developerId !== who.id && c.testerId !== who.id)) throw new HttpError(404, "not_found", "That chat doesn't exist.");
  const a = await chatAccess(who.id, c.testId, c.testerId).catch(() => null);
  // (Owner, Oct 27) "Chat with <name>" is on every hover card, both ways. It is refused while the viewer is restricted on that side, or a block exists. (Batch 15 section 1)
  // When the OTHER person is restricted the chat still opens: it can be read, and its box says messages are paused.
  if (c.testerId === who.id) {
    if (!a || a.blocked || who.testerSuspendedAt) throw new HttpError(409, "unable", CHAT_UNABLE_DEV);
  } else if (!a || a.blocked || who.devSuspendedAt || who.holdStartedAt) throw new HttpError(409, "unable", CHAT_UNABLE);
  return { href: `/app/chat/${c.id}` };
}

/** Kept for the session page (by contract). */
export async function chatFor(userId: string, contractId: string) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: true } });
  if (!c || (c.testerId !== userId && c.test.developerId !== userId)) throw new HttpError(404, "not_found", "That chat doesn't exist.");
  return c;
}

export const firstWords = (s: string, max = 60) => (s.length <= max ? s : s.slice(0, max).replace(/\s+\S*$/, "") + "…");

/** (Batch 15 sections 13 and 41) A chat message's press id: a UUID made when the person presses Send, kept only while that message isn't confirmed. */
const readClientId = clientMessageId;
/** (Batch 15 section 41, L2) At most this many messages a minute per person. */
export const CHAT_PER_MINUTE = 30;
export const CHAT_TOO_FAST = "You're sending messages very fast. Wait a minute, then send again.";

export async function sendChat(user: { id: string; name: string; email: string }, testId: string, testerId: string, raw: unknown, clientIdRaw?: unknown) {
  const a = await chatAccess(user.id, testId, testerId);
  if (a.blocked) throw new HttpError(409, "closed", "This chat is closed.");
  // (Batch 15 section 13) The same press again (its answer was lost): the message it already posted, never a second one.
  const clientId = readClientId(clientIdRaw);
  if (clientId) {
    const again = await db.message.findFirst({ where: { senderId: user.id, clientId } });
    if (again) return again;
  }
  // (Owner, Oct 30, batch 15 section 1) Never closed because the TEST is paused: only while a person is restricted. The restricted person's own press is refused like Rate
  // (the route's requireActive sends them to the dashboard top); the other person's Send is turned back with a neutral notice and the text is kept.
  const r = await chatRestriction(testId, testerId);
  const iAmDev = user.id === a.test.developerId;
  if (iAmDev ? r.developer : r.tester) throw new HttpError(403, iAmDev && !r.dev.devSuspendedAt ? "held" : "suspended", iAmDev ? "Your tests are paused." : "Your account is paused.", { failed: `Your message on ${a.test.title} didn't go through`, [iAmDev && !r.dev.devSuspendedAt ? "held" : "suspended"]: true });
  if (iAmDev ? r.tester : r.developer) throw new HttpError(409, "chat_paused", CHAT_NOT_SENT);
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) throw new HttpError(400, "empty", "Type a message first.");
  if ((await db.message.count({ where: { senderId: user.id, createdAt: { gt: new Date(Date.now() - 60_000) } } })) >= CHAT_PER_MINUTE) throw new HttpError(429, "too_fast", CHAT_TOO_FAST);
  if (body.length > CHAT_MAX) throw new HttpError(400, "too_long", `Keep a message to ${CHAT_MAX.toLocaleString("en-US")} characters.`);
  const m = await db.message.create({ data: { testId, testerId, contractId: a.contract.id, senderId: user.id, body, clientId } }).catch(async (e) => {
    // Two presses of the same message at once: the first one wins.
    const again = clientId ? await db.message.findFirst({ where: { senderId: user.id, clientId } }) : null;
    if (again) return again;
    throw e;
  });
  const toDev = user.id === testerId;
  const recipient = await db.user.findUniqueOrThrow({ where: { id: toDev ? a.test.developerId : testerId } });
  const from = displayName(user);
  // (Owner, Oct 30, batch 15 section 20) The bell never carries the message itself: it says who wrote, and the email has the text.
  const line = a.active ? `${from} sent you a message on “${a.test.title}”` : `New message from ${from}`;
  const link = toDev ? `/app/tests/${testId}` : `/app/sessions/${a.contract.id}`;
  await notify(recipient.email, line, [line, "", body], link, { about: user.id });
  return m;
}
/** A chat message is at most this long. */
export const CHAT_MAX = 4000;

export async function sendMessage(user: { id: string; name: string; email: string }, contractId: string, raw: unknown, clientId?: unknown) {
  const c = await chatFor(user.id, contractId);
  return sendChat(user, c.testId, c.testerId, raw, clientId);
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
