import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePageUser } from "@/lib/server/page-auth";
import { asListing } from "@/lib/server/tests";
import { TestForm } from "../../TestForm";
import { LiveTop } from "@/components/LiveTop";

export const metadata = { title: "Edit test · Playtest" };
export const dynamic = "force-dynamic";

export default async function EditTest({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requirePageUser();
  const t = await db.test.findUnique({ where: { id } });
  if (!t || t.developerId !== u.id) notFound();
  const testersIn = await db.contract.count({ where: { testId: id, status: "working" } });
  const seenAt = new Date().toISOString();
  return (
    <>
      <p><a href={`/app/tests/${id}`}>← Back to the test</a></p>
      <LiveTop scope={`test:${id}`} seenAt={seenAt} />
      <h1 className="text-3xl font-bold tracking-tight text-white">Edit “{t.title}”</h1>
      {t.status === "stopped" ? (
        <p className="err">This test was stopped.</p>
      ) : (
        <>
          <p className="note">Edit changes the listing for new testers only. Testers already in keep the contract they joined on.</p>
          <TestForm init={asListing(t)} edit={{ id, version: t.version, testersIn, draft: t.status === "draft", seenAt }} />
        </>
      )}
    </>
  );
}
