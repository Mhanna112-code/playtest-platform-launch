"use client";
import { Err } from "@/components/Err";
import { useState } from "react";
import { api, errOf } from "@/lib/client";

/** Join call: opens the room, or shows why not (blue, under the button). */
export function JoinCall({ callId }: { callId: string }) {
  const [err, setErr] = useState("");
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        className="btn-ghost"
        onClick={async () => {
          setErr("");
          try {
            const r = await api<{ url: string }>(`/api/calls/${callId}/join`, {});
            window.open(r.url, "_blank");
          } catch (e) {
            setErr(errOf(e));
          }
        }}
      >
        Join call
      </button>
      <Err text={err} />
    </span>
  );
}
