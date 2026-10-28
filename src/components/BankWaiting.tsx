"use client";
import { useState } from "react";
import { useBankCheck } from "@/components/BankCheck";
import { startWaiting } from "@/lib/bankConfirm";
import { MARKABLE } from "@/lib/markJump";
import { BANK_CONFIRMED, CONFIRM_WITH_BANK, bankAnchor } from "@/lib/rules";

/**
 * (Batch 17 §11) A charge made while the developer was away (a tester's Charge, a dispute decision, an automatic retry) that their bank wants confirmed: on the test page,
 * under the affected piece, "Confirm with your bank" opens the same inline check as a press. Payments and the bell line link here (`#bank-<id>`, the box marked). A renewal
 * (no test) gets the same box on Payments.
 */
export function BankWaiting({ paymentId, line }: { paymentId: string; line: string }) {
  const bank = useBankCheck();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  async function go() {
    setBusy(true);
    setErr("");
    try {
      await bank.check(await startWaiting(paymentId));
      setDone(BANK_CONFIRMED);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div id={bankAnchor(paymentId)} className={`basis-full space-y-2 border border-sky-300/40 bg-sky-500/10 p-3 text-sm text-sky-100 ${MARKABLE}`} data-bank-waiting={paymentId}>
      <p>{line}</p>
      <button type="button" className="btn px-3 py-1.5 text-sm" disabled={busy || bank.open || !!done} onClick={go}>{CONFIRM_WITH_BANK}</button>
      {bank.view}
      {err && <p className="info" data-bank-not-confirmed="">{err}</p>}
      {done && <p className="ok" data-bank-confirmed="">{done}</p>}
    </div>
  );
}
