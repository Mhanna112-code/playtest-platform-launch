"use client";
import { useState } from "react";
import { api, ApiError, errOf } from "@/lib/client";
import { Err } from "@/components/Err";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { mergeChanges } from "@/lib/live";

/**
 * Switch to a side you have, or add the other side to the account (the full app's account switch). (Owner, Oct 28, batch 16 section 27) Settings changed in
 * another tab or device since the page opened: the first press stops once with what changed; the second goes ahead.
 */
export function SideButton({ side, add, seenAt: seen0, children }: { side: "developer" | "tester"; add: boolean; seenAt?: string; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [seenAt] = useState(seen0 ?? "");
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [boxAt, setBoxAt] = useState("");
  return (
    <div className="space-y-1">
      <button
        className="btn-secondary px-3 py-1.5 text-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            await api("/api/account/side", { side, add, ...(seenAt ? { seenAt, confirmed: changes != null, ...(changes != null && boxAt ? { boxAt } : {}) } : {}) });
            window.location.href = add && side === "tester" ? "/app/profile" : add ? "/app/account" : "/app";
          } catch (e) {
            if (e instanceof ApiError && e.code === "stop_once") {
              setChanges((c) => (c ? mergeChanges(c, (e.data.changes as Change[]) ?? []) : ((e.data.changes as Change[]) ?? [])));
              if (typeof e.data.now === "string") setBoxAt(e.data.now);
            } else setErr(errOf(e));
            setBusy(false);
          }
        }}
      >
        {children}
      </button>
      <ChangesBox changes={changes} />
      <Err text={err} />
    </div>
  );
}
