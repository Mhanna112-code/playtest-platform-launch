import { Cut, TestName } from "@/components/Cut";
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
import { PersonHover } from "@/components/PersonHover";
import { personHoverFor } from "@/lib/server/personHover";

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
    const asTester = c.testerId === u.id;
    // (Batch 35 §124) The other person's name has the profile hover the session page uses.
    return { c, last, unread: await unreadCount(u.id, c.testId, c.testerId), hover: await personHoverFor(u.id, asTester ? "tester" : "developer", asTester ? c.test.developer : c.tester) };
  }));
  const direct = await Promise.all((await directConversations(u.id)).map(async (c) => ({ ...c, hover: await personHoverFor(u.id, sideFor(u), c.other) })));
  const rows = [
    ...convos.map(({ c, last, unread, hover }) => ({ hover, id: `test:${c.id}`, href: `/app/chat/${c.id}`, other: c.testerId === u.id ? displayName(c.test.developer) : displayName(c.tester), title: c.title, lastBody: last?.body, mine: last?.senderId === u.id, unread, at: last?.createdAt.getTime() ?? c.joinedAt.getTime() })),
    ...direct.map((c) => ({ hover: c.hover, id: `direct:${c.id}`, href: `/app/direct/${c.other.id}`, other: displayName(c.other), title: "Direct message", lastBody: c.last?.body, mine: c.last?.senderId === u.id, unread: c.unread, at: c.last?.createdAt.getTime() ?? 0 })),
  ].sort((a, b) => b.at - a.at).slice(0, 100);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <AutoRefresh query="fresh=messages" v={freshV} />
      <AutoRefresh query="messages=1" v={pageV} />
      <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white"><MessagesSquare className="h-7 w-7 text-indigo-300" /> Messages</h1>
      <p className="text-sm text-slate-400">Test chats and direct messages, newest first.</p>
      <ul className="space-y-2">
        {rows.map((r) => (
          // (Batch 35 §124) The row opens the chat through a link laid over the card, so the name's profile hover (its own link) sits above it.
          <li key={r.id} className="card card-hover relative flex items-center gap-3 p-4 hover:z-10 focus-within:z-10">
            <Link href={r.href} aria-label={`${r.other} · ${r.title}`} className="absolute inset-0 rounded-2xl no-underline hover:no-underline" />
            <div className="min-w-0 flex-1">
              {/* (Owner, Nov 3, long text) A long name wraps inside the card (never past it); the test's name then goes under it, cut with "…". */}
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-1 font-medium text-white">
                {r.hover ? <span className="relative z-10 min-w-0 max-w-full" data-person-hover=""><PersonHover {...r.hover} /></span> : <span className="min-w-0 max-w-full"><Cut text={r.other} /></span>}
                <span className="min-w-0 max-w-full text-sm font-normal text-slate-400 [overflow-wrap:anywhere]">· {r.id.startsWith("direct:") ? r.title : <TestName text={r.title} />}</span>
              </p>
              <p className="truncate text-sm text-slate-400">{r.lastBody ? <>{r.mine ? "You" : <Cut text={r.other} />}: {r.lastBody}</> : "No messages yet."}</p>
            </div>
            {r.unread > 0 && <span className="shrink-0 rounded-full bg-fuchsia-500 px-2 py-0.5 text-xs text-white">{r.unread > 9 ? "9+" : r.unread}</span>}
          </li>
        ))}
        {rows.length === 0 && <li className="card text-sm text-slate-400">No conversations yet.</li>}
      </ul>
    </div>
  );

  });
}
