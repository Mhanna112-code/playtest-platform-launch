"use client";
import { useMemo, useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { Err } from "@/components/Err";
import { FIELD } from "@/lib/client";
import { PAY_TICK_CENTS, PAY_TICK_LINE, PAY_WAITS } from "@/lib/rules";
import { money, toCents } from "@/lib/format";
import { usePress } from "@/lib/usePress";

/**
 * (Owner, Oct 27) Extra pay next to each SENT part in a tester's list (current and past testers): an amount box and Pay, with "Paid so far for this part: $X" and
 * "up to $Y" (everything paid above the listing prices is capped; the server refuses more). Over $200 the tick appears: "I understand this payment can't be refunded
 * and is charged now."; Pay is refused until it is ticked (red at the tick). While a failed payment is owed Pay is disabled: "Pay what you owe first."
 */
export function ExtraPay({ testId, contractId, submissionId, name, seenAt, roomCents, paidCents, owes }: { testId: string; contractId: string; submissionId: string; name: string; seenAt: string; roomCents: number; paidCents: number; owes: boolean }) {
  const [amount, setAmount] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [tickErr, setTickErr] = useState("");
  const [done, setDone] = useState("");
  const { press, changes, error, busy } = usePress(seenAt);
  const payKey = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()), []);
  const cents = toCents(amount);
  const needsTick = cents != null && cents > PAY_TICK_CENTS;
  async function go() {
    setTickErr("");
    setDone("");
    if (needsTick && !understood) return setTickErr(`${FIELD}Tick “${PAY_TICK_LINE}” to pay.`);
    const r = await press<{ amountCents: number; status?: string }>(`/api/tests/${testId}/pay-extra`, { contractId, submissionId, amount, understood: needsTick && understood, payKey }, "extra");
    if (!r) return;
    setDone(r.status === "not_set_up" ? `Recorded ${money(r.amountCents)}: payments aren't set up yet, so nothing was charged.` : `Paid ${name} ${money(r.amountCents)} extra.`);
    setAmount("");
    setUnderstood(false);
    setTimeout(() => window.location.reload(), 900);
  }
  return (
    <span className="flex w-full flex-wrap items-center gap-2" data-extra-pay={submissionId}>
      <span className="text-xs text-slate-400">Paid so far for this part: {money(paidCents)}</span>
      <span className="text-xs text-slate-400">$</span>
      <input className="input w-24 py-1 text-xs" inputMode="decimal" aria-label={`Extra pay for ${name} ($)`} placeholder="0.00" value={amount} onChange={(e) => { setAmount(e.target.value); setUnderstood(false); setTickErr(""); }} />
      <span className="text-xs text-slate-500" data-extra-room="">up to {money(roomCents)}</span>
      {needsTick && (
        <label className="flex max-w-xs items-start gap-1.5 text-xs text-ink-200">
          <input type="checkbox" className="mt-0.5" checked={understood} onChange={(e) => { setUnderstood(e.target.checked); setTickErr(""); }} /> {PAY_TICK_LINE}
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
