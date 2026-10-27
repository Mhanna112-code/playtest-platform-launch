import { hasPerks } from "@/lib/server/subscription";
import { countsOf } from "@/lib/limits";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireOpenDevPage } from "@/lib/server/page-auth";
import { asListing } from "@/lib/server/tests";
import { TestForm } from "../../TestForm";
import { testerCapacity } from "@/lib/server/capacity";
import { LiveTop } from "@/components/LiveTop";
import { AutoRefresh } from "@/components/AutoRefresh";
import { AlertsMenu } from "@/components/AlertsMenu";
import { keyBoxes } from "@/lib/server/accessKeys";

export const metadata = { title: "Edit test · Playtest" };
export const dynamic = "force-dynamic";

export default async function EditTest({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireOpenDevPage();
  const t = await db.test.findUnique({ where: { id } });
  if (!t || t.developerId !== u.id) notFound();
  // (Owner, Oct 28 evening) A draft is edited in Post a test.
  if (t.status === "draft") redirect(`/app/tests/new?draft=${t.id}`);
  const testersIn = await db.contract.count({ where: { testId: id, status: "working" } });
  const seenAt = new Date().toISOString();
  return (
    <>
      <AutoRefresh query={`test=${id}`} refresh={false} />
      <p><a href={`/app/tests/${id}`}>← Back to the test</a></p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-white">Edit “{t.title}”</h1>
        <AlertsMenu ignored={u.ignoredAlerts} />
      </div>
      {t.status === "stopped" ? (
        <p className="err-field" role="alert" data-stopped="">This test was stopped.</p>
      ) : (
        <>
          <p className="note">Edit changes the listing for new testers only. Testers already in keep the contract they joined on.</p>
          <TestForm
            init={asListing(t)}
            edit={{ id, version: t.version, testersIn, draft: t.status === "draft", seenAt, keys: await keyBoxes(id), criticalCounts: countsOf(t.criticalCounts), everJoined: (await db.contract.count({ where: { testId: id } })) > 0, openedAt: t.createdAt.toISOString() }}
            spotsLimit={(await testerCapacity(u.id)).limit}
            perks={await hasPerks(u)}
          />
          {/* (Design doc 5) Live updates from every page's rules show in a blue box under the Save button. */}
          <LiveTop scope={`test:${id}`} seenAt={seenAt} contractLink={{ testId: id }} />
        </>
      )}
    </>
  );
}
