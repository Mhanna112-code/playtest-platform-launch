import { notFound } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { requirePageUser } from "@/lib/server/page-auth";
import { chatMessages, markChatRead } from "@/lib/server/messages";
import { Chat } from "@/components/Chat";
import { AutoRefresh } from "@/components/AutoRefresh";

export const metadata = { title: "Chat · Playtest" };
export const dynamic = "force-dynamic";

/**
 * The full app's chat page (/chat/[claimId]): one page per session with the other person. Opening it marks the chat
 * read (the unread badge on the session link goes). New messages show as the page refreshes.
 */
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requirePageUser();
  const c = await db.contract.findUnique({ where: { id }, include: { test: { include: { developer: true } }, tester: true } });
  if (!c || (c.testerId !== u.id && c.test.developerId !== u.id)) notFound();
  const dev = c.test.developerId === u.id;
  const other = dev ? displayName(c.tester) : displayName(c.test.developer);
  const blocked = (await db.block.count({ where: { OR: [{ blockerId: c.testerId, blockedId: c.test.developerId }, { blockerId: c.test.developerId, blockedId: c.testerId }] } })) > 0;
  const messages = await chatMessages(c.testId, c.testerId);
  await markChatRead(u.id, c.testId, c.testerId);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <AutoRefresh query={dev ? `test=${c.testId}` : `session=${c.id}`} />
      <p><a href={dev ? `/app/tests/${c.testId}#tester-${c.id}` : `/app/sessions/${c.id}`}>← Back to {dev ? c.test.title : "your session"}</a></p>
      <section className="card space-y-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white"><MessagesSquare className="h-6 w-6 text-indigo-300" /> Chat with {other}</h1>
        <p className="text-sm text-slate-400">{c.title}</p>
        <Chat
          closed={blocked}
          keepKey={`chat:${c.testId}:${c.testerId}`}
          path={dev ? `/api/tests/${c.testId}/message` : `/api/sessions/${c.id}/message`}
          extra={dev ? { contractId: c.id } : {}}
          other={other}
          messages={messages.map((m) => ({ id: m.id, mine: m.senderId === u.id, who: m.senderId === u.id ? "You" : displayName(m.sender), body: m.body, at: m.createdAt.toISOString() }))}
        />
      </section>
    </div>
  );
}
