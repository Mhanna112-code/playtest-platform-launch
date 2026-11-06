import { DMS_GROUP } from "@/lib/bell";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, User } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { contractsOnSide } from "./sidePage";
import { sideFor } from "@/lib/sides";
import { devRestricted, testerRestricted } from "@/lib/restricted";
import { CHAT_NOT_SENT } from "@/lib/rules";
import { clientMessageId } from "./pressKeys";
import { adminAccount } from "./session";
import { HttpError } from "./http";
import { notify } from "./notify";
import { CHAT_MAX, CHAT_PER_MINUTE, CHAT_TOO_FAST, CHAT_UNABLE, CHAT_UNABLE_DEV, unreadCount } from "./messages";
import { DEV_CHARGEBACK, DEV_HELD, DEV_SUSPENDED, SUSPENDED } from "./users";

export const DIRECT_NEW_LIMIT = 20;
export const DIRECT_LIMIT_LINE = "You've started 20 new conversations in the last 24 hours. Try again later.";
const pair = (a: string, b: string) => a < b ? { firstId: a, secondId: b } : { firstId: b, secondId: a };
export const directRestricted = (u: User) => devRestricted(u, sideFor(u)) || testerRestricted(u, sideFor(u));
export const directUnable = (u: User | null) => (u && (sideFor(u) === "developer" || (!u.isTester && u.side !== "tester"))) ? CHAT_UNABLE_DEV : CHAT_UNABLE;

export function directButtonAllowed(viewer: User, other: User, blocked: boolean) {
  return viewer.id !== other.id && !blocked && !viewer.deletedAt && !other.deletedAt && !adminAccount(viewer) && !adminAccount(other) && (viewer.isDeveloper || viewer.isTester) && (other.isDeveloper || other.isTester) && !directRestricted(viewer);
}

function ownRestriction(u: User) {
  const asDev = sideFor(u) === "developer";
  if (asDev ? u.devSuspendedAt : u.testerSuspendedAt) throw new HttpError(403, "suspended", asDev ? DEV_SUSPENDED : SUSPENDED, { suspended: true, failed: "Your Send didn't go through" });
  if (asDev && u.holdStartedAt) throw new HttpError(403, "held", u.holdReason === "chargeback" ? DEV_CHARGEBACK : DEV_HELD, { held: true, failed: "Your Send didn't go through" });
}

/** An address is the other account ID, so opening an empty chat never creates a conversation. */
export async function directAccess(userId: string, otherId: string, tx: Prisma.TransactionClient = db) {
  const [me, other, blocks] = await Promise.all([
    tx.user.findUnique({ where: { id: userId } }), tx.user.findUnique({ where: { id: otherId } }),
    tx.block.count({ where: { OR: [{ blockerId: userId, blockedId: otherId }, { blockerId: otherId, blockedId: userId }] } }),
  ]);
  const conversation = userId === otherId ? null : await tx.directConversation.findUnique({ where: { firstId_secondId: pair(userId, otherId) } });
  const unable = !me || !other || userId === otherId || !!blocks || !!me.deletedAt || !!other.deletedAt || adminAccount(me) || adminAccount(other) || !(me.isDeveloper || me.isTester) || !(other.isDeveloper || other.isTester);
  return { me, other, conversation, unable, paused: !!other && directRestricted(other) };
}

export async function sendDirect(userId: string, otherId: string, raw: unknown, clientIdRaw?: unknown) {
  const body = typeof raw === "string" ? raw.trim() : "";
  const clientId = clientMessageId(clientIdRaw);
  return db.$transaction(async (tx) => {
    // Serialize this sender's quota and retries. NO KEY UPDATE permits the other sender's FK checks during a simultaneous first message.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`;
    const a = await directAccess(userId, otherId, tx);
    if (a.other?.deletedAt) throw new HttpError(409, "closed", "This chat is closed.");
    if (a.unable || !a.me || !a.other) throw new HttpError(409, "unable", directUnable(a.other));
    ownRestriction(a.me);
    if (a.paused) throw new HttpError(409, "chat_paused", CHAT_NOT_SENT);
    if (clientId) {
      const again = await tx.directMessage.findUnique({ where: { senderId_clientId: { senderId: userId, clientId } } });
      if (again) {
        if (again.conversationId !== a.conversation?.id) throw new HttpError(409, "bad_request", "This page is out of date.");
        return again;
      }
    }
    if (!body) throw new HttpError(400, "empty", "Type a message first.");
    if (body.length > CHAT_MAX) throw new HttpError(400, "too_long", `Keep a message to ${CHAT_MAX.toLocaleString("en-US")} characters.`);
    const recent = { senderId: userId, createdAt: { gt: new Date(Date.now() - 60_000) } };
    const counts = await Promise.all([tx.message.count({ where: recent }), tx.directMessage.count({ where: recent })]);
    if (counts[0] + counts[1] >= CHAT_PER_MINUTE) throw new HttpError(429, "too_fast", CHAT_TOO_FAST);
    let conversation = a.conversation;
    if (!conversation) {
      if (await tx.directConversation.count({ where: { startedById: userId, createdAt: { gt: new Date(Date.now() - 86_400_000) } } }) >= DIRECT_NEW_LIMIT) throw new HttpError(429, "new_conversations", DIRECT_LIMIT_LINE);
      const ids = pair(userId, otherId);
      await tx.$executeRaw`INSERT INTO "DirectConversation" (id, "firstId", "secondId", "startedById", "createdAt", "updatedAt") VALUES (${randomUUID()}, ${ids.firstId}, ${ids.secondId}, ${userId}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') ON CONFLICT ("firstId", "secondId") DO NOTHING`;
      conversation = await tx.directConversation.findUniqueOrThrow({ where: { firstId_secondId: ids } });
    }
    const m = await tx.directMessage.create({ data: { conversationId: conversation.id, senderId: userId, body, clientId } });
    await tx.directConversation.update({ where: { id: conversation.id }, data: { updatedAt: m.createdAt } });
    const line = `New message from ${displayName(a.me)}`;
    // (Owner, Nov 5, §215; was: no reach filter) A bell (and its email line) only when the two share a test: one is or was in the other's open test, as test chat
    // (`about`). The message itself always arrives (Messages, unread). The bell lines stack across tests, one entry a day ("dms"). Bell + message commit together.
    await notify(a.other.email, line, [line, "", body], `/app/direct/${userId}`, { side: null, recipientId: a.other.id, about: userId, group: DMS_GROUP }, tx);
    return m;
  });
}

export async function directMessages(conversationId: string) {
  return (await db.directMessage.findMany({ where: { conversationId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 300, include: { sender: true } })).reverse();
}

export async function markDirectRead(userId: string, conversationId: string, readAt: Date) {
  // Advance only to the newest displayed timestamp, not now; an older tab never moves the marker backwards.
  await db.$executeRaw`INSERT INTO "DirectRead" ("userId", "conversationId", "readAt") VALUES (${userId}, ${conversationId}, ${readAt}::timestamptz AT TIME ZONE 'UTC') ON CONFLICT ("userId", "conversationId") DO UPDATE SET "readAt" = GREATEST("DirectRead"."readAt", EXCLUDED."readAt")`;
}

export async function directUnreadCount(userId: string) {
  const [row] = await db.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM "DirectMessage" m JOIN "DirectConversation" c ON c.id = m."conversationId" LEFT JOIN "DirectRead" r ON r."conversationId" = c.id AND r."userId" = ${userId} WHERE (c."firstId" = ${userId} OR c."secondId" = ${userId}) AND m."senderId" <> ${userId} AND (r."readAt" IS NULL OR m."createdAt" > r."readAt")`;
  return row?.n ?? 0;
}

export async function directConversations(userId: string) {
  const rows = await db.directConversation.findMany({ where: { OR: [{ firstId: userId }, { secondId: userId }] }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 100, include: { first: true, second: true, messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 }, reads: { where: { userId } } } });
  return Promise.all(rows.map(async (c) => ({ id: c.id, other: c.firstId === userId ? c.second : c.first, last: c.messages[0], unread: await db.directMessage.count({ where: { conversationId: c.id, senderId: { not: userId }, ...(c.reads[0] ? { createdAt: { gt: c.reads[0].readAt } } : {}) } }) })));
}

const version = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export async function directV(userId: string, otherId: string) {
  const a = await directAccess(userId, otherId);
  const last = a.conversation ? await db.directMessage.findFirst({ where: { conversationId: a.conversation.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } }) : null;
  return version([a.unable, a.paused, a.me ? directRestricted(a.me) : true, a.conversation?.id, a.other ? displayName(a.other) : "", last?.id]);
}

export async function directListV(userId: string) {
  return version((await directConversations(userId)).map((c) => [c.id, displayName(c.other), c.last?.id, c.unread]));
}

export async function messagesListV(u: User) {
  const contracts = await db.contract.findMany({ where: contractsOnSide(u.id, sideFor(u)), orderBy: { id: "asc" }, select: { testId: true, testerId: true, title: true, tester: { select: { name: true, email: true, deletedAt: true } }, test: { select: { developer: { select: { name: true, email: true, deletedAt: true } } } } } });
  const rows = await Promise.all(contracts.map(async (c) => [c, await db.message.findFirst({ where: { testId: c.testId, testerId: c.testerId }, orderBy: { createdAt: "desc" }, select: { id: true } }), await unreadCount(u.id, c.testId, c.testerId)]));
  return version([rows, await directListV(u.id)]);
}

export async function allUnreadChats(u: User) {
  const side = sideFor(u);
  const [row] = await db.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM "Message" m JOIN "Contract" c ON c."testId" = m."testId" AND c."testerId" = m."testerId" JOIN "Test" t ON t.id = c."testId" LEFT JOIN "ChatRead" r ON r."userId" = ${u.id} AND r."testId" = c."testId" AND r."testerId" = c."testerId" WHERE ((${side === "tester"} AND c."testerId" = ${u.id}) OR (${side === "developer"} AND t."developerId" = ${u.id}) OR (${side === null} AND (c."testerId" = ${u.id} OR t."developerId" = ${u.id}))) AND m."senderId" <> ${u.id} AND (r."readAt" IS NULL OR m."createdAt" > r."readAt")`;
  return (row?.n ?? 0) + await directUnreadCount(u.id);
}
