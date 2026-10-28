"use client";
import { useMemo, useState } from "react";
import { checkFields } from "@/components/FieldChecks";
import { ChangesBox } from "@/components/ChangesBox";
import { money, toCents } from "@/lib/format";
import { newPressId } from "@/lib/client";
import { usePress } from "@/lib/usePress";
import { confirmWithBank, needsBank } from "@/lib/bankConfirm";
import { NOT_LISTED, NO_LISTING_CALL_RATE_CAP_CENTS, OVER_PAY_TICK_LINE, PAY_TICK_CENTS, PAY_TICK_LINE, PAY_WAITS, REASON_WHEN_UNDER_LISTING, ZERO_PAY_REASON, overCallsLine, overListingLine, overMaxLine, payUnderLine } from "@/lib/rules";
import { amountFromRate, overCeilingLine, rateFromAmount } from "@/lib/callMeasure";
import { NotSentTag, useKept } from "@/lib/useKept";
import { LIMITS } from "@/lib/limits";

/** What can still be paid on this piece (pieceRoom on the server). */
export type PayRoom = { roomCents: number; aboveRoomCents: number; ceilingBinds: boolean };

/**
 * The one Pay box for a piece of sent work or a call that took place. (Owner, Oct 30, batch 15 sections 30, 31 and 40)
 *   - No Reject button anywhere: one green Pay, any amount from $0 up. "Note to <name> (optional)" is required at $0 ("Say why you're paying $0") and, while
 *     REASON_WHEN_UNDER_LISTING is on, below the listing.
 *   - Beside the amount, the room left: "up to $15.00 above the listing" / "up to $2,000.00 (max)" / "up to $X (what's left of the $1,000 for calls)". An amount above it
 *     is refused in red at the box as it's typed (and again on the server).
 *   - A call's box: Rate and Amount fill each other (rate × length; amount ÷ length × 60); the one typed last wins and the server recomputes the other. "Lower the length"
 *     (with a reason the tester reads) is under it until the call is paid.
 *   - Every amount above $0 needs the tick that names it, and over $200 also "I confirm this payment is over $200." A changed amount unticks both.
 * After a piece is paid, the tester row keeps the same box as "Pay more" (`more`: no rate, the amount starts empty) until its cap is reached.
 */
export function PayBox(p: {
  kind: "submission" | "call"; id: string; name: string; listingCents: number | null; listingText: string; paidSoFarCents: number; seenAt: string; note?: string; owes?: boolean;
  minutes?: number; rateCents?: number | null; room?: PayRoom; more?: { testId: string; contractId: string }; lower?: { testId: string }; warning?: string;
}) {
  const listed = p.listingCents != null;
  const more = p.more;
  const isCall = p.kind === "call" && !more;
  const start = more ? null : p.listingCents;
  const minutes = p.minutes ?? 0;
  const [amount, setAmount] = useState(start == null ? "" : (start / 100).toFixed(2));
  const [rate, setRate] = useState(isCall && listed && p.rateCents != null ? (p.rateCents / 100).toFixed(2) : "");
  const [typed, setTyped] = useState<"rate" | "amount">("amount");
  const [reason, setReason] = useState("");
  const [ticked, setTicked] = useState(false);
  const [over200, setOver200] = useState(false);
  const { press, changes, error, busy, at } = usePress(p.seenAt);
  const [done, setDone] = useState("");
  const [bankErr, setBankErr] = useState("");
  // (NEXT-UI 10) The note typed and not sent is kept on the server ("Not sent yet").
  const keep = useKept(`${more ? "more" : "pay"}:${p.kind}:${p.id}`, { reason }, reason === "", (v) => setReason(v.reason ?? ""));
  const payKey = useMemo(() => newPressId(), []);
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
  const roomText = !room ? "" : room.ceilingBinds ? `up to ${money(room.roomCents)} (what's left of the $1,000 for calls)` : listed ? `up to ${money(room.aboveRoomCents)} above the listing` : p.kind === "call" ? `up to ${money(room.roomCents)} ($200/h × ${minutes} min)` : `up to ${money(room.roomCents)} (max)`;
  const overCap = !!room && cents != null && cents > room.roomCents;
  const overText = !room || !overCap ? "" : room.ceilingBinds ? overCeilingLine(room.roomCents) : listed ? overListingLine(room.aboveRoomCents) : p.kind === "call" ? overCallsLine(room.roomCents) : overMaxLine(room.aboveRoomCents);

  async function go() {
    const r = more
      ? await press<{ status?: string; amountCents: number; later?: string }>(`/api/tests/${more.testId}/pay-extra`, {
        contractId: more.contractId, ...(p.kind === "call" ? { callId: p.id } : { submissionId: p.id }), amount, note: reason, payKey, tickedCents: ticked ? cents : null, over200: over && over200,
      }, "pay")
      : await press<{ status?: string; amountCents: number; later?: string }>("/api/review", {
        kind: p.kind, id: p.id, payKey, amount, reason, ...(isCall && rate ? { rate, typed } : {}), tickedCents: ticked ? cents : null, over200: over && over200,
      }, "pay");
    if (!r) return;
    // (Batch 11) The bank wants to confirm: its pop-up, then the payment goes through, or nothing was charged (the blue notice under the button).
    let res: typeof r = r;
    if (needsBank(r)) {
      setBankErr("");
      try { res = await confirmWithBank<typeof r>(r); } catch (e) { setBankErr((e as Error).message); return; }
    }
    await keep.clear();
    setDone(res.status === "not_set_up" ? `Recorded ${money(res.amountCents)}: payments aren't set up yet, so nothing was charged.` : res.amountCents === 0 ? "Paid $0." : `Paid ${money(res.amountCents)}${res.later ? ` · ${res.later}` : ""}.`);
    setTimeout(() => window.location.reload(), 900);
  }

  return (
    <div className={`space-y-3 ${more ? "w-full rounded-lg border border-white/10 p-3" : "border-t border-white/10 pt-4"}`} data-pay-box={listed ? "listed" : "unlisted"} data-pay-more={more ? p.id : undefined}>
      <p className="text-sm">
        {more && <b className="text-white">Pay more · </b>}
        <b>{listed ? `Listing: ${p.listingText}` : NOT_LISTED}</b>
        {!more && <> · You&apos;ve paid {p.name} {money(p.paidSoFarCents)} so far on this test.</>}
      </p>
      {p.warning && <p className="text-xs text-amber-200" data-calls-warning="">{p.warning}</p>}
      <div className="flex flex-wrap items-end gap-2">
        {isCall && (
          <div>
            <label className="label" htmlFor={`rate-${p.id}`}>Rate ($/h)</label>
            <input id={`rate-${p.id}`} className="input w-24" inputMode="decimal" data-rate="" value={rate} onChange={(e) => typeRate(e.target.value)} placeholder={listed ? "" : `up to ${money(NO_LISTING_CALL_RATE_CAP_CENTS).replace(/\.00$/, "")}`} />
            <span className="ml-1 text-xs text-slate-500">× {minutes} min</span>
          </div>
        )}
        <div>
          <label className="label req" htmlFor={`amt-${p.id}`}>Amount ($)</label>
          <input id={`amt-${p.id}`} className="input w-32" inputMode="decimal" data-amount="" data-min="0.5" data-max="999999.99" data-zero-ok="" data-msg="Pay $0.00, or at least $0.50 (the smallest card charge). Stripe can't take more than $999,999.99 in one charge." value={amount} onChange={(e) => typeAmount(e.target.value)} placeholder="0.00" />
        </div>
        {roomText && <span className="pb-2 text-sm text-slate-400" data-pay-room="">{roomText}</span>}
      </div>
      {overText && <p className="err-field" data-over-cap="">{overText}</p>}
      <div className="min-w-[14rem]">
        <label className={`label ${needsReason ? "req" : ""}`} htmlFor={`why-${p.id}`}>Note to {p.name}{needsReason ? "" : " (optional)"}</label>
        <textarea id={`why-${p.id}`} className="input min-h-[2.75rem]" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={listed ? "What it's missing, or a thank-you" : "A thank-you, or what the pay is for"} />
        <p className={`text-xs ${reason.length > LIMITS.reason ? "text-rose-300" : "text-slate-500"}`} data-note-count="">{reason.length.toLocaleString("en-US")} / {LIMITS.reason.toLocaleString("en-US")}</p>
        {reasonMissing && <p className="err-field" data-reason-needed="">{cents === 0 ? ZERO_PAY_REASON : `Say why you're paying less than the listing's ${money(p.listingCents)} (the tester reads it).`}</p>}
        {keep.restored && <NotSentTag />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {cents != null && cents > 0 && (
          <label className="flex max-w-sm items-start gap-2 text-sm text-ink-200" data-pay-tick="">
            <input type="checkbox" className="mt-1" checked={ticked} onChange={(e) => setTicked(e.target.checked)} /> {PAY_TICK_LINE(cents)}
          </label>
        )}
        {over && (
          <label className="flex max-w-xs items-start gap-2 text-sm text-ink-200" data-over-tick="">
            <input type="checkbox" className="mt-1" checked={over200} onChange={(e) => setOver200(e.target.checked)} /> {OVER_PAY_TICK_LINE}
          </label>
        )}
        <button className="btn-green" disabled={busy || cents == null || !tickOk || !!p.owes || overCap || reasonMissing || reason.length > LIMITS.reason || (!!more && cents === 0)} onClick={(e) => checkFields(e.currentTarget.closest("div.space-y-3")) && go()}>{more ? "Pay more" : "Pay"}</button>
        {p.owes && <span className="text-xs text-amber-200" data-owes-note="">{PAY_WAITS} <a href="#owed">Pay what you owe ↑</a></span>}
        <span className="text-xs text-slate-500">at least $0.50 (or 0)</span>
      </div>
      {at === "pay" && <ChangesBox changes={changes} error={error} press={`${more ? "Pay more" : "Pay"} on ${p.name}'s ${p.kind === "call" ? "call" : /recording/.test(p.listingText) ? "recording" : "written answers"}`} />}
      {bankErr && <p className="info" data-bank-not-confirmed="">{bankErr}</p>}
      {!more && <p className="note" data-pay-under="">{payUnderLine(p.name, listed)}</p>}
      {p.note && <p className="note">{p.note}</p>}
      {error === "Pay what you owe first." && <a className="text-sm" href="#owed">Pay what you owe ↑</a>}
      {done && <p className="ok">{done}</p>}
      {isCall && p.lower && minutes > 1 && <LowerLength testId={p.lower.testId} callId={p.id} minutes={minutes} name={p.name} seenAt={p.seenAt} />}
    </div>
  );
}

/** (Batch 15 section 40) "Lower the length": the developer can only lower a call's measured length, with a reason the tester reads. Never raise it. */
function LowerLength({ testId, callId, minutes, name, seenAt }: { testId: string; callId: string; minutes: number; name: string; seenAt: string }) {
  const [v, setV] = useState("");
  const [why, setWhy] = useState("");
  const { press, changes, error, busy, at } = usePress(seenAt);
  const n = Number(v);
  const bad = v.trim() !== "" && (!Number.isInteger(n) || n < 1 || n >= minutes);
  return (
    <details className="rounded-lg border border-white/10 p-2 text-sm" data-lower-length="">
      <summary className="fold-chevron cursor-pointer text-slate-300">Lower the length</summary>
      <div className="mt-2 space-y-2">
        <p className="note">You can only lower it (below {minutes} min), and {name} reads your reason. {name} can dispute the amount once.</p>
        <label className="inline-flex items-center gap-1">New length <input className="input w-20" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} aria-label="New length in minutes" /> min</label>
        {bad && <p className="err-field">Lower it to whole minutes, from 1 to {minutes - 1}.</p>}
        <label className="label req" htmlFor={`lower-why-${callId}`}>Why (the tester reads it)</label>
        <textarea id={`lower-why-${callId}`} className="input" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
        <p className={`text-xs ${why.length > LIMITS.reason ? "text-rose-300" : "text-slate-500"}`}>{why.length.toLocaleString("en-US")} / {LIMITS.reason.toLocaleString("en-US")}</p>
        <button className="btn-secondary" disabled={busy || !v.trim() || bad || why.trim().length < 5 || why.length > LIMITS.reason} onClick={async () => { if (await press(`/api/tests/${testId}/lower-length`, { callId, minutes: n, reason: why }, "lower")) window.location.reload(); }}>Lower the length</button>
        {at === "lower" && <ChangesBox changes={changes} error={error} />}
      </div>
    </details>
  );
}
