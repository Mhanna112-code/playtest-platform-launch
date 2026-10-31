"use client";
import { useFinished } from "@/lib/usePress";
import { useState } from "react";
import { Err } from "@/components/Err";
import { api, errOf } from "@/lib/client";

/** (Owner, Oct 28) After a reinstatement the "You were removed from this test" cards stay at the top of the dashboard until the tester asks to rejoin or dismisses them. */
export function DismissRemoved({ contractId }: { contractId: string }) {
  const [err, setErr] = useState("");
  const fin = useFinished(); // (batch 35 §40, §41) the dashboard redraws in place (the card goes); Dismiss stays greyed until it has
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className="btn-ghost px-3 py-1.5 text-sm" disabled={fin.done} onClick={async () => { setErr(""); try { await api(`/api/sessions/${contractId}/dismiss-removed`, {}); fin.finish(); } catch (e) { setErr(errOf(e)); } }}>Dismiss</button>
      <Err text={err} />
    </span>
  );
}
