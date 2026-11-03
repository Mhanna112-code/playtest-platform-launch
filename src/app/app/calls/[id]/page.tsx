import { withDateZone } from "@/lib/server/dateZone";
import { fmtDateTimeIn } from "@/lib/format";
import { db } from "@/lib/db";
import { displayName } from "@/lib/server/dateFormat";
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
export default async function CallPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ relay?: string }> }) {
  // (Owner, Nov 2) `?relay=1`: the call goes only through the TURN relay, as on a strict network, to check the relay works (on the live site too).
  const relayOnly = (await searchParams)?.relay === "1";
  const { id } = await params;
  const u = await requirePageUser();
  return withDateZone(u.timeZone, async () => {

  const fmtDateTime = (d: Date | string) => fmtDateTimeIn(d, u.timeZone);
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
        <p className="text-sm text-slate-400">{/* (Owner, Nov 2) the test opens in a new tab, so the call keeps going here */}<a href={amTester ? `/app/sessions/${call.contractId}` : `/app/tests/${call.contract.testId}`} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-white" data-call-test-link="">“{call.contract.title}”</a> · {fmtDateTime(call.startsAt)} · booked for {call.minutes} minutes (paid up to {Math.floor(call.minutes * 1.5)}) · the length is measured while you&apos;re both connected.</p>
      </div>
      {relayOnly && <p className="info" data-relay-only="">{process.env.TURN_URL ? "Relay-only check: this call goes only through the TURN relay, as it would on a strict network. If it connects, the relay works." : "Relay-only check: no TURN relay is set up (TURN_URL), so this call can't connect this way."}</p>}
      <CallRoom
        callId={id}
        role={amTester ? "tester" : "developer"}
        myName={displayName(u)}
        otherName={otherName}
        iceServers={iceServers()}
        relayOnly={relayOnly}
        initialLine={s.line}
        opensAt={new Date(call.startsAt.getTime() - JOIN_OPENS_MIN * 60_000).toISOString()}
        back={amTester ? `/app/sessions/${call.contractId}#call-${call.id}` : `/app/tests/${call.contract.testId}#call-${call.id}`}
      />
    </div>
  );

  });
}
