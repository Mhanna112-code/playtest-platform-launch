import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { displayName, fmtDateTime } from "@/lib/format";
import { callStatus } from "@/lib/server/blocks";
import { callCheckUrl, onCallNow, roomUrl } from "@/lib/server/calls";
import { adminAway, leaveIfClosed, requireOpenPage, requirePageUser } from "@/lib/server/page-auth";
import { CallRoom } from "./CallRoom";
import { CallTimer } from "@/components/CallTimer";
import { JITSI_HOST_DEV_LINE, JOIN_OPENS_MIN, jitsiWaitingLine } from "@/lib/rules";

export const metadata = { title: "Live call · Playtest" };
export const dynamic = "force-dynamic";

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // (Owner, Oct 28) Closed to a restricted account (it moves to the dashboard top); with both sides and only a hold, the role in this call decides.
  const u = await requirePageUser();
  adminAway(u, "/app/calls"); // (batch 20 section 16) admin only
  const call = await db.call.findUnique({ where: { id }, include: { contract: { include: { test: true } } } });
  if (!call || (call.contract.testerId !== u.id && call.contract.test.developerId !== u.id)) notFound();
  // (Batch 18 section 9) Someone still on the call (a reload within the 5-minute gap) keeps the page even if their account was paused meanwhile.
  if (!(await onCallNow(call.id, u.id))) {
    await requireOpenPage("/app/calls");
    leaveIfClosed(u, "/app/calls", call.contract.test.developerId === u.id ? "developer" : "tester");
  }
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
      <CallRoom callId={id} room={roomUrl(call)} initialLine={s.line} initialBoth={s.bothJoinedAt ? s.bothJoinedAt.toISOString() : null} initialCapLine={s.capLine} opensAt={new Date(call.startsAt.getTime() - JOIN_OPENS_MIN * 60_000).toISOString()} checkUrl={await callCheckUrl(u.id)} hostLine={amTester ? jitsiWaitingLine(other ? displayName(other) : "the developer") : JITSI_HOST_DEV_LINE} />
    </div>
  );
}
