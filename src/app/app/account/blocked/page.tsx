import { withDateZone } from "@/lib/server/dateZone";
import { fmtDateIn } from "@/lib/format";
import { AutoRefresh } from "@/components/AutoRefresh";
import { OnePage } from "@/components/OnePage";
import { ownPageScope } from "@/lib/pageClaim";
import { blockedV } from "@/lib/server/pageFreshness";
import Link from "next/link";
import { Ban } from "lucide-react";
import { db } from "@/lib/db";
import { displayName } from "@/lib/server/dateFormat";
import { requirePageUser } from "@/lib/server/page-auth";
import { UnblockButton } from "@/components/BlockButton";
import { Cut } from "@/components/Cut";
import { anySuspended } from "@/lib/restricted";

export const metadata = { title: "Blocked people · Playtest" };
export const dynamic = "force-dynamic";

/** People you've blocked, with Unblock (Account → Blocked people). */
export default async function BlockedPage() {
  const u = await requirePageUser();
  return withDateZone(u.timeZone, async () => {

  const fmtDate = (d: Date | string) => fmtDateIn(d, u.timeZone);
  const freshV = await blockedV(u);
  const blocks = await db.block.findMany({ where: { blockerId: u.id }, orderBy: { createdAt: "desc" } });
  const people = new Map((await db.user.findMany({ where: { id: { in: blocks.map((b) => b.blockedId) } } })).map((x) => [x.id, x]));
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <AutoRefresh query="fresh=blocked" v={freshV} />
      {/* (Owner, Nov 11, §380 K) Blocked people: one page at a time, across devices. */}
      <OnePage scope={ownPageScope("blocked")} />
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
                  <span className="block font-medium text-white">{x ? <Cut text={displayName(x)} /> : "Someone"}</span>
                  <span className="text-xs text-slate-500">Blocked {fmtDate(b.createdAt)}</span>
                </span>
                {/* (Owner, Oct 27) Unblock works for a held account; a suspended one reads the list only. */}
                {!anySuspended(u) && <UnblockButton userId={b.blockedId} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  });
}
