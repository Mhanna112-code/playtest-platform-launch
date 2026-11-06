"use client";
import { WhatLine } from "@/components/WholeLine";
import { withTestLinks, type TestLink } from "@/components/TestLinks";
import { useState, type ReactNode } from "react";
import { useBankCheck } from "@/components/BankCheck";
import { useBankGroupHold } from "@/components/HoldFold";
import { ChangesBox } from "@/components/ChangesBox";
import { refundLineOf, type BankAction } from "@/lib/bankConfirm";
import { money } from "@/lib/format";
import { MARKABLE } from "@/lib/markJump";
import { usePress } from "@/lib/usePress";
import { useLoadTime } from "@/components/KeepLoadTime";
import { BANK_CONFIRMED, CONFIRM_WITH_BANK, OVER_PAY_TICK_LINE, PAY_TICK_CENTS, bankAnchor } from "@/lib/rules";
import { refusalLine } from "@/lib/pressLabels";
import { CANCELLED_NOTHING_CHARGED, CANCEL_THIS_CHECK, STILL_WAITS, alreadyConfirmedLine, cancelledCheckLine } from "@/lib/bankNotice";
import { ApiError, api } from "@/lib/client";

/**
 * (Owner, Nov 3, §160; shared since Nov 4, §188 B) Cancel this check on the developer's own press whose bank window is open in another tab (or was left): Stripe
 * first, so one that already went through is recorded as paid once ("Your bank already confirmed it: paid $2.00."), else it is cancelled. The other tab's open
 * window then shows its cancelled line through its peek. (Owner, Nov 4, batch 35 §170) "Nothing was charged" is what it is for: a plain success line
 * ("Cancelled: nothing was charged."), never "Your Confirm with your bank didn't go through: …". A charge made while away keeps waiting (§160): said with its date.
 * `paid`: it had gone through (the part is paid).
 */
export async function cancelOwnCheck(paymentId: string): Promise<{ ok: true; line: string; paid: boolean } | { ok: false; error: string }> {
  try {
    const r = await api<{ amountCents?: number }>("/api/payments/confirm", { paymentId });
    return { ok: true, paid: true, line: typeof r?.amountCents === "number" ? alreadyConfirmedLine(money(r.amountCents)) : BANK_CONFIRMED };
  } catch (e) {
    if (e instanceof ApiError && e.code === "not_confirmed") return { ok: true, paid: false, line: cancelledCheckLine(e.message, e.data.by) };
    // (Owner, Nov 5, §217) Already cancelled underneath (the team's pause, a new card, a chargeback won): Cancel did what it says.
    if (e instanceof ApiError && e.code === "cancelled") return { ok: true, paid: false, line: CANCELLED_NOTHING_CHARGED };
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * (Batch 17 §11) A charge made while the developer was away (a tester's Charge, a dispute decision, an automatic retry) that their bank wants confirmed: on the test page,
 * under the affected piece, "Confirm with your bank" opens the same inline check as a press. Payments and the bell line link here (`#bank-<id>`, the box marked). A renewal
 * (no test) gets the same box on Payments.
 * (Owner, Oct 29, batch 23 section 9) On a test page the press runs the developer's stop-once check first, exactly like Pay on that piece: anything the page hasn't shown
 * stops it once in the blue box under the button; the second press opens the bank's check. Refusals (already confirmed, expired, cancelled) are plain.
 */
export function BankWaiting({ text, render, tests, after, before, paymentId, line, full, seenAt = "", wide = false, cents, own = false, anchor = true }: { /** (hotfix of §230) the quoted test names to link (data, so a server component can pass it; `render` only from a client one) */ tests?: TestLink[]; /** (§230) the line as plain text (cut names), with `render` for its pieces and `after` (a date) — it then opens like a payment row */ text?: string; render?: (t: string) => ReactNode; after?: ReactNode; /** (§246) the amount before the "what", always shown */ before?: ReactNode; paymentId: string; /** (Owner, Nov 4, §188 B) false: a second copy (in a Pay more box) without the `bank-<id>` anchor, which stays on the list's row */ anchor?: boolean; /** (§160) the developer's own press (a Pay or Pay more whose bank window is open in another tab, or was left): Cancel this check is offered */ own?: boolean; line: ReactNode; /** (§131) the line with the names uncut: its hover */ full?: string; wide?: boolean; /** the test page's load time; none on Payments (a renewal: no test) */ seenAt?: string; /** (Owner, Nov 3) its amount: over $200 the tick "I confirm this payment is over $200." is needed (as Pay's) */ cents?: number }) {
  const bank = useBankCheck();
  // (Batch 35 §40, §41) Confirmed: the page redraws in place; until it has, the button stays greyed with the confirmed line.
  // (§176) On the dashboard: from its first load, never a redraw's render time (elsewhere: the page's own marker, unchanged).
  const { press, changes, error, busy, doneLine, finish } = usePress(useLoadTime(seenAt));
  const [err, setErr] = useState("");
  const over = (cents ?? 0) > PAY_TICK_CENTS;
  const [over200, setOver200] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // (Owner, Nov 5, §210) Its own check paid (a retried chargeback), and that chargeback was won meanwhile and refunded: one more line under the confirmed line.
  const [refundNote, setRefundNote] = useState("");
  // (Owner, Nov 4, §180) On the test page its tester's drop-down stays open while its bank box, a stop box or a refusal is showing.
  useBankGroupHold(paymentId, bank.open || busy || changes != null || !!error || !!err);
  async function cancelCheck() {
    setErr("");
    setCancelling(true);
    const r = await cancelOwnCheck(paymentId);
    if (r.ok) finish(r.line);
    else {
      setErr(r.error);
      finish("");
    }
    setCancelling(false);
  }
  async function go() {
    setErr("");
    // (Owner, Nov 4, §177) `page`: away from the test's own page a stop line names the test.
    const start = await press<Omit<BankAction, "requiresAction">>("/api/payments/confirm", { paymentId, start: true, page: location.pathname, ...(over ? { over200 } : {}) }, "bank");
    if (!start) return; // stopped once, or refused: the box under the button says so
    try {
      // (§160) A charge made while away: Cancel (or leaving the page) never cancels it; it keeps waiting for the bank.
      setRefundNote(refundLineOf(await bank.check({ ...start, requiresAction: true, needs: start.needs ?? "confirm", cancel: own ? "press" : "waits" })));
      finish(BANK_CONFIRMED);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <div id={anchor ? bankAnchor(paymentId) : undefined} className={`min-w-0 max-w-full basis-full space-y-2 border border-sky-300/40 bg-sky-500/10 p-3 text-sm text-sky-100 ${MARKABLE}`} data-bank-waiting={paymentId}>
      {/* (Owner, Nov 4, §180) The line wraps inside the panel at every width (a long name or test name never runs past its edge). */}
      {/* (Owner, Nov 5, §246; was §230's per-name cut) The "what" cut at 50 (§251) with the arrow, opened in place (WhatLine); `before` (the amount) and `after` (confirm by)
          always show, outside the cut, and so do the buttons below. A test page's sentence ("Your bank wants you to confirm a $10.00 payment for her written answers,
          … Confirm it by …") carries its amount and date inside it, so it shows whole. */}
      <p className="[overflow-wrap:anywhere]">{before}{text != null ? <WhatLine text={full || text} render={render ?? (tests ? (t) => withTestLinks(t, tests) : undefined)} after={after} /> : line}</p>
      {over && !doneLine && (
        <label className="flex max-w-xs items-start gap-2 text-sm" data-over-tick="">
          <input type="checkbox" className="mt-1" data-match="^Tick “I confirm" checked={over200} onChange={(e) => setOver200(e.target.checked)} /> {OVER_PAY_TICK_LINE}
        </label>
      )}
      <button type="button" className={`btn px-3 py-1.5 text-sm${wide ? " w-full sm:w-auto" : ""}`} disabled={busy || bank.open || (over && !over200)} onClick={go}>{CONFIRM_WITH_BANK}</button>
      {/* (Owner, Nov 3, §160) The developer's own press with its window open elsewhere: Cancel this check here too (Stripe first: paid if it went through, else cancelled). */}
      {own && !doneLine && <button type="button" className="btn-ghost ml-2 px-3 py-1.5 text-sm" disabled={busy || bank.open || cancelling} onClick={cancelCheck} data-cancel-own-check="">{CANCEL_THIS_CHECK}</button>}
      <ChangesBox changes={changes} error={error} press={CONFIRM_WITH_BANK} />
      {bank.view}
      {/* (§156) The bank's check ended without the payment: named like any refusal ("Your Pay didn't go through: Your bank didn't confirm …"). */}
      {err && <p className="info" data-bank-not-confirmed="">{err.startsWith(STILL_WAITS) ? err /* (§160) Cancel: it keeps waiting, said plainly */ : refusalLine(CONFIRM_WITH_BANK, err)}</p>}
      {doneLine && <p className="ok" data-bank-confirmed="">{doneLine}</p>}
      {doneLine && refundNote && <p className="ok" data-own-check-refund="">{refundNote}</p>}
    </div>
  );
}
