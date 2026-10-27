"use client";
import { useState } from "react";
import { Err } from "@/components/Err";
import { api, errOf } from "@/lib/client";

/** (Owner, Oct 27) After a reinstatement the "Suspended" cards stay at the top of the dashboard until the tester rejoins or dismisses them. */
export function DismissRemoved({ contractId }: { contractId: string }) {
  const [err, setErr] = useState("");
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={async () => { setErr(""); try { await api(`/api/sessions/${contractId}/dismiss-removed`, {}); window.location.reload(); } catch (e) { setErr(errOf(e)); } }}>Dismiss</button>
      <Err text={err} />
    </span>
  );
}
