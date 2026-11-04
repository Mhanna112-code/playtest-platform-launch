"use client";
import { useEffect, useState } from "react";
import { Err } from "@/components/Err";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { useBankCheck } from "@/components/BankCheck";
import { api, ApiError, errOf } from "@/lib/client";
import { mergeChanges } from "@/lib/live";
import { useFinished } from "@/lib/usePress";
import { type BankAction } from "@/lib/bankConfirm";
import { CANCEL_CHECK, OVER_PAY_TICK_LINE, PAY_TICK_CENTS } from "@/lib/rules";
import { ALL_BACK, CONFIRM_ALL, allConfirmedLine, allWaitingLine, confirmAllLabel } from "@/lib/confirmAllText";
import { refusalLine } from "@/lib/pressLabels";
import { useLoadTime } from "@/components/KeepLoadTime";

/** What the server says Confirm all would cover now (src/lib/server/confirmAll.ts confirmAllState). */
export type ConfirmAllProps = { ids: string[]; totalCents: number; leftOut: string | null; open: { id: string; cents: number; n: number } | null; /** (§159) the page's render time: each item's own stops count from it */ seenAt?: string };

/**
 * (Owner, Nov 3, batch 35 §147) "Confirm all (3) · $42.00" on the dashboard's "Your bank wants you to confirm" box and on Payments' confirm list, when 2 or more
 * charges wait: ONE payment for all of them, so the bank asks ONCE; its check opens inline right under the button. The press stops once (the blue box under it)
 * when the page showed other payments or another total; the second press goes ahead. A renewal keeps its own Confirm (the small line says so). While a Confirm all
 * check is open (another tab, or one left open), the box says so, with "Cancel this check".
 */
export function ConfirmAll({ ids, totalCents, leftOut, open, seenAt: rendered = "" }: ConfirmAllProps) {
  // (§176) On the dashboard: each item's stops count from its first load, never a redraw's render time (Payments: unchanged).
  const seenAt = useLoadTime(rendered);
  const bank = useBankCheck();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [changes, setChanges] = useState<Change[] | null>(null);
  // (§159) When the stop box last updated: the second press goes ahead only if nothing new happened on any item since.
  const [boxAt, setBoxAt] = useState("");
  // What the page (or the stop box) showed last: every press is checked against it.
  const [shown, setShown] = useState({ ids, totalCents });
  const key = `${ids.join(",")}:${totalCents}`;
  useEffect(() => {
    if (!changes) setShown({ ids, totalCents });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow the page's redraws (key), not the stop box's own lines
  }, [key]);
  const fin = useFinished(() => setBusy(false));
  // The label the press was made on stays while its check is open and its result shows (the page's redraw empties the list meanwhile).
  const [pressed, setPressed] = useState("");
  const label = confirmAllLabel(shown.ids.length, shown.totalCents);
  // (Owner, Nov 3) Over $200 in all: the tick "I confirm this payment is over $200." first (as Pay's); a stop that takes the total over $200 shows it.
  const over = shown.totalCents > PAY_TICK_CENTS;
  const [over200, setOver200] = useState(false);
  if (open && !bank.open && !fin.done) return <OpenCheck {...open} />;
  if (shown.ids.length < 2 && !changes && !bank.open && !fin.done && !note && !err) return null;
  async function go() {
    setBusy(true);
    setErr("");
    setNote("");
    setPressed(label);
    try {
      const r = await api<{ confirm?: BankAction; n?: number; cents?: number; already?: string; line?: string }>("/api/payments/confirm-all", { seenTotalCents: shown.totalCents, seenIds: shown.ids, confirmed: changes != null, ...(seenAt ? { seenAt } : {}), ...(changes != null && boxAt ? { boxAt } : {}), ...(over ? { over200 } : {}) });
      setChanges(null);
      if (!r.confirm) return fin.finish(r.line ?? "");
      try {
        await bank.check({ ...r.confirm, cancel: "all" }); // (§160) Cancel: nothing charged, each payment keeps waiting for the bank
      } catch (e) {
        // Nothing was charged: each payment is back to its own Confirm with your bank (the page redraws with them).
        setNote((e as Error).message.includes(ALL_BACK) ? (e as Error).message : `${(e as Error).message} ${ALL_BACK}`);
        fin.finish("");
        return;
      }
      fin.finish([allConfirmedLine(r.n ?? shown.ids.length, r.cents ?? shown.totalCents), r.already].filter(Boolean).join(" "));
    } catch (e) {
      if (e instanceof ApiError && e.code === "stop_once") {
        setChanges((c) => (c ? mergeChanges(c, (e.data.changes as Change[]) ?? []) : ((e.data.changes as Change[]) ?? [])));
        if (typeof e.data.totalCents === "number" && Array.isArray(e.data.ids)) setShown({ ids: e.data.ids as string[], totalCents: e.data.totalCents });
        if (typeof e.data.now === "string") setBoxAt(e.data.now);
      } else setErr(errOf(e));
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2" data-confirm-all="">
      <button type="button" className="btn w-full px-3 py-1.5 text-sm sm:w-auto" disabled={busy || bank.open || fin.done || shown.ids.length < 1 || (over && !over200)} onClick={go} data-confirm-all-button="">
        {(busy || bank.open || fin.done) && pressed ? pressed : label}
      </button>
      {over && !fin.done && (
        <label className="flex max-w-xs items-start gap-2 text-sm" data-over-tick="">
          <input type="checkbox" className="mt-1" data-match="^Tick “I confirm" checked={over200} onChange={(e) => setOver200(e.target.checked)} /> {OVER_PAY_TICK_LINE}
        </label>
      )}
      {leftOut && <p className="text-xs text-slate-400" data-confirm-all-left-out="">{leftOut}</p>}
      <ChangesBox changes={changes} press={CONFIRM_ALL} />
      {bank.view}
      {/* (§156) The bank's check ended without the payment: named like any refusal ("Your Pay didn't go through: Your bank didn't confirm …"). */}
      {note && <p className="info" data-bank-not-confirmed="">{refusalLine(CONFIRM_ALL, note)}</p>}
      {fin.line && <p className="ok" data-confirm-all-done="">{fin.line}</p>}
      <Err text={err} press={CONFIRM_ALL} />
    </div>
  );
}

/** The one check is open (another tab, or one left open): "Confirm all: $42.00 for 3 payments is waiting for your bank." with "Cancel this check". */
function OpenCheck({ id, cents, n }: { id: string; cents: number; n: number }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fin = useFinished(() => setBusy(false));
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-300/40 bg-sky-500/10 p-3 text-sm text-sky-100" data-confirm-all-open={id}>
      <span className="mr-auto">{allWaitingLine(n, cents)}</span>
      <button type="button" className="btn-secondary px-2 py-0.5 text-xs" disabled={busy || fin.done} data-cancel-check={id} onClick={async () => {
        setBusy(true);
        setErr("");
        try {
          const r = await api<{ line: string }>("/api/payments/confirm-all", { cancel: id });
          fin.finish(r.line);
        } catch (e) {
          setErr(errOf(e));
          setBusy(false);
        }
      }}>{CANCEL_CHECK}</button>
      {fin.line && <p className="ok basis-full">{fin.line}</p>}
      <Err text={err} press={CANCEL_CHECK} />
    </div>
  );
}
