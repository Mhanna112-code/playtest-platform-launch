"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { money } from "@/lib/format";

/** What the developer owes from failed charges, with the cut-off; on hold, every test is paused until it's paid. */
export function OwedBox({ onHold, owed }: { onHold: boolean; owed: { amountCents: number; until: string | null }[] }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const total = owed.reduce((s, o) => s + o.amountCents, 0);
  const first = owed.find((o) => o.until)?.until;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
      {onHold ? (
        <p><b>Your tests are paused.</b> No new testers, invites or calls, and Pay waits, until you pay what you owe. Testers can still send work; their deadlines move on by the pause.</p>
      ) : (
        <p><b>A payment failed.</b> Pay {money(total)} by {new Date(first!).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} or your tests are paused.</p>
      )}
      {owed.length > 0 && <p>You owe {money(total)}.</p>}
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            await api("/api/payments/owed", {});
            window.location.reload();
          } catch (e) {
            setErr((e as Error).message);
            setBusy(false);
          }
        }}
      >
        Pay what you owe
      </button>
      {err && <p className="err">{err}</p>}
    </div>
  );
}
