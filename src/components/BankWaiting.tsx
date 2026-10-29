"use client";
import { useState } from "react";
import { useBankCheck } from "@/components/BankCheck";
import { ChangesBox } from "@/components/ChangesBox";
import { type BankAction } from "@/lib/bankConfirm";
import { MARKABLE } from "@/lib/markJump";
import { usePress } from "@/lib/usePress";
import { BANK_CONFIRMED, CONFIRM_WITH_BANK, bankAnchor } from "@/lib/rules";

/**
 * (Batch 17 §11) A charge made while the developer was away (a tester's Charge, a dispute decision, an automatic retry) that their bank wants confirmed: on the test page,
 * under the affected piece, "Confirm with your bank" opens the same inline check as a press. Payments and the bell line link here (`#bank-<id>`, the box marked). A renewal
 * (no test) gets the same box on Payments.
 * (Owner, Oct 29, batch 23 section 9) On a test page the press runs the developer's stop-once check first, exactly like Pay on that piece: anything the page hasn't shown
 * stops it once in the blue box under the button; the second press opens the bank's check. Refusals (already confirmed, expired, cancelled) are plain.
 */
export function BankWaiting({ paymentId, line, seenAt = "" }: { paymentId: string; line: string; /** the test page's load time; none on Payments (a renewal: no test) */ seenAt?: string }) {
  const bank = useBankCheck();
  const { press, changes, error, busy } = usePress(seenAt);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  async function go() {
    setErr("");
    const start = await press<Omit<BankAction, "requiresAction">>("/api/payments/confirm", { paymentId, start: true }, "bank");
    if (!start) return; // stopped once, or refused: the box under the button says so
    try {
      await bank.check({ ...start, requiresAction: true, needs: start.needs ?? "confirm" });
      setDone(BANK_CONFIRMED);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <div id={bankAnchor(paymentId)} className={`basis-full space-y-2 border border-sky-300/40 bg-sky-500/10 p-3 text-sm text-sky-100 ${MARKABLE}`} data-bank-waiting={paymentId}>
      <p>{line}</p>
      <button type="button" className="btn px-3 py-1.5 text-sm" disabled={busy || bank.open || !!done} onClick={go}>{CONFIRM_WITH_BANK}</button>
      <ChangesBox changes={changes} error={error} press={CONFIRM_WITH_BANK} />
      {bank.view}
      {err && <p className="info" data-bank-not-confirmed="">{err}</p>}
      {done && <p className="ok" data-bank-confirmed="">{done}</p>}
    </div>
  );
}
