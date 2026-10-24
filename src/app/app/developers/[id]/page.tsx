import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, CalendarClock } from "lucide-react";
import { db } from "@/lib/db";
import { displayName, fmtDate } from "@/lib/format";
import { termsLine } from "@/lib/rules";
import { requirePageUser } from "@/lib/server/page-auth";
import { DeveloperTiles } from "@/components/ProfileTiles";
import { BlockButton } from "@/components/BlockButton";

export const metadata = { title: "Developer · Playtest" };
export const dynamic = "force-dynamic";

/**
 * A developer's profile as testers see it (the full app's developer page): who they are, how they review (the tiles and
 * what each counts), and their open tests. Not shown between people who blocked each other.
 */
export default async function DeveloperProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requirePageUser();
  const p = await db.user.findUnique({ where: { id } });
  if (!p || !p.isDeveloper) notFound();
  const mine = viewer.id === p.id;
  if (!mine && !viewer.isAdmin && (await db.block.count({ where: { OR: [{ blockerId: viewer.id, blockedId: p.id }, { blockerId: p.id, blockedId: viewer.id }] } }))) notFound();
  const open = await db.test.findMany({ where: { developerId: p.id, status: "open" }, orderBy: { createdAt: "desc" }, include: { contracts: { where: { status: "working" }, select: { id: true } } } });
  const name = displayName(p);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-sky-300 to-indigo-400 text-xl font-semibold text-ink-950">{name.charAt(0).toUpperCase()}</span>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">{name}</h1>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
              <span className="flex items-center gap-1"><CalendarDays className="h-4 w-4" /> Posting tests since {fmtDate(p.createdAt)}</span>
            </p>
          </div>
          {mine && <Link href="/app/profile" className="btn-secondary px-3 py-1.5 text-sm">Edit profile</Link>}
        </div>
        {mine && <p className="text-xs text-slate-500">This is how testers see your profile.</p>}
      </section>
      <DeveloperTiles userId={p.id} />
      <section className="card space-y-3">
        <h2 className="font-semibold text-white">Open tests</h2>
        {open.length === 0 ? <p className="text-sm text-slate-400">No open tests right now.</p> : (
          <ul className="space-y-2">
            {open.map((t) => (
              <li key={t.id}>
                <Link href={mine ? `/app/tests/${t.id}` : `/app/find/${t.id}`} className="flex items-center gap-3 rounded-xl border border-white/10 p-3 text-ink-100 no-underline hover:bg-white/[0.04] hover:no-underline">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-white">{t.title}</span>
                    <span className="flex items-start gap-1.5 text-xs text-slate-400">
                      <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{termsLine(t, !mine)} · {Math.max(0, t.spots - t.contracts.length)} of {t.spots} spots left</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {/* Block the developer, as in the full app: a small link at the bottom of their profile (testers only). */}
      {viewer.isTester && !mine && !(await db.block.count({ where: { blockerId: viewer.id, blockedId: p.id } })) && (
        <div className="text-right text-xs text-slate-500">
          <BlockButton plain userId={p.id} name={name} effect="You won't see their tests or profile any more, and they can't invite you." />
        </div>
      )}
    </div>
  );
}
