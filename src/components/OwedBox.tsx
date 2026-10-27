"use client";
import { Err } from "@/components/Err";
import { useState } from "react";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { api, ApiError, errOf } from "@/lib/client";
import { mergeChanges } from "@/lib/live";
import { money } from "@/lib/format";
import { confirmWithBank, type BankAction } from "@/lib/bankConfirm";

type Line = { id: string; retry: boolean; amountCents: number; until: string | null; text: string };

/**
 * (Owner, Oct 27) Failed payments (each listed) and reversed payments (a chargeback adds its amount); one button pays them all. It stops once if the total
 * changed since the page loaded; the second press pays at once, with the result right under the button.
 * (Owner, Oct 29, batch 10) The page polls (AutoRefresh): the amount and the lines follow `owed` live, and the page drops the box when nothing is owed. A press
 * still checks what was last confirmed (the page load or the last stop box), so a press after a change stops once with the new lines.
 */
export function OwedBox({ onHold, owed, chargeback = false, review = false, retryLine = "" }: { onHold: boolean; owed: Line[]; chargeback?: boolean; review?: boolean; /** (Batch 11) "Last try: ... · next try: ..." of the automatic retries */ retryLine?: string }) {
  const [err, setErr] = useState("");
  const [failing, setFailing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [done, setDone] = useState("");
  const [bankNote, setBankNote] = useState("");
  const retry = owed.filter((o) => o.retry);
  const seenTotal = retry.reduce((s, o) => s + o.amountCents, 0);
  // What the page / the stop box showed last: every press (the second too) is checked against it.
  const [total, setTotal] = useState(seenTotal);
  const [shownIds, setShownIds] = useState(retry.map((o) => o.id));
  return (
    <div id="owed" className="space-y-2 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100">
      {onHold && chargeback ? (
        <p><b>Your tests are paused.</b> No new testers, invites or calls, and Pay waits. Testers can&apos;t send work until then (they can still charge for work you haven&apos;t reviewed: it&apos;s added to what you owe); their deadlines move on by the pause.</p>
      ) : onHold ? (
        <p><b>Your tests are paused.</b> No new testers, invites or calls, and Pay waits, until you pay what you owe. Testers can&apos;t send work until then (they can still charge for work you haven&apos;t reviewed: it&apos;s added to what you owe); their deadlines move on by the pause.</p>
      ) : (
        <p><b>A payment failed.</b> Pay {money(seenTotal)} to keep your tests running.</p>
      )}
      {retryLine && <p className="text-xs" data-retry-line="">{retryLine}</p>}
      {onHold && review && <p data-hold-review="">After you pay what you owe, the team will review your account before your tests resume.</p>}
      {owed.length > 0 && (
        <ul className="list-disc pl-5">
          {owed.map((o) => <li key={o.id}>{o.text}</li>)}
        </ul>
      )}
      {(!chargeback || retry.length > 0) && <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          setFailing([]);
          try {
            const r = await api<{ stillFailing: string[]; lifted: boolean; confirm?: BankAction[] }>("/api/payments/owed", { seenTotalCents: total, seenIds: shownIds, confirmed: changes != null });
            setChanges(null);
            // (Batch 11) Payments the bank wants confirmed: one pop-up each; any it refused stay owed (nothing was charged for them).
            let refused = "";
            for (const a of r.confirm ?? []) {
              try { await confirmWithBank(a); } catch (e) { refused = (e as Error).message; }
            }
            if (refused) {
              setBankNote(refused);
              setBusy(false);
              return;
            }
            if (r.stillFailing.length) {
              setFailing(r.stillFailing);
              setBusy(false);
            } else {
              setDone(`Paid ${money(total)}, thank you`);
              setTimeout(() => window.location.reload(), 1500);
            }
          } catch (e) {
            if (e instanceof ApiError && e.code === "nothing_owed") {
              // Paid meanwhile (another tab): nothing is charged; the page reloads without the box.
              setErr(errOf(e));
              setTimeout(() => window.location.reload(), 1500);
            } else if (e instanceof ApiError && e.code === "stop_once") {
              setChanges((c) => (c ? mergeChanges(c, e.data.changes as Change[]) : (e.data.changes as Change[])));
              if (typeof e.data.totalCents === "number") setTotal(e.data.totalCents);
              if (Array.isArray(e.data.ids)) setShownIds(e.data.ids as string[]);
            } else setErr(errOf(e));
            setBusy(false);
          }
        }}
      >
        Pay what you owe ({money(changes ? total : seenTotal)})
      </button>}
      <ChangesBox changes={changes} />
      {bankNote && <p className="info" data-bank-not-confirmed="">{bankNote}</p>}
      {done && <p className="ok">{done}</p>}
      {failing.length > 0 && (
        <p className="err">
          Still declined: {failing.join("; ")}. Your tests stay paused until everything is paid. <a href="/app/payments#card">Update your card</a> and try again.
        </p>
      )}
      {chargeback && <p>Paying what you owe is only one of the steps above: your tests resume once the card is verified, what you owe is paid and the team approves.</p>}
      <Err text={err} />
    </div>
  );
}
