"use client";
import { useState } from "react";
import { checkFields } from "@/components/FieldChecks";
import { PressButton } from "@/components/PressButton";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * "How long was the call?" (the full app's length entry, live-slots.tsx there), lean rules: the developer enters it, up to
 * 150% of the booked length, until 24 hours after the start (then the booked length is used); "measured" is from both
 * join times to the booked end; a reason when shorter than booked (the tester reads it). It sets the Pay box reference.
 */
export function CallLength({ testId, callId, minutes, booked, measured, max, closesAt, closed, tester, entered, note, seenAt }: {
  testId: string; callId: string; minutes: number; booked: number; measured: number | null; max: number; closesAt: string; closed: boolean;
  tester: string; entered: number | null; note: string; seenAt: string;
}) {
  const [v, setV] = useState(String(minutes));
  const [why, setWhy] = useState(note);
  if (closed) {
    return (
      <p className="text-xs text-slate-400">
        {entered != null ? `You entered ${entered} min${entered !== booked ? ` (booked ${booked})` : ""}${note ? `: “${note}”` : ""}. ` : ""}
        The 24 hours to enter the length ended on {when(closesAt)}{entered == null ? `: the booked ${booked} min is used.` : "."}
      </p>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 text-sm">
      <label className="text-amber-200" htmlFor={`len-${callId}`}>How long was the call?<span className="text-punch-400"> *</span></label>
      <input id={`len-${callId}`} className="input w-20 py-1 text-xs" inputMode="numeric" aria-label="Call length in minutes" data-min="1" data-max={String(max)} data-whole="" data-msg={`You can log up to ${max} min for this ${booked}-min call.`} value={v} onChange={(e) => setV(e.target.value)} />
      <span className="text-xs text-slate-400">
        min (booked {booked}{measured != null ? <>, <span className="text-sky-200" title="From when you had both joined to the booked end">measured {measured} min</span></> : null})
      </span>
      <input className="input w-64 py-1 text-xs" maxLength={500} placeholder={`Why, if shorter than ${booked} min (${tester} reads it)`} aria-label="Why, if shorter" value={why} onChange={(e) => setWhy(e.target.value)} />
      <PressButton seenAt={seenAt} before={() => checkFields(document.getElementById(`len-${callId}`)?.parentElement ?? null)} className="btn px-3 py-1 text-xs" path={`/api/tests/${testId}/call-length`} body={{ callId, minutes: Number(v), note: why }}>Enter the length</PressButton>
      <span className="w-full text-xs text-slate-500">
        You can log up to {max} min for this {booked}-min call. Enter it by {when(closesAt)} (24 h after the start): after that, the booked length is used.
      </span>
    </div>
  );
}
