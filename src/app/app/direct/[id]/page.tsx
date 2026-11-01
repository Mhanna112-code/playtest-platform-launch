import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Chat } from "@/components/Chat";
import { AutoRefresh } from "@/components/AutoRefresh";
import { displayName } from "@/lib/format";
import { CHAT_PAUSED_NOTE } from "@/lib/rules";
import { requireOpenPage } from "@/lib/server/page-auth";
import { directAccess, directMessages, directUnable, directV, markDirectRead } from "@/lib/server/directMessages";

export const metadata = { title: "Direct message · Playtest" };
export const dynamic = "force-dynamic";

export default async function DirectPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireOpenPage("/app/direct");
  const { id } = await params;
  const v = await directV(u.id, id);
  const a = await directAccess(u.id, id);
  const unavailableLine = a.other?.deletedAt ? "This chat is closed." : directUnable(a.other);
  const messages = a.conversation ? await directMessages(a.conversation.id) : [];
  const last = messages.at(-1);
  if (a.conversation && last) await markDirectRead(u.id, a.conversation.id, last.createdAt);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <AutoRefresh query={`direct=${encodeURIComponent(id)}`} v={v} />
      <Link href="/app/messages" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white no-underline hover:no-underline"><ArrowLeft className="h-4 w-4" /> Back to Messages</Link>
      {a.unable && !a.conversation ? <p className="info">{unavailableLine}</p> : (
        <Chat path={`/api/direct/${encodeURIComponent(id)}`} keepKey={`chat:direct:${id}`} title="Direct message" other={a.other ? displayName(a.other) : "Deleted account"}
          closed={a.unable || a.paused} closedNote={a.unable ? unavailableLine : a.paused ? CHAT_PAUSED_NOTE : undefined} pausedNote={!a.unable && a.paused}
          messages={messages.map((m) => ({ id: m.id, mine: m.senderId === u.id, who: m.senderId === u.id ? "You" : displayName(m.sender), body: m.body, at: m.createdAt.toISOString() }))} />
      )}
    </div>
  );
}
