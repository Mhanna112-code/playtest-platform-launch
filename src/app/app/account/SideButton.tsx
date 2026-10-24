"use client";
import { useState } from "react";
import { api, errOf } from "@/lib/client";
import { Err } from "@/components/Err";

/** Switch to a side you have, or add the other side to the account (the full app's account switch). */
export function SideButton({ side, add, children }: { side: "developer" | "tester"; add: boolean; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="space-y-1">
      <button
        className="btn-secondary px-3 py-1.5 text-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            await api("/api/account/side", { side, add });
            window.location.href = add && side === "tester" ? "/app/profile?welcome=tester" : add ? "/app/account" : "/app";
          } catch (e) {
            setErr(errOf(e));
            setBusy(false);
          }
        }}
      >
        {children}
      </button>
      <Err text={err} />
    </div>
  );
}
