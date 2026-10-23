import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { displayName, fmtDateTime } from "@/lib/format";
import { callStatus } from "@/lib/server/blocks";
import { roomUrl } from "@/lib/server/calls";
import { requirePageUser } from "@/lib/server/page-auth";
import { CallRoom } from "./CallRoom";
import { CallTimer } from "@/components/CallTimer";

export const metadata = { title: "Live call · Playtest" };
export const dynamic = "force-dynamic";

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requirePageUser();
  const call = await db.call.findUnique({ where: { id }, include: { slot: true, contract: { include: { test: true } } } });
  if (!call || (call.contract.testerId !== u.id && call.contract.test.developerId !== u.id)) notFound();
  const s = await callStatus(u, id);
  // The full app's call page header: "Call with Ana", then the test, the booked length and what's paid.
  const amTester = call.contract.testerId === u.id;
  const other = amTester ? await db.user.findUnique({ where: { id: call.contract.test.developerId } }) : await db.user.findUnique({ where: { id: call.contract.testerId } });
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Call with {other ? displayName(other) : "them"}</h1>
        <p className="text-sm text-slate-400">“{call.contract.title}” · {fmtDateTime(call.startsAt)} · booked for {call.minutes} minutes (paid up to {Math.floor(call.minutes * 1.5)}) · the length is measured while you&apos;re both here.</p>
      </div>
      <CallTimer startsAt={call.startsAt.toISOString()} minutes={call.minutes} role={amTester ? "tester" : "developer"} />
      <CallRoom callId={id} room={roomUrl(call, call.slot)} initialLine={s.line} initialBoth={s.bothJoinedAt ? s.bothJoinedAt.toISOString() : null} />
    </div>
  );
}
