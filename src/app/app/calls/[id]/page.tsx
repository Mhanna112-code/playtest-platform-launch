import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
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
  return (
    <>
      <h1>Live call · {call.contract.title}</h1>
      <p className="note">{fmtDateTime(call.startsAt)} · {call.minutes} min</p>
      <CallTimer startsAt={call.startsAt.toISOString()} minutes={call.minutes} role={call.contract.testerId === u.id ? "tester" : "developer"} />
      <CallRoom callId={id} room={roomUrl(call, call.slot)} initialLine={s.line} initialBoth={s.bothJoinedAt ? s.bothJoinedAt.toISOString() : null} />
    </>
  );
}
