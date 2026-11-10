import { ndaOnlyEdit } from "@/lib/ndaEditing";
import { NdaOnlyForm } from "../../NdaOnlyForm";
import { withDateZone } from "@/lib/server/dateZone";
import { hasPerks } from "@/lib/server/subscription";
import { openUntilCapDay, testerDaysOf } from "@/lib/rules";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireOpenPage } from "@/lib/server/page-auth";
import { asListing, countingState } from "@/lib/server/tests";
import { TestForm } from "../../TestForm";
import { LiveTop } from "@/components/LiveTop";
import { PageLoaded } from "@/components/PageLoaded";
import { AutoRefresh } from "@/components/AutoRefresh";
import { AlertsMenu } from "@/components/AlertsMenu";
import { keyBoxes } from "@/lib/server/accessKeys";
import { otherSideNotice } from "@/components/OtherSideNotice";
import { SavedNote } from "@/components/SavedNote";
import { savedNoteText, type SavedParams } from "@/lib/savedNote";

export const metadata = { title: "Edit test · Playtest" };
export const dynamic = "force-dynamic";

export default async function EditTest({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SavedParams> }) {
  const { id } = await params;
  const savedNote = savedNoteText(await searchParams);
  const u = await requireOpenPage(`/app/tests/${id}/edit`);
  return withDateZone(u.timeZone, async () => {

  const otherSide = await otherSideNotice(u); // (batch 34 §5) a page of the other side: only the switch notice
  if (otherSide) return otherSide;
  const t = await db.test.findUnique({ where: { id } });
  if (!t || t.developerId !== u.id) notFound();
  // (Owner, Oct 28 evening) A draft is edited in Post a test.
  if (t.status === "draft") redirect(`/app/tests/new?draft=${t.id}`);
  const testersIn = await db.contract.count({ where: { testId: id, status: "working" } });
  const counting = await countingState(t); // (batch 35 §66) the count runs once a tester joined
  const seenAt = new Date().toISOString();
  const ndaOnly = ndaOnlyEdit(t, u);
  return (
    <>
      <AutoRefresh query={`test=${id}`} refresh={false} />
      <p><a href={`/app/tests/${id}`}>← Back to the test</a></p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-white">Edit “{t.title}”</h1>
        <AlertsMenu testId={t.id} ignored={t.ignoredAlerts} v={t.alertsV} />
      </div>
      {/* (Owner, Nov 9, §358) A closed test opens the NDA-only editor too (ndaOnlyEdit), exactly as a stopped one. */}
      {ndaOnly ? (
        <><NdaOnlyForm id={id} version={t.version} ndaText={t.ndaText} seenAt={seenAt} /><LiveTop scope={`test:${id}`} seenAt={seenAt} contractLink={{ testId: id }} /><PageLoaded at={seenAt} /></>
      ) : (
        <>
          <p className="note">Testers already in choose to accept new terms or keep their own for prices and parts.</p>
          {/* (Owner, Nov 5, §275 revised) A Save that went through stays on Edit (a fresh load of it: the saved values, counters and "Changes left") and says
              "Saved." at the top of the form, with what else the Save did only when it did something; it fades after 8 s, or stays until × when it lists that. */}
          {savedNote && <SavedNote stay={savedNote.extras}><p className="ok" data-saved-text="">{savedNote.text}</p></SavedNote>}
          <TestForm
            init={asListing(t)}
            tz={u.timeZone}
            edit={{ id, version: t.version, testersIn, draft: t.status === "draft", seenAt, keys: await keyBoxes(id), criticalCounts: counting.counts, everJoined: !!counting.since, openedAt: t.createdAt.toISOString(), capDay: openUntilCapDay(t.createdAt, u.timeZone), testerDays: t.openUntil ? t.testerDays ?? testerDaysOf(t.createdAt, t.openUntil, u.timeZone) : undefined }}
            perks={await hasPerks(u)}
          />
          {/* (Design doc 5) Live updates from every page's rules show in a blue box under the Save button. */}
          <LiveTop scope={`test:${id}`} seenAt={seenAt} contractLink={{ testId: id }} />
          {/* (Batch 30) The seen marker starts at this page's first load in the tab. */}
          <PageLoaded at={seenAt} />
        </>
      )}
    </>
  );

  });
}
