import Link from "next/link";
import { Ban } from "lucide-react";
import { db } from "@/lib/db";
import { displayName, fmtDate } from "@/lib/format";
import { requirePageUser } from "@/lib/server/page-auth";
import { UnblockButton } from "@/components/BlockButton";

export const metadata = { title: "Blocked people · Playtest" };
export const dynamic = "force-dynamic";

/** People you've blocked, with Unblock (Account → Blocked people). */
export default async function BlockedPage() {
  const u = await requirePageUser();
  const blocks = await db.block.findMany({ where: { blockerId: u.id }, orderBy: { createdAt: "desc" } });
  const people = new Map((await db.user.findMany({ where: { id: { in: blocks.map((b) => b.blockedId) } } })).map((x) => [x.id, x]));
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="space-y-1">
        <p className="text-sm"><Link href="/app/account" className="text-slate-400 hover:text-white">← Account</Link></p>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white"><Ban className="h-6 w-6 text-rose-300" /> Blocked people</h1>
        <p className="text-slate-400">Someone you block can&apos;t join or apply to your tests, and you can&apos;t be invited to theirs. They aren&apos;t told. Unblocking doesn&apos;t reopen anything that ended.</p>
      </div>
      {blocks.length === 0 ? (
        <p className="card text-sm text-slate-400">You haven&apos;t blocked anyone.</p>
      ) : (
        <ul className="card divide-y divide-white/5">
          {blocks.map((b) => {
            const x = people.get(b.blockedId);
            return (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-white">{x ? displayName(x) : "Someone"}</span>
                  <span className="text-xs text-slate-500">Blocked {fmtDate(b.createdAt)}</span>
                </span>
                <UnblockButton userId={b.blockedId} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
