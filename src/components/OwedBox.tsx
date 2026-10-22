"use client";
import { useState } from "react";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { api, ApiError } from "@/lib/client";
import { money } from "@/lib/format";

type Line = { id: string; retry: boolean; amountCents: number; until: string | null; text: string };

/**
 * Failed payments (each listed) and reversed payments; one button retries every failed one. It stops once if the total
 * changed since the page loaded; the second press pays at once, with the result right under the button.
 */
export function OwedBox({ onHold, owed }: { onHold: boolean; owed: Line[] }) {
  const [err, setErr] = useState("");
  const [failing, setFailing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [done, setDone] = useState("");
  const retry = owed.filter((o) => o.retry);
  const seenTotal = retry.reduce((s, o) => s + o.amountCents, 0);
  const [total, setTotal] = useState(seenTotal);
  const first = retry.find((o) => o.until)?.until;
  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      {onHold ? (
        <p><b>Your tests are paused.</b> No new testers, invites or calls, and Pay waits, until you pay what you owe. Testers can still send work; their deadlines move on by the pause.</p>
      ) : (
        first && <p><b>A payment failed.</b> Pay {money(seenTotal)} by {new Date(first).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} or your tests are paused.</p>
      )}
      {owed.length > 0 && (
        <ul className="list-disc pl-5">
          {owed.map((o) => <li key={o.id}>{o.text}</li>)}
        </ul>
      )}
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          setFailing([]);
          try {
            const r = await api<{ stillFailing: string[]; lifted: boolean }>("/api/payments/owed", { seenTotalCents: seenTotal, seenIds: retry.map((o) => o.id), confirmed: changes != null });
            setChanges(null);
            if (r.stillFailing.length) {
              setFailing(r.stillFailing);
              setBusy(false);
            } else {
              setDone(`Paid ${money(total)}, thank you`);
              setTimeout(() => window.location.reload(), 1500);
            }
          } catch (e) {
            if (e instanceof ApiError && e.code === "stop_once") {
              setChanges(e.data.changes as Change[]);
              if (typeof e.data.totalCents === "number") setTotal(e.data.totalCents);
            } else setErr((e as Error).message);
            setBusy(false);
          }
        }}
      >
        Pay what you owe ({money(total)})
      </button>
      <ChangesBox changes={changes} />
      {done && <p className="ok">{done}</p>}
      {failing.length > 0 && (
        <p className="err">
          Still declined: {failing.join("; ")}. Your tests stay paused until everything is paid. <a href="/app/payments">Update your card</a> and try again.
        </p>
      )}
      {owed.some((o) => !o.retry) && <p>Reversed payments can&apos;t be retried here: our team resolves them, then your tests resume.</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
