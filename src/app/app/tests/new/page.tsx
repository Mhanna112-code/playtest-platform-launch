import { withDateZone } from "@/lib/server/dateZone";
import { hasPerks } from "@/lib/server/subscription";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { asListing } from "@/lib/server/tests";
import { testTitleOf } from "@/lib/rules";
import { requireOpenDevPage } from "@/lib/server/page-auth";
import { needsTermsAgain } from "@/lib/termsOfUse";
import { TestForm } from "../TestForm";
import { otherSideNotice } from "@/components/OtherSideNotice";

export const metadata = { title: "Post a test · Playtest" };

export const dynamic = "force-dynamic";

/** Post a test. (Owner, Oct 28 evening) ?draft=<id>: a draft (a next round not opened yet) opens here, filled in with its saved details. */
export default async function NewTest({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const u = await requireOpenDevPage();
  return withDateZone(u.timeZone, async () => {

  const otherSide = await otherSideNotice(u); // (batch 34 §5) a page of the other side: only the switch notice
  if (otherSide) return otherSide;
  if (!u.isDeveloper) redirect("/app/profile");
  const { draft: draftId } = await searchParams;
  const draft = draftId ? await db.test.findUnique({ where: { id: draftId } }) : null;
  if (draftId && (!draft || draft.developerId !== u.id)) notFound();
  if (draft && draft.status !== "draft") redirect(`/app/tests/${draft.id}`);
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-white">Post a test</h1>
      {/* (Owner, Nov 3, batch 35 §168) A Next round's draft has no name yet: "A draft: Untitled draft (round 2). Give it a name, check the details, …". */}
      {draft && <p className="note" data-draft-note="">A draft: {testTitleOf(draft)}. {draft.title.trim() ? "Check the details" : "Give it a name, check the details"}, then press Post the test to open it for testers.</p>}
      <TestForm
        draft={draft ? { id: draft.id } : undefined}
        hasCard={!!u.stripePaymentMethodId}
        tz={u.timeZone}
        perks={await hasPerks(u)}
        termsAgain={needsTermsAgain(u)}
        init={draft ? asListing(draft) : { productName: "", mature: false, matureWhy: "", ndaText: "", title: "", description: "", buildUrl: "", categories: ["Productivity"], devices: [], languages: [], spots: 5, writtenCents: 1000, recordingCents: null, liveRateCents: null, liveMinutes: 30, deadlineDays: 7, questions: [], openUntil: null, joinMode: "anyone" }}
      />
    </>
  );

  });
}
