import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { leaveIfClosed, requireOpenPage } from "@/lib/server/page-auth";
import { chatMessages, markChatRead } from "@/lib/server/messages";
import { Chat } from "@/components/Chat";
import { CHAT_PAUSED, PAUSE_DEFAULTS, testerPaused } from "@/lib/rules";
import { AutoRefresh } from "@/components/AutoRefresh";

export const metadata = { title: "Chat · Playtest" };
export const dynamic = "force-dynamic";

/**
 * The full app's chat page (/chat/[claimId]): a back link, then the conversation card. One page per session with the other
 * person. Opening it marks the chat read (the unread badge goes); new messages show as the page refreshes.
 */
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // (Owner, Oct 28) Closed to a restricted account (it moves to the dashboard top); with both sides and only a hold, the role in this chat decides.
  const u = await requireOpenPage("/app/chat");
  const c = await db.contract.findUnique({ where: { id }, include: { test: { include: { developer: true } }, tester: true } });
  if (!c || (c.testerId !== u.id && c.test.developerId !== u.id)) notFound();
  const dev = c.test.developerId === u.id;
  leaveIfClosed(u, "/app/chat", dev ? "developer" : "tester");
  const other = dev ? displayName(c.tester) : displayName(c.test.developer);
  const deleted = c.tester.deletedAt != null || c.test.developer.deletedAt != null;
  const blocked = deleted || (await db.block.count({ where: { OR: [{ blockerId: c.testerId, blockedId: c.test.developerId }, { blockerId: c.test.developerId, blockedId: c.testerId }] } })) > 0;
  const messages = await chatMessages(c.testId, c.testerId);
  // (Owner, Oct 28 afternoon, DEFAULT PAUSE_DEFAULTS.chatClosed) Chat is closed both ways while the test is paused.
  const paused = PAUSE_DEFAULTS.chatClosed && testerPaused(c.test.developer, c.test);
  await markChatRead(u.id, c.testId, c.testerId);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <AutoRefresh query={dev ? `test=${c.testId}` : `session=${c.id}`} />
      <Link href={dev ? `/app/tests/${c.testId}#tester-${c.id}` : `/app/sessions/${c.id}`} className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white no-underline hover:no-underline"><ArrowLeft className="h-4 w-4" /> Back to {dev ? "the test" : "your session"}</Link>
      <Chat
        closed={blocked || paused}
        closedNote={!blocked && paused ? CHAT_PAUSED : undefined}
        keepKey={`chat:${c.testId}:${c.testerId}`}
        path={dev ? `/api/tests/${c.testId}/message` : `/api/sessions/${c.id}/message`}
        extra={dev ? { contractId: c.id } : {}}
        other={other}
        title={c.title}
        messages={messages.map((m) => ({ id: m.id, mine: m.senderId === u.id, who: m.senderId === u.id ? "You" : displayName(m.sender), body: m.body, at: m.createdAt.toISOString() }))}
      />
    </div>
  );
}
