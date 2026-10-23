import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/server/page-auth";
import { TestForm } from "../TestForm";
import { testerCapacity } from "@/lib/server/capacity";

export const metadata = { title: "Post a test · Playtest" };

export default async function NewTest() {
  const u = await requirePageUser();
  if (!u.isDeveloper) redirect("/app/profile");
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-white">Post a test</h1>
      <TestForm
        spotsLimit={(await testerCapacity(u.id)).limit}
        init={{ title: "", description: "", buildUrl: "", categories: ["Productivity"], devices: [], languages: [], spots: 5, writtenCents: 1000, recordingCents: null, liveRateCents: null, liveMinutes: 30, deadlineDays: 7, questions: [], openUntil: null, joinMode: "anyone" }}
      />
    </>
  );
}
