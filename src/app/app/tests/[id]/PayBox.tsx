"use client";
import { CharacterCount } from "@/components/CharacterCount";
import { BankWaiting, cancelOwnCheck } from "@/components/BankWaiting";
import { useState } from "react";
import { checkFields } from "@/components/FieldChecks";
import { FormMistakes } from "@/components/FormMistakes";
import { ChangesBox } from "@/components/ChangesBox";
import { money, toCents } from "@/lib/format";
import { FIELD, newPressId } from "@/lib/client";
import { usePress } from "@/lib/usePress";
import { PayOwedLink } from "@/components/PayOwedLink";
import { needsBank } from "@/lib/bankConfirm";
import { useBankCheck } from "@/components/BankCheck";
import { useHoldOpen } from "@/components/HoldFold";
import { CANCEL_THIS_CHECK, payMoreWaits } from "@/lib/bankNotice";
import { MIN_CHARGE_CENTS, NOT_LISTED, NO_LISTING_CALL_RATE_CAP_CENTS, OVER_PAY_TICK_LINE, PAY_TICK_CENTS, PAY_TICK_LINE, PAY_WAITS, REASON_WHEN_UNDER_LISTING, STRIPE_MAX_LINE, ZERO_PAY_REASON, overCallsLine, overMaxLine, payUnderLine } from "@/lib/rules";
import { amountFromRate, overCeilingLine, rateFromAmount } from "@/lib/callMeasure";
import { DraftTag, useKept } from "@/lib/useKept";
import { LIMITS } from "@/lib/limits";
import { PressDone } from "@/components/PressDone";
import { refusalLine } from "@/lib/pressLabels";
import { lockText, useSending } from "@/lib/sendLock";

/** What can still be paid on this piece (pieceRoom on the server). */
export type PayRoom = { roomCents: number; aboveRoomCents: number; ceilingBinds: boolean; /** (batch 29 §38) the piece's max in all */ totalCapCents?: number };

/**
 * The one Pay box for a piece of sent work or a call that took place. (Owner, Oct 30, batch 15 sections 30, 31 and 40)
 *   - No Reject button anywhere: one green Pay, any amount from $0 up. "Note to <name> (optional)" is required at $0 ("Say why you're paying $0") and, while
 *     REASON_WHEN_UNDER_LISTING is on, below the listing.
 *   - Beside the amount, the room left (batch 29 §38: the part's max in all): "up to $500.00 in all" / Pay more "up to $990.00 more ($500.00 in all)" / an unlisted
 *     call "up to $100.00 ($200/h × 30 min)" / "up to $X (what's left of the $500 for calls)". An amount above it
 *     is refused in red at the box as it's typed (and again on the server).
 *   - A call's box: Rate and Amount fill each other (rate × length; amount ÷ length × 60); the one typed last wins and the server recomputes the other. (Batch 16 section 26) No
 *     "Lower the length": the box starts at the measured length × the rate; paying less needs the usual reason.
 *   - Every amount above $0 needs the tick that names it, and over $200 also "I confirm this payment is over $200." A changed amount unticks both.
 * After a piece is paid, the tester row keeps the same box as "Pay more" (`more`: no rate, the amount starts empty) until its cap is reached.
 * (Batch 16 section 10) Each mistake is red at its box (the server's line goes to the box whose data-match fits it) and listed under the button.
 * (Owner, Oct 31, batch 35 §41) Once a Pay or Pay more goes through, the box keeps only its greyed button and the result line ("Paid $10.00 more to <name>.")
 * until the page has redrawn in place (§40); then a Pay more that's still there is empty, ready to pay more again.
 */
export function PayBox(p: {
  kind: "submission" | "call"; id: string; name: string; listingCents: number | null; listingText: string; seenAt: string; note?: string; owes?: boolean;
  minutes?: number; rateCents?: number | null; room?: PayRoom; more?: { testId: string; contractId: string }; warning?: string;
  /** (Batch 30 §2) This Pay more answers an updated version sent after the piece was paid: $0 closes it (an optional note). */
  update?: boolean;
  confirming?: string;
  /** (Owner, Nov 3, §159) Pay more while a payment on this part waits for the bank: the box is greyed with this line ("Confirm Ana Silva's $10.00 charge with your bank first."). */
  bankWaits?: string;
  /** (Owner bug, Nov 4, §174) The waiting payment `bankWaits` is about: the box's own bank check never greys it. */
  bankWaitsId?: string;
  /** (Owner, Nov 4, §188 B) What the waiting payment is: the developer's own press ("own": Cancel this check next to the line), a charge made while away or a
   * team decision's ("away": Confirm with your bank, it can't be cancelled), or one on its way ("pending": the line only). `cents`: its amount (the over-$200 tick). */
  bankWaitsKind?: { kind: "own" | "away" | "pending"; cents: number };
  /** (Owner, Nov 4, §199) A Pay more box in the Testers list: a charge made while away is confirmed only in Needs you, so the greyed box shows its line only (no
   * working Confirm with your bank here); the part's "Confirm with your bank in Needs you ↑" link right under the box goes up to it. */
  awayInNeeds?: boolean;
  /** (Owner, Nov 5, §226) Needs you's box for what's new on a paid part: Pay more's route, checks and stops, named "Pay" (its button, its refusals and stops; the
   * request says so with `press: "Pay"`, so the server's failed-press line names Pay too). The Testers list keeps "Pay more". */
  moreLabel?: "Pay";
  /** (Owner, Nov 6, §288) false once the tester rated the test (their disputes are closed): the line under Pay says nothing about disputing. */
  disputable?: boolean;
}) {
  const listed = p.listingCents != null;
  const underLine = payUnderLine(p.name, listed, p.disputable !== false);
  const more = p.more;
  // (§226) The press's name: Pay or Pay more (a Needs you Pay more is "Pay").
  const pressName = !more || p.moreLabel === "Pay" ? "Pay" : "Pay more";
  const isCall = p.kind === "call" && !more;
  const start = more ? null : p.listingCents;
  const minutes = p.minutes ?? 0;
  const [amount, setAmount] = useState(start == null ? "" : (start / 100).toFixed(2));
  const [rate, setRate] = useState(isCall && listed && p.rateCents != null ? (p.rateCents / 100).toFixed(2) : "");
  const [typed, setTyped] = useState<"rate" | "amount">("amount");
  const [reason, setReason] = useState("");
  const [ticked, setTicked] = useState(false);
  const [over200, setOver200] = useState(false);
  // (Batch 35 §41) The redraw after a payment landed: a Pay more still here starts empty again (a new attempt, a new key).
  const { press, changes, error, busy, at, done, doneLine, finish } = usePress(p.seenAt, undefined, { onFresh: () => { emptyBox(); setPayKey(newPressId()); } });
  const [bankErr, setBankErr] = useState("");
  // (Batch 17 §11) The bank's check opens inline, under the button; the button stays disabled while it is open.
  const bank = useBankCheck();
  // (Owner, Nov 4, §181) Its own bank check (or the line under it) keeps its part's and its person's drop-downs open.
  useHoldOpen(bank.open || !!bankErr);
  // (Owner bug, Nov 4, §174) This box's own bank check (its payment): a redraw saying that very payment waits for the bank doesn't grey the box above its own check.
  const [ownCheck, setOwnCheck] = useState("");
  // (Owner, Nov 4, §188 B) The own press this box just cancelled (Cancel this check next to the line): the box un-greys at once, without waiting for a redraw,
  // with the plain success line (§170's "Cancelled: nothing was charged."); a redraw drawn before the cancel that still names it doesn't grey it again.
  const [cancelled, setCancelled] = useState<{ id: string; line: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelErr, setCancelErr] = useState("");
  const bankWaits = payMoreWaits(p.bankWaits, p.bankWaitsId, { open: bank.open, checkId: ownCheck, cancelled: cancelled?.id });
  const waitKind = bankWaits ? p.bankWaitsKind?.kind : undefined;
  async function cancelWaiting() {
    const id = p.bankWaitsId;
    if (!id) return;
    setCancelErr("");
    setCancelling(true);
    const r = await cancelOwnCheck(id);
    setCancelling(false);
    if (r.ok) setCancelled({ id, line: r.line });
    else setCancelErr(r.error);
  }
  // (NEXT-UI 10) The note typed and not sent is kept on the server ("Draft"; batch 35 §8: after signing in, with "Use saved").
  // (Owner, Oct 30) The amount (and a call's rate) is kept with its note, so a note never comes back next to another amount. A kept amount needs the tick again.
  const startAmount = start == null ? "" : (start / 100).toFixed(2);
  const startRate = isCall && listed && p.rateCents != null ? (p.rateCents / 100).toFixed(2) : "";
  const keep = useKept(`${more ? "more" : "pay"}:${p.kind}:${p.id}`, { reason, amount, rate }, reason === "" && amount === startAmount && rate === startRate, (v: { reason?: string; amount?: string; rate?: string }) => {
    setReason(v.reason ?? "");
    if (typeof v.amount === "string") setAmount(v.amount);
    if (typeof v.rate === "string") setRate(v.rate);
  });
  const useSaved = () => {
    setReason("");
    setAmount(startAmount);
    setRate(startRate);
    setTicked(false);
    setOver200(false);
  };
  const emptyBox = useSaved;
  // (Batch 19 section 5) One key per attempt: a double press of it charges once; a press that didn't go through (the bank's check cancelled or failed, or a refusal)
  // frees it, and the next Pay is a new attempt with a new key.
  const [payKey, setPayKey] = useState(newPressId);
  const cents = toCents(amount);
  const below = listed && cents != null && cents < p.listingCents!;
  const over = cents != null && cents > PAY_TICK_CENTS;
  const needsReason = !more && cents != null && (cents === 0 || (REASON_WHEN_UNDER_LISTING && below));
  const reasonMissing = needsReason && reason.trim().length < 5;
  // (Batch 15 section 40) Rate and Amount fill each other; the last one typed wins.
  const typeAmount = (v: string) => {
    setAmount(v);
    setTyped("amount");
    const c = toCents(v);
    if (isCall && minutes > 0) setRate(c == null ? "" : (rateFromAmount(c, minutes) / 100).toFixed(2));
    setTicked(false);
    setOver200(false);
  };
  const typeRate = (v: string) => {
    setRate(v);
    setTyped("rate");
    const r = toCents(v);
    setAmount(r == null ? "" : (amountFromRate(r, minutes) / 100).toFixed(2));
    setTicked(false);
    setOver200(false);
  };
  const tickOk = cents === 0 || (ticked && (!over || over200));
  // (Batch 15 section 31) The room beside the amount, and the red line when the amount is above it.
  const room = p.room;
  const total = room ? room.totalCapCents ?? room.roomCents : 0;
  const unlistedCall = !listed && p.kind === "call";
  const roomText = !room ? "" : room.ceilingBinds ? `up to ${money(room.roomCents)} (what's left of the $500 for calls)` : unlistedCall && !more ? `up to ${money(room.roomCents)} ($200/h × ${minutes} min)` : more ? `up to ${money(room.roomCents)} more (${money(total)} in all)` : `up to ${money(room.roomCents)} in all`;
  const overCap = !!room && cents != null && cents > room.roomCents;
  const overText = !room || !overCap ? "" : room.ceilingBinds ? overCeilingLine(room.roomCents) : unlistedCall ? overCallsLine(room.roomCents) : overMaxLine(room.roomCents, total);

  // (Owner, Nov 5, §261) From the press until it ends (the server's answer, the bank's check it opens, the redraw after it went through), the rate, the amount and
  // the note are read-only: what's on its way can't change. Refused, stopped once or not confirmed by the bank, they are as before.
  const paying = useSending();
  const sending = paying.sending || busy || bank.open;
  const go = () => paying.run(pay);
  async function pay() {
    const r = more
      ? await press<{ status?: string; amountCents: number }>(`/api/tests/${more.testId}/pay-extra`, {
        contractId: more.contractId, ...(p.kind === "call" ? { callId: p.id } : { submissionId: p.id }), amount, note: reason, payKey, tickedCents: ticked ? cents : null, over200: over && over200,
        ...(p.moreLabel ? { press: p.moreLabel } : {}),
      }, "pay")
      : await press<{ status?: string; amountCents: number }>("/api/review", {
        kind: p.kind, id: p.id, payKey, amount, reason, ...(isCall && rate ? { rate, typed } : {}), tickedCents: ticked ? cents : null, over200: over && over200,
      }, "pay");
    if (!r) {
      setPayKey(newPressId());
      return;
    }
    // (Batch 11) The bank wants to confirm: (batch 17 §11) its check opens inline under the button; then the payment goes through, or nothing was charged (the blue notice).
    let res: typeof r = r;
    if (needsBank(r)) {
      setBankErr("");
      setOwnCheck(r.paymentId);
      try { res = await bank.check<typeof r>(r); } catch (e) { setBankErr((e as Error).message); setPayKey(newPressId()); return; }
    }
    await keep.clear();
    finish(res.status === "closed" ? "Closed at $0." : res.status === "not_set_up" ? `Recorded ${money(res.amountCents)}: payments aren't set up yet, so nothing was charged.` : res.amountCents === 0 ? "Paid $0." : more && !p.moreLabel ? `Paid ${money(res.amountCents)} more to ${p.name}.` : `Paid ${money(res.amountCents)} to ${p.name}.`);
  }

  // (§160) A redraw while this box's own bank check is open keeps the box (and the bank's page): only another tab's or a later visit's shows "Confirming with your bank".
  if (p.confirming && !bank.open) return <BankWaiting own paymentId={p.confirming} line="Confirming with your bank" seenAt={p.seenAt} />;
  return (
    // (Owner, Nov 4, §188 B) Greyed (data-pay-greyed, globals.css): everything but the waiting row, which holds the press that ends the wait.
    <div className={`space-y-3 ${more ? "w-full rounded-lg border border-white/10 p-3" : "border-t border-white/10 pt-4"}`} data-pay-box={listed ? "listed" : "unlisted"} data-pay-more={more ? p.id : undefined} data-pay-greyed={bankWaits ? "" : undefined} data-mistakes-root="">
      {/* (Owner, Nov 4, §188 B) The developer's own press open elsewhere: Cancel this check right next to the line. A charge made while away or a team
          decision's: Confirm with your bank for it (it can't be cancelled, only confirmed; no bank-<id> anchor here, that stays on Needs you's row). */}
      {bankWaits && waitKind === "away" && p.bankWaitsId && !p.awayInNeeds ? (
        <div data-pay-more-waits="" data-waits-kind="away"><BankWaiting anchor={false} paymentId={p.bankWaitsId} cents={p.bankWaitsKind?.cents} line={bankWaits} seenAt={p.seenAt} /></div>
      ) : bankWaits && (
        <div className="space-y-1" data-pay-more-waits="" data-waits-kind={waitKind ?? ""}>
          <p className="info">
            {bankWaits}
            {waitKind === "own" && <> <button type="button" className="btn-ghost ml-1 px-2 py-0.5 text-sm" disabled={cancelling} onClick={cancelWaiting} data-cancel-own-check="">{cancelling ? "Cancelling…" : CANCEL_THIS_CHECK}</button></>}
          </p>
          {cancelErr && <p className="info" data-cancel-error="">{refusalLine(CANCEL_THIS_CHECK, cancelErr)}</p>}
        </div>
      )}
      {!bankWaits && cancelled && !done && <p className="ok" data-check-cancelled="">{cancelled.line}</p>}
      <p className="text-sm">
        {more && <b className="text-white">{pressName} · </b>}
        <b>{listed ? `Listing: ${p.listingText}` : NOT_LISTED}</b>
        {/* (Owner, Nov 4, §195) No "You've paid <name> $X so far on this test." here any more (confusing inside one part's box): the tester's paid so far is
            shown once, by their name (Needs you's person, the Testers row). Pay more keeps its own line of what this part was paid. */}
      </p>
      {p.warning && <p className="text-xs text-amber-200" data-calls-warning="">{p.warning}</p>}
      {!done && <>
      <div className="flex flex-wrap items-end gap-2">
        {isCall && (
          <div>
            <label className="label" htmlFor={`rate-${p.id}`}>Rate ($/h)</label>
            <input id={`rate-${p.id}`} className="input w-24" inputMode="decimal" data-money="" data-rate="" data-match="rate like|at most .200 an hour" value={rate} onChange={(e) => typeRate(e.target.value)} {...lockText(sending)} placeholder={listed ? "" : `up to ${money(NO_LISTING_CALL_RATE_CAP_CENTS).replace(/\.00$/, "")}`} />
            <span className="ml-1 text-xs text-slate-500">× {minutes} min</span>
          </div>
        )}
        <div>
          <label className="label req" htmlFor={`amt-${p.id}`}>Amount ($)</label>
          <input id={`amt-${p.id}`} className="input w-32" inputMode="decimal" data-money="" data-amount="" data-min="0.5" data-max="999999.99" data-zero-ok="" data-msg="Enter an amount like 7.50." data-min-msg={`The smallest card charge is ${money(MIN_CHARGE_CENTS)}: pay $0.00 or at least ${money(MIN_CHARGE_CENTS)}.`} data-max-msg={STRIPE_MAX_LINE}
            data-match="amount like|smallest card charge|Stripe can't|more than you can pay|most you can pay at once|extra would be" data-red-msg={overText || undefined} value={amount} onChange={(e) => typeAmount(e.target.value)} placeholder="0.00" {...lockText(sending)} />
        </div>
        {roomText && <span className="pb-2 text-sm text-slate-400" data-pay-room="">{roomText}</span>}
      </div>
      {overText && <p className="err-field" data-over-cap="">{overText}</p>}
      {/* (Owner, Nov 4, §189) The note fills the box's width and never more: its old 14rem minimum ran past a Pay more box's right edge on a phone. */}
      <div className="w-full min-w-0 max-w-full" data-pay-note="">
        <label className={`label [overflow-wrap:anywhere] ${needsReason ? "req" : ""}`} htmlFor={`why-${p.id}`}>Note to {p.name}{needsReason ? "" : " (optional)"}</label>
        <textarea id={`why-${p.id}`} className="input min-h-[2.75rem]" rows={2} maxLength={LIMITS.reason} data-match="why you're paying" data-red-msg={reasonMissing ? (cents === 0 ? ZERO_PAY_REASON : `Say why you're paying less than the listing's ${money(p.listingCents)} (the tester reads it).`) : undefined} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={listed ? "What it's missing, or a thank-you" : "A thank-you, or what the pay is for"} {...lockText(sending)} />
        <CharacterCount value={reason} min={needsReason ? 5 : 0} max={LIMITS.reason} required={needsReason} data-note-count="" />
        {reasonMissing && <p className="err-field" data-reason-needed="">{cents === 0 ? ZERO_PAY_REASON : `Say why you're paying less than the listing's ${money(p.listingCents)} (the tester reads it).`}</p>}
        {keep.restored && (reason !== "" || amount !== startAmount || rate !== startRate) && <DraftTag disabled={busy} kind="discard" onUseSaved={useSaved} /> /* (batch 35 §39) nothing saved: Discard (the amount back to its start, the note emptied, the ticks off) */}
      </div>
      </>}
      <div className="flex flex-wrap items-center gap-2">
        {!done && cents != null && cents > 0 && (
          <label className="flex max-w-sm items-start gap-2 text-sm text-ink-200" data-pay-tick="">
            <input type="checkbox" id={`tick-${p.id}`} className="mt-1" data-match="^Tick “I understand" checked={ticked} onChange={(e) => setTicked(e.target.checked)} /> {PAY_TICK_LINE(cents)}
          </label>
        )}
        {!done && over && (
          <label className="flex max-w-xs items-start gap-2 text-sm text-ink-200" data-over-tick="">
            <input type="checkbox" id={`over-${p.id}`} className="mt-1" data-match="^Tick “I confirm" checked={over200} onChange={(e) => setOver200(e.target.checked)} /> {OVER_PAY_TICK_LINE}
          </label>
        )}
        <button className="btn-green" disabled={busy || bank.open || !!bankWaits || cents == null || !tickOk || !!p.owes || overCap || reasonMissing || reason.length > LIMITS.reason || (!!more && cents === 0 && !p.update)} onClick={(e) => checkFields(e.currentTarget.closest("div.space-y-3")) && go()}>{pressName}</button>
        {/* (Owner, Nov 5, §227) Pay what you owe is on Payments, never on the test page: the link goes there. */}
        {!done && p.owes && <span className="text-xs text-amber-200" data-owes-note="">{PAY_WAITS} <PayOwedLink /></span>}
        {!done && <span className="text-xs text-slate-500">at least $0.50 (or 0)</span>}
      </div>
      {bank.view}
      <PressDone line={doneLine} />
      {at === "pay" && <ChangesBox changes={changes} error={error.startsWith(FIELD) ? "" : error} press={`${pressName} on ${p.name}'s ${p.kind === "call" ? "call" : /recording/.test(p.listingText) ? "recording" : "written answers"}`} />}
      <FormMistakes text={at === "pay" && error.startsWith(FIELD) ? error : ""} press={pressName} />
      {/* (§156) The bank's check ended without the payment: named like any refusal ("Your Pay didn't go through: Your bank didn't confirm …"). */}
      {bankErr && <p className="info" data-bank-not-confirmed="">{refusalLine(pressName, bankErr)}</p>}
      {!done && !more && underLine && <p className="note" data-pay-under="">{underLine}</p>}
      {!done && more && p.update && <p className="note" data-update-under="">Any amount up to the cap, or $0 to close this row (a note is optional).</p>}
      {!done && p.note && <p className="note">{p.note}</p>}
      {error === PAY_WAITS && <PayOwedLink className="text-sm underline" />}
    </div>
  );
}
