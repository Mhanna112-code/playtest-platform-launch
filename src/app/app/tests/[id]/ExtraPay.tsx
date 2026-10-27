"use client";
import { useMemo, useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { Err } from "@/components/Err";
import { FIELD } from "@/lib/client";
import { OVER_PAY_TICK_LINE, PAY_TICK_CENTS, PAY_TICK_LINE, PAY_WAITS } from "@/lib/rules";
import { money, toCents } from "@/lib/format";
import { usePress } from "@/lib/usePress";

/**
 * (Owner, Oct 27) Extra pay next to each SENT part (and, batch 9, each held call) in a tester's list: an amount, (batch 9) an optional note to the tester, "Paid so far for
 * this part: $X" and "up to $Y" (per piece: above the listing, or above the max for a part that isn't listed; the server refuses more). (Batch 9) Every amount needs the tick
 * that names it ("I understand this payment of $X can't be refunded and is charged now."; a changed amount unticks it), and over $200 also "I confirm this payment is over
 * $200." While a failed payment is owed Pay is disabled: "Pay what you owe first."
 */
export function ExtraPay({ testId, contractId, submissionId, callId, name, seenAt, roomCents, listed = true, paidCents, owes }: { testId: string; contractId: string; submissionId?: string; callId?: string; name: string; seenAt: string; roomCents: number; listed?: boolean; paidCents: number; owes: boolean }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [ticked, setTicked] = useState(false);
  const [over200, setOver200] = useState(false);
  const [tickErr, setTickErr] = useState("");
  const [done, setDone] = useState("");
  const { press, changes, error, busy } = usePress(seenAt);
  const payKey = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()), []);
  const cents = toCents(amount);
  const over = cents != null && cents > PAY_TICK_CENTS;
  async function go() {
    setTickErr("");
    setDone("");
    if (cents != null && cents > 0 && !ticked) return setTickErr(`${FIELD}Tick “${PAY_TICK_LINE(cents)}” to pay.`);
    if (over && !over200) return setTickErr(`${FIELD}Tick “${OVER_PAY_TICK_LINE}” to pay.`);
    const r = await press<{ amountCents: number; status?: string }>(`/api/tests/${testId}/pay-extra`, { contractId, ...(callId ? { callId } : { submissionId }), amount, note, tickedCents: ticked ? cents : null, over200: over && over200, payKey }, "extra");
    if (!r) return;
    setDone(r.status === "not_set_up" ? `Recorded ${money(r.amountCents)}: payments aren't set up yet, so nothing was charged.` : `Paid ${name} ${money(r.amountCents)} extra.`);
    setAmount("");
    setNote("");
    setTicked(false);
    setOver200(false);
    setTimeout(() => window.location.reload(), 900);
  }
  return (
    <span className="flex w-full flex-wrap items-center gap-2" data-extra-pay={submissionId ?? callId}>
      <span className="text-xs text-slate-400">Paid so far for this part: {money(paidCents)}</span>
      <span className="text-xs text-slate-400">$</span>
      <input className="input w-24 py-1 text-xs" inputMode="decimal" aria-label={`Extra pay for ${name} ($)`} placeholder="0.00" value={amount} onChange={(e) => { setAmount(e.target.value); setTicked(false); setOver200(false); setTickErr(""); }} />
      <span className="text-xs text-slate-500" data-extra-room="">up to {money(roomCents)} above the {listed ? "listing" : "max"}</span>
      <input className="input w-56 py-1 text-xs" maxLength={1000} aria-label={`Note to ${name} (optional)`} placeholder={`Note to ${name} (optional)`} value={note} onChange={(e) => setNote(e.target.value)} />
      {cents != null && cents > 0 && (
        <label className="flex max-w-xs items-start gap-1.5 text-xs text-ink-200" data-pay-tick="">
          <input type="checkbox" className="mt-0.5" checked={ticked} onChange={(e) => { setTicked(e.target.checked); setTickErr(""); }} /> {PAY_TICK_LINE(cents)}
        </label>
      )}
      {over && (
        <label className="flex max-w-xs items-start gap-1.5 text-xs text-ink-200" data-over-tick="">
          <input type="checkbox" className="mt-0.5" checked={over200} onChange={(e) => { setOver200(e.target.checked); setTickErr(""); }} /> {OVER_PAY_TICK_LINE}
        </label>
      )}
      <button className="btn-secondary px-3 py-1 text-xs" disabled={busy || cents == null || owes} onClick={go}>Pay</button>
      {owes && <span className="text-xs text-amber-200">{PAY_WAITS}</span>}
      <span className="w-full space-y-1">
        <Err text={tickErr} />
        <ChangesBox changes={changes} error={error} />
        {done && <p className="ok">{done}</p>}
      </span>
    </span>
  );
}
