import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Languages, Monitor } from "lucide-react";
import { db } from "@/lib/db";
import { displayName, fmtDate } from "@/lib/format";
import { requireOpenPage } from "@/lib/server/page-auth";
import { TesterTiles } from "@/components/ProfileTiles";
import { ChatWithButton } from "@/components/ChatWithButton";
import { AdminPersonBoxes, AdminTestBoxes } from "@/app/admin/AdminBoxes";
import { isAdmin } from "@/lib/server/session";
import { anySuspended, devRestricted } from "@/lib/restricted";
import { sideFor } from "@/lib/sides";

import { BlockButton } from "@/components/BlockButton";
import { ReportButton } from "@/components/ReportButton";
import { MyExcerpts, ShownExcerpts } from "@/components/ExcerptList";
import { myExcerpts, shownExcerpts } from "@/lib/server/excerpts";
import { TesterTests } from "@/components/TesterTests";
import { testerTestsFor } from "@/lib/server/testerTests";

export const metadata = { title: "Tester · Playtest" };
export const dynamic = "force-dynamic";

/**
 * A tester's profile as developers see it (the full app's tester profile): who they are, the two tiles (Accepted parts,
 * Rating) with what they count, and About. For developers (and the tester themself); not between people who blocked
 * each other.
 */
export default async function TesterProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireOpenPage("/app/testers"); // (Owner, Oct 28) closed to a restricted account: it moves to the dashboard top before anything renders
  const p = await db.user.findUnique({ where: { id }, include: { profile: true } });
  if (!p || !p.isTester) notFound();
  const mine = viewer.id === p.id;
  // (Owner, Oct 27) A suspended or held developer can read this page, but Chat with, Report, Block and Edit profile are hidden.
  const off = viewer.isDeveloper && devRestricted(viewer, sideFor(viewer, "/app/testers"));
  if (!mine && !isAdmin(viewer) && !viewer.isDeveloper) notFound();
  if (!mine && !isAdmin(viewer) && (await db.block.count({ where: { OR: [{ blockerId: viewer.id, blockedId: p.id }, { blockerId: p.id, blockedId: viewer.id }] } }))) notFound();
  const name = displayName(p);
  const pr = p.profile;
  // (Owner, Oct 26) "Chat with <name>" for a developer: the chat of the most recent test they share; hidden when they share none.
  const shared = !mine && viewer.isDeveloper && !off ? await db.contract.findFirst({ where: { testerId: p.id, test: { developerId: viewer.id } }, orderBy: { joinedAt: "desc" }, select: { id: true } }) : null;
  const reportedRow = !mine ? await db.report.findUnique({ where: { reporterId_reportedId: { reporterId: viewer.id, reportedId: p.id } } }) : null;
  const reportedOn = reportedRow ? fmtDate(reportedRow.createdAt) : null;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="card flex flex-wrap items-center gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-volt-300 to-sky-300 text-xl font-semibold text-ink-950">{name.charAt(0).toUpperCase()}</span>
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-2xl font-bold text-white">{name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-slate-400"><CalendarDays className="h-4 w-4" /> Tester since {fmtDate(p.createdAt)}</p>
          {mine && <p className="text-xs text-slate-500">This is how developers see your profile.</p>}
        </div>
        {mine && !off && !anySuspended(viewer) && <Link href="/app/profile" className="btn-secondary px-3 py-1.5 text-sm">Edit profile</Link>}
        {shared && <ChatWithButton contractId={shared.id} name={name} />}
      </section>
      <TesterTiles userId={p.id} />
      {/* (Owner, Oct 29, batch 13) Shown excerpts (never from a test that has an NDA now); the tester's own list, with Remove, on their own profile. */}
      {mine ? <MyExcerpts items={await myExcerpts(p.id)} /> : <ShownExcerpts items={await shownExcerpts(p.id)} />}
      <section className="card space-y-3">
        <h2 className="font-semibold text-white">About</h2>
        <p className="whitespace-pre-wrap break-words text-sm text-slate-300">{pr?.bio || <span className="text-slate-500">No bio yet.</span>}</p>
        <div className="flex flex-wrap gap-2">
          {(pr?.categories ?? []).map((c) => <span key={c} className="badge">{c}</span>)}
          {(pr?.devices ?? []).map((d) => <span key={d} className="badge"><Monitor className="h-3.5 w-3.5" /> {d}</span>)}
          {(pr?.languages ?? []).map((l) => <span key={l} className="badge"><Languages className="h-3.5 w-3.5" /> {l}</span>)}
          {!pr?.categories.length && !pr?.devices.length && <span className="text-sm text-slate-500">Interests and devices not filled in yet.</span>}
        </div>
      </section>
      {/* (Owner, Oct 28, batch 16 section 15, clarified) Only for a developer viewing the profile: their OWN tests this tester joined. Not on the tester's own view, not for admins. */}
      {viewer.isDeveloper && !mine && !isAdmin(viewer) && <TesterTests name={name} rows={await testerTestsFor(p.id, viewer.id)} />}
      {isAdmin(viewer) && !mine && <AdminPersonBoxes userId={p.id} adminId={viewer.id} developer={p.isDeveloper} tester={p.isTester} />}
      {/* (Owner, Oct 27) Block and Report live only on profiles: here, on the developer side. */}
      {viewer.isDeveloper && !mine && !off && (
        <div className="space-y-2 text-right text-xs text-slate-500">
          <ReportButton userId={p.id} name={name} reportedOn={reportedOn} />
          <BlockButton plain userId={p.id} name={name} effect="Your sessions with them end now (work they sent stays payable), calls between you are cancelled, and chat closes." />
        </div>
      )}
    </div>
  );
}
