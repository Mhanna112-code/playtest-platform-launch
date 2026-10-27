"use client";
import { useMemo, useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { Err } from "@/components/Err";
import { FIELD } from "@/lib/client";
import { EXTRA_PAY_TICK_CENTS, EXTRA_PAY_TICK_LINE } from "@/lib/rules";
import { money, toCents } from "@/lib/format";
import { usePress } from "@/lib/usePress";

/**
 * (Owner, Oct 26) "Pay" with an amount box on a tester's row (current and past testers): pays them directly, outside any part. Over $200 a tick box appears:
 * "I understand this payment can't be refunded and is charged now." Pay is refused until it is ticked (red at the tick).
 */
export function ExtraPay({ testId, contractId, name, seenAt }: { testId: string; contractId: string; name: string; seenAt: string }) {
  const [amount, setAmount] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [tickErr, setTickErr] = useState("");
  const [done, setDone] = useState("");
  const { press, changes, error, busy } = usePress(seenAt);
  const payKey = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()), []);
  const cents = toCents(amount);
  const needsTick = cents != null && cents > EXTRA_PAY_TICK_CENTS;
  async function go() {
    setTickErr("");
    setDone("");
    if (needsTick && !understood) return setTickErr(`${FIELD}Tick “${EXTRA_PAY_TICK_LINE}” to pay.`);
    const r = await press<{ amountCents: number; status?: string }>(`/api/tests/${testId}/pay-extra`, { contractId, amount, understood: needsTick && understood, payKey }, "extra");
    if (!r) return;
    setDone(r.status === "not_set_up" ? `Recorded ${money(r.amountCents)}: payments aren't set up yet, so nothing was charged.` : `Paid ${name} ${money(r.amountCents)} extra.`);
    setAmount("");
    setUnderstood(false);
    setTimeout(() => window.location.reload(), 900);
  }
  return (
    <div className="flex flex-wrap items-center gap-2" data-extra-pay={contractId}>
      <span className="text-xs text-slate-400">$</span>
      <input className="input w-24 py-1 text-xs" inputMode="decimal" aria-label={`Extra pay for ${name} ($)`} placeholder="0.00" value={amount} onChange={(e) => { setAmount(e.target.value); setUnderstood(false); setTickErr(""); }} />
      {needsTick && (
        <label className="flex max-w-xs items-start gap-1.5 text-xs text-ink-200">
          <input type="checkbox" className="mt-0.5" checked={understood} onChange={(e) => { setUnderstood(e.target.checked); setTickErr(""); }} /> {EXTRA_PAY_TICK_LINE}
        </label>
      )}
      <button className="btn-secondary px-3 py-1 text-xs" disabled={busy || cents == null} onClick={go}>Pay</button>
      <div className="w-full space-y-1">
        <Err text={tickErr} />
        <ChangesBox changes={changes} error={error} />
        {done && <p className="ok">{done}</p>}
      </div>
    </div>
  );
}
