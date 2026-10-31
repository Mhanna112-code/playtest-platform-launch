import { db } from "@/lib/db";
import { displayName, fmtDateTime } from "@/lib/format";
import { callStatus } from "@/lib/server/blocks";
import { iceServers } from "@/lib/server/calls";
import { adminAway, leaveIfClosed, requireOpenPage, requirePageUser } from "@/lib/server/page-auth";
import { CALL_NOT_AVAILABLE } from "@/lib/callMeasure";
import { JOIN_OPENS_MIN } from "@/lib/rules";
import { CallRoom } from "./CallRoom";
import { otherSideNotice } from "@/components/OtherSideNotice";

export const metadata = { title: "Live call · Playtest" };
export const dynamic = "force-dynamic";

/** (Batch 21) A live call held in the app, between the booked tester and the test's developer (the full app's call page). */
export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requirePageUser();
  adminAway(u, "/app/calls"); // (batch 20 section 16) admin only
  const call = await db.call.findUnique({ where: { id }, include: { contract: { include: { test: true } } } });
  // (Batch 21 section 1) Anyone but the call's two people: "This call isn't available."
  if (!call || (call.contract.testerId !== u.id && call.contract.test.developerId !== u.id))
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-white">Live call</h1>
        <p className="info" data-call-line="">{CALL_NOT_AVAILABLE}</p>
      </div>
    );
  const amTester = call.contract.testerId === u.id;
  // (Batch 34 §5) A call of the account's other side (its role in this test): only the switch notice.
  const otherSide = await otherSideNotice(u, amTester ? "tester" : "developer");
  if (otherSide) return otherSide;
  // (Owner, Oct 28) Closed to a restricted account (it moves to the dashboard top); with both sides and only a hold, the role in this call decides.
  await requireOpenPage("/app/calls");
  leaveIfClosed(u, "/app/calls", amTester ? "tester" : "developer");
  const s = await callStatus(u, id);
  // The full app's call page header: "Call with Ana", then the test, the booked length and what's paid.
  const other = await db.user.findUnique({ where: { id: amTester ? call.contract.test.developerId : call.contract.testerId } });
  const otherName = other ? displayName(other) : "them";
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Call with {otherName}</h1>
        <p className="text-sm text-slate-400">“{call.contract.title}” · {fmtDateTime(call.startsAt)} · booked for {call.minutes} minutes (paid up to {Math.floor(call.minutes * 1.5)}) · the length is measured while you&apos;re both connected.</p>
      </div>
      <CallRoom
        callId={id}
        role={amTester ? "tester" : "developer"}
        myName={displayName(u)}
        otherName={otherName}
        iceServers={iceServers()}
        initialLine={s.line}
        opensAt={new Date(call.startsAt.getTime() - JOIN_OPENS_MIN * 60_000).toISOString()}
        back={amTester ? `/app/sessions/${call.contractId}#call-${call.id}` : `/app/tests/${call.contract.testId}#call-${call.id}`}
      />
    </div>
  );
}
