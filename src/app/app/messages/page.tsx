import { withDateZone } from "@/lib/server/dateZone";
import { AutoRefresh } from "@/components/AutoRefresh";
import { messagesV } from "@/lib/server/pageFreshness";
import { directConversations, messagesListV } from "@/lib/server/directMessages";
import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { db } from "@/lib/db";
import { displayName } from "@/lib/format";
import { requireOpenPage } from "@/lib/server/page-auth";
import { contractsOnSide } from "@/lib/server/sidePage";
import { sideFor } from "@/lib/sides";
import { unreadCount } from "@/lib/server/messages";

export const metadata = { title: "Messages · Playtest" };
export const dynamic = "force-dynamic";

/** Every conversation you're in, newest activity first, with unread counts (the full app's /messages). */
export default async function MessagesPage() {
  const u = await requireOpenPage("/app/messages");
  return withDateZone(u.timeZone, async () => {
 // (Owner, Oct 28) closed to a restricted account: it moves to the dashboard top before anything renders
  // (Batch 34 §5) Only the side in use's conversations (as a tester, or on your own tests).
  const freshV = await messagesV(u);
  const pageV = await messagesListV(u);
  const contracts = await db.contract.findMany({
    where: contractsOnSide(u.id, sideFor(u)),
    include: { test: { include: { developer: true } }, tester: true },
    orderBy: { joinedAt: "desc" },
    take: 100, // (Owner, Oct 27) the newest 100 conversations
  });
  const convos = await Promise.all(contracts.map(async (c) => {
    const last = await db.message.findFirst({ where: { testId: c.testId, testerId: c.testerId }, orderBy: { createdAt: "desc" }, include: { sender: true } });
    return { c, last, unread: await unreadCount(u.id, c.testId, c.testerId) };
  }));
  const direct = await directConversations(u.id);
  const rows = [
    ...convos.map(({ c, last, unread }) => ({ id: `test:${c.id}`, href: `/app/chat/${c.id}`, other: c.testerId === u.id ? displayName(c.test.developer) : displayName(c.tester), title: c.title, lastBody: last?.body, mine: last?.senderId === u.id, unread, at: last?.createdAt.getTime() ?? c.joinedAt.getTime() })),
    ...direct.map((c) => ({ id: `direct:${c.id}`, href: `/app/direct/${c.other.id}`, other: displayName(c.other), title: "Direct message", lastBody: c.last?.body, mine: c.last?.senderId === u.id, unread: c.unread, at: c.last?.createdAt.getTime() ?? 0 })),
  ].sort((a, b) => b.at - a.at).slice(0, 100);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <AutoRefresh query="fresh=messages" v={freshV} />
      <AutoRefresh query="messages=1" v={pageV} />
      <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white"><MessagesSquare className="h-7 w-7 text-indigo-300" /> Messages</h1>
      <p className="text-sm text-slate-400">Test chats and direct messages, newest first.</p>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={r.href} className="card card-hover flex items-center gap-3 p-4 no-underline hover:no-underline">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-white" title={`${r.other} · ${r.title}`}>{r.other} <span className="text-sm font-normal text-slate-400">· {r.title}</span></p>
                <p className="truncate text-sm text-slate-400">{r.lastBody ? `${r.mine ? "You" : r.other}: ${r.lastBody}` : "No messages yet."}</p>
              </div>
              {r.unread > 0 && <span className="rounded-full bg-fuchsia-500 px-2 py-0.5 text-xs text-white">{r.unread}</span>}
            </Link>
          </li>
        ))}
        {rows.length === 0 && <li className="card text-sm text-slate-400">No conversations yet.</li>}
      </ul>
    </div>
  );

  });
}
