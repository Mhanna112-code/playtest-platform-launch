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
  const u = await requireOpenPage("/app/messages"); // (Owner, Oct 28) closed to a restricted account: it moves to the dashboard top before anything renders
  // (Batch 34 §5) Only the side in use's conversations (as a tester, or on your own tests).
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
  convos.sort((a, b) => (b.last?.createdAt.getTime() ?? b.c.joinedAt.getTime()) - (a.last?.createdAt.getTime() ?? a.c.joinedAt.getTime()));
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white"><MessagesSquare className="h-7 w-7 text-indigo-300" /> Messages</h1>
      <p className="text-sm text-slate-400">One conversation per test you&apos;re part of. It opens as soon as a tester joins.</p>
      <ul className="space-y-2">
        {convos.map(({ c, last, unread }) => {
          const other = c.testerId === u.id ? displayName(c.test.developer) : displayName(c.tester);
          return (
            <li key={c.id}>
              <Link href={`/app/chat/${c.id}`} className="card card-hover flex items-center gap-3 p-4 no-underline hover:no-underline">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white" title={`${other} · ${c.title}`}>{other} <span className="text-sm font-normal text-slate-400">· {c.title}</span></p>
                  <p className="truncate text-sm text-slate-400">{last ? `${last.senderId === u.id ? "You" : displayName(last.sender)}: ${last.body}` : "No messages yet."}</p>
                </div>
                {unread > 0 && <span className="rounded-full bg-fuchsia-500 px-2 py-0.5 text-xs text-white">{unread}</span>}
              </Link>
            </li>
          );
        })}
        {convos.length === 0 && <li className="card text-sm text-slate-400">No conversations yet.</li>}
      </ul>
    </div>
  );
}
