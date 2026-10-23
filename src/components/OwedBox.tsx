"use client";
import { Err } from "@/components/Err";
import { useState } from "react";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { api, ApiError, errOf } from "@/lib/client";
import { mergeChanges } from "@/lib/live";
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
  // What the page / the stop box showed last: every press (the second too) is checked against it.
  const [total, setTotal] = useState(seenTotal);
  const [shownIds, setShownIds] = useState(retry.map((o) => o.id));
  const first = retry.find((o) => o.until)?.until;
  return (
    <div id="owed" className="space-y-2 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100">
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
            const r = await api<{ stillFailing: string[]; lifted: boolean }>("/api/payments/owed", { seenTotalCents: total, seenIds: shownIds, confirmed: changes != null });
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
              setChanges((c) => (c ? mergeChanges(c, e.data.changes as Change[]) : (e.data.changes as Change[])));
              if (typeof e.data.totalCents === "number") setTotal(e.data.totalCents);
              if (Array.isArray(e.data.ids)) setShownIds(e.data.ids as string[]);
            } else setErr(errOf(e));
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
      <Err text={err} />
    </div>
  );
}
