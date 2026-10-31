import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, CalendarClock } from "lucide-react";
import { db } from "@/lib/db";
import { displayName, fmtDate } from "@/lib/format";
import { termsLine } from "@/lib/rules";
import { requireOpenPage } from "@/lib/server/page-auth";
import { DeveloperTiles } from "@/components/ProfileTiles";
import { BlockButton, UnblockButton } from "@/components/BlockButton";
import { blockedTestsLine, ProfileUnavailable } from "@/components/ProfileUnavailable";
import { ScrollList } from "@/components/ScrollList";
import { ReportButton } from "@/components/ReportButton";
import { AdminPersonBoxes, AdminTestBoxes } from "@/app/admin/AdminBoxes";
import { isAdmin } from "@/lib/server/session";
import { anySuspended, devRestricted } from "@/lib/restricted";
import { sideFor } from "@/lib/sides";
import { openTestsV, profileOpenTests } from "@/lib/server/profileOpenTests";
import { AutoRefresh } from "@/components/AutoRefresh";
import { otherSideNotice } from "@/components/OtherSideNotice";


export const metadata = { title: "Developer · Playtest" };
export const dynamic = "force-dynamic";

/**
 * A developer's profile as testers see it (the full app's developer page): who they are, how they review (the tiles and
 * what each counts), and their open tests. Not shown between people who blocked each other.
 */
export default async function DeveloperProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireOpenPage("/app/developers"); // (Owner, Oct 28) closed to a restricted account: it moves to the dashboard top before anything renders
  const otherSide = await otherSideNotice(viewer); // (batch 34 §5) a page of the other side: only the switch notice
  if (otherSide) return otherSide;
  const p = await db.user.findUnique({ where: { id } });
  if (!p || !p.isDeveloper) notFound();
  const mine = viewer.id === p.id;
  // (Owner, Oct 28, batch 20 section 17) They blocked you: a plain "This profile isn't available." (never says why). You blocked them: their profile as usual, with
  // Unblock where Block was, no Chat with or invite, and their Open tests hidden with a line.
  const theyBlocked = !mine && !isAdmin(viewer) && (await db.block.count({ where: { blockerId: p.id, blockedId: viewer.id } })) > 0;
  if (theyBlocked) return <ProfileUnavailable />;
  const iBlocked = !mine && !isAdmin(viewer) && (await db.block.count({ where: { blockerId: viewer.id, blockedId: p.id } })) > 0;
  // (Owner, Oct 27) Paused tests (a hold, a suspension or the team's pause) are not listed for other people; a suspended tester can't open any, and a restricted developer's own pages are closed.
  const devOff = mine && p.isDeveloper && devRestricted(viewer, sideFor(viewer, "/app/developers"));
  // (Batch 16 section 14) Invite-only tests are listed only for people invited to, applying to or in them (as in Find).
  const open = iBlocked ? [] : await profileOpenTests(p, viewer, isAdmin(viewer));
  const name = displayName(p);
  const reportedRow = !mine ? await db.report.findUnique({ where: { reporterId_reportedId: { reporterId: viewer.id, reportedId: p.id } } }) : null;
  const reportedOn = reportedRow ? fmtDate(reportedRow.createdAt) : null;
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
          {mine && !devOff && !anySuspended(viewer) && <Link href="/app/profile" className="btn-secondary px-3 py-1.5 text-sm">Edit profile</Link>}
        </div>
        {mine && <p className="text-xs text-slate-500">This is how testers see your profile.</p>}
      </section>
      <DeveloperTiles userId={p.id} />
      <section className="card space-y-3">
        <h2 className="font-semibold text-white">Open tests</h2>
        {/* (Owner, Oct 28, batch 17 section 9) Seen by someone else, the list stays current on the page's poll (and when shown again with Back). */}
        {!mine && !isAdmin(viewer) && !iBlocked && <AutoRefresh query={`profile=${p.id}`} v={openTestsV(open)} />}
        {iBlocked && <p className="text-sm text-slate-400" data-blocked-tests="">{blockedTestsLine(name)}</p>}
        {/* (Owner, Oct 28, batch 16 section 14) Every open test, in a plain scroll box (no "Show N more"). */}
        {iBlocked ? null : open.length === 0 ? <p className="text-sm text-slate-400">No open tests right now.</p> : (
          <ScrollList className="space-y-2">
            {open.map((t) => (
              <li key={t.id}>
                {(devOff || (!mine && viewer.testerSuspendedAt)) ? <div className="flex items-center gap-3 rounded-xl border border-white/10 p-3 text-ink-100"><span className="min-w-0 flex-1"><span className="block truncate font-medium text-white" title={t.title}>{t.title}</span></span></div> : <Link href={mine ? `/app/tests/${t.id}` : isAdmin(viewer) ? `/app/find/${t.id}` : t.sessionId ? `/app/sessions/${t.sessionId}` : `/app/find/${t.id}?from=profile`} className="flex items-center gap-3 rounded-xl border border-white/10 p-3 text-ink-100 no-underline hover:bg-white/[0.04] hover:no-underline">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-white">{t.title}</span>
                    <span className="flex items-start gap-1.5 text-xs text-slate-400">
                      <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{termsLine(t, !mine)} · {Math.max(0, t.spots - t.contracts.length)} of {t.spots} spots left</span>
                    </span>
                    {/* (Batch 20 section 6) A test the viewer is part of: working in it (opens their session), an open invite to a full test, a pending application. */}
                    {t.viewerLine && <span className="badge mt-1" data-profile-viewer={t.viewer ?? ""}>{t.viewerLine}</span>}
                  </span>
                </Link>}
              </li>
            ))}
          </ScrollList>
        )}
      </section>
      {isAdmin(viewer) && !mine && <AdminPersonBoxes userId={p.id} adminId={viewer.id} developer={p.isDeveloper} tester={p.isTester} />}
      {/* Block the developer, as in the full app: a small link at the bottom of their profile (testers only). */}
      {viewer.isTester && !mine && !viewer.testerSuspendedAt && (
        <div className="space-y-2 text-right text-xs text-slate-500">
          <ReportButton userId={p.id} name={name} reportedOn={reportedOn} />
          {/* (Batch 20 section 17) Blocked: Unblock where Block was (no confirm). */}
          {iBlocked ? <UnblockButton say userId={p.id} name={name} /> : <BlockButton plain userId={p.id} name={name} effect="Your sessions on their tests end now (work you sent stays payable, and you can still charge, dispute and rate it), calls between you are cancelled, your applications and invites close, and chat closes. You won't see their other tests any more." />}
        </div>
      )}
    </div>
  );
}
