"use client";
import { useState } from "react";
import { MessagesSquare } from "lucide-react";
import { Err } from "@/components/Err";
import { api, errOf } from "@/lib/client";

/** (Owner, Oct 26) "Chat with <name>": the same per-test chat as the Testers panel's Chat button. A refusal (a block either way, or any other reason) reads only the blue notice. */
export function ChatWithButton({ contractId, name }: { contractId: string; name: string }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <span className="block space-y-1">
      <button
        type="button"
        className="btn-secondary relative px-3 py-1 text-xs"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            const r = await api<{ href: string }>("/api/chat/open", { contractId });
            window.location.href = r.href;
          } catch (e) {
            setErr(errOf(e));
            setBusy(false);
          }
        }}
      >
        <MessagesSquare className="h-3.5 w-3.5" /> Chat with {name}
      </button>
      <Err text={err} />
    </span>
  );
}
