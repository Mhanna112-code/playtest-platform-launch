"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { bringInView } from "@/lib/markJump";
import { countBankCheck, finishPayment, stripePopup, type BankAction, type Simulate } from "@/lib/bankConfirm";
import { BANK_CHECK_TITLE, BANK_STAND_IN, BANK_STAND_IN_NOTE } from "@/lib/rules";

type Ended = { ok: true; value: unknown } | { ok: false; error: Error };

/**
 * (Batch 17 §11) The bank's check, INLINE, directly under the button that was pressed (never a pop-up): the bank's own page in a frame (it returns to
 * /api/payments/bank-return, which tells this page it finished; the server then asks Stripe how it ended), or, with the fake Stripe, a clearly-marked stand-in with
 * Confirm / Cancel so tests and recordings show the step.
 */
export function BankCheckView({ action, finish, onEnd }: { action: BankAction; finish: (s?: Simulate) => Promise<unknown>; onEnd: (r: Ended) => void }) {
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const ended = useRef(false);
  const end = useCallback(async (simulate?: Simulate) => {
    if (ended.current) return;
    ended.current = true;
    setBusy(true);
    try {
      onEnd({ ok: true, value: await finish(simulate) });
    } catch (e) {
      onEnd({ ok: false, error: e instanceof Error ? e : new Error(String(e)) });
    }
  }, [finish, onEnd]);
  useEffect(() => bringInView(box.current), []);
  useEffect(() => {
    if (!action.checkUrl) return;
    const heard = (e: MessageEvent) => {
      if (e.origin === window.location.origin && (e.data as { bankCheck?: unknown } | null)?.bankCheck === "done") void end();
    };
    window.addEventListener("message", heard);
    return () => window.removeEventListener("message", heard);
  }, [action.checkUrl, end]);
  if (!action.checkUrl) {
    return (
      <div ref={box} role="group" aria-label={BANK_STAND_IN} className="basis-full space-y-2 rounded-lg border-2 border-dashed border-amber-300/60 bg-amber-500/10 p-3 text-sm" data-bank-check="stand-in">
        <p className="font-semibold text-amber-100">{BANK_STAND_IN}</p>
        <p className="text-xs text-amber-200/80">{BANK_STAND_IN_NOTE}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn px-3 py-1.5 text-sm" disabled={busy} onClick={() => end("succeeded")} data-bank-confirm="">Confirm</button>
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" disabled={busy} onClick={() => end("failed")} data-bank-cancel="">Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div ref={box} role="group" aria-label={BANK_CHECK_TITLE} className="basis-full space-y-2 rounded-lg border border-sky-300/40 bg-sky-500/10 p-3 text-sm" data-bank-check="bank">
      <p className="font-semibold text-white">{BANK_CHECK_TITLE}</p>
      <iframe src={action.checkUrl} title={BANK_CHECK_TITLE} className="h-[28rem] w-full rounded-lg border border-white/10 bg-white" />
      <button type="button" className="btn-ghost px-3 py-1.5 text-sm" disabled={busy} onClick={() => end()} data-bank-cancel="">Cancel</button>
    </div>
  );
}

type Open = { action: BankAction; finish: (s?: Simulate) => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: Error) => void };

/**
 * (Batch 17 §11) A button's inline bank check: `check(action)` opens it (render `view` directly under the button) and resolves with the server's result when the payment
 * went through, or throws the plain sentence when it didn't. `finish` overrides what ends it (Verify a card). While it is open (`open`), the button stays disabled and the
 * page's live refresh waits.
 */
export function useBankCheck() {
  const [open, setOpen] = useState<Open | null>(null);
  const cur = useRef<Open | null>(null);
  useEffect(() => {
    if (!open) return;
    countBankCheck(1);
    return () => countBankCheck(-1);
  }, [open]);
  const check = useCallback(<T,>(a: BankAction, finish?: (s?: Simulate) => Promise<T>): Promise<T> => {
    const fin = finish ?? ((s?: Simulate) => finishPayment<T>(a.paymentId, s));
    if (a.needs === "none") return fin();
    if (!a.checkUrl && !a.simulated) return stripePopup(a).then(() => fin());
    return new Promise<T>((resolve, reject) => {
      cur.current = { action: a, finish: fin, resolve: resolve as (v: unknown) => void, reject };
      setOpen(cur.current);
    });
  }, []);
  const onEnd = useCallback((r: Ended) => {
    const o = cur.current;
    cur.current = null;
    setOpen(null);
    if (o && r.ok) o.resolve(r.value);
    else if (o && !r.ok) o.reject(r.error);
  }, []);
  const view = open ? <BankCheckView key={open.action.paymentId || "card"} action={open.action} finish={open.finish} onEnd={onEnd} /> : null;
  return { check, view, open: !!open };
}
