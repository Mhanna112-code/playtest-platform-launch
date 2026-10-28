"use client";
import { Err } from "@/components/Err";
import { useEffect, useState } from "react";
import { api, ApiError, errOf } from "@/lib/client";

/**
 * Join call: opens the room, or shows why not (blue, under the button). (Owner, Oct 27) Checked live: the button disappears when the call is cancelled; checked on press: a press
 * after a cancellation shows "This call was cancelled" with the reason under Join.
 */
export function JoinCall({ callId }: { callId: string }) {
  const [err, setErr] = useState("");
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await fetch(`/api/calls/${callId}/status`, { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (alive && r && r.cancelled) setGone(true);
    };
    const t = setInterval(check, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [callId]);
  // (Batch 15 section 38) A stale Join was refused because the call was cancelled: the refusal stays, the button leaves (the row follows with the page's live update).
  if (gone) return err ? <span className="inline-flex flex-col gap-1" data-join-call="gone"><Err text={err} /></span> : null;
  return (
    <span className="inline-flex flex-col gap-1" data-join-call="">
      <button
        className="btn-ghost"
        onClick={async () => {
          setErr("");
          try {
            const r = await api<{ url: string }>(`/api/calls/${callId}/join`, {});
            window.open(r.url, "_blank");
          } catch (e) {
            setErr(errOf(e));
            if (e instanceof ApiError && e.data.cancelled === true) setGone(true);
          }
        }}
      >
        Join call
      </button>
      <Err text={err} />
    </span>
  );
}
