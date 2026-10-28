"use client";
import { useMemo, useState } from "react";
import { checkFields } from "@/components/FieldChecks";
import { ChangesBox } from "@/components/ChangesBox";
import { money, toCents } from "@/lib/format";
import { newPressId } from "@/lib/client";
import { usePress } from "@/lib/usePress";
import { confirmWithBank, needsBank } from "@/lib/bankConfirm";
import { NOT_LISTED, NO_LISTING_CALL_RATE_CAP_CENTS, OVER_PAY_TICK_LINE, PAY_TICK_CENTS, PAY_TICK_LINE, PAY_WAITS } from "@/lib/rules";
import { NotSentTag, useKept } from "@/lib/useKept";

/**
 * The one Pay box for a piece of sent work or a held call (with Reject next to it for a LISTED part). Beside it: the listing amount (or "Not listed") and what this
 * tester has been paid so far on the test. Its stop-once box sits directly under it.
 * (Owner, Oct 28 night, batch 9)
 *   - A part that isn't listed has only Pay: the box starts empty and $0 is allowed (it closes the row).
 *   - "Note to <tester> (optional)": the tester reads it with the payment; it is required to pay less than the listing, and to reject.
 *   - A call's box has "Rate ($/h)": typing a rate fills the amount with rate × the logged minutes; typing an amount clears the rate. A listed call's rate starts at the
 *     contract rate; an unlisted one's starts empty and is at most $200/h.
 *   - Every amount above $0 needs the tick that names it, and over $200 also "I confirm this payment is over $200." A changed amount unticks both.
 * (Owner, Oct 29, batch 11 section 6) There is ONE Pay box per piece and no separate Extra pay: an amount above the listing counts as extra pay (within the per-piece caps;
 * `roomCents` is the most it can be now). After the piece is paid, the tester row keeps the same box as "Pay more" (`more`: no Reject, no rate, the amount starts empty)
 * until the cap is reached. (Batch 12 section 2) An unlisted call's box shows what is left of the tester's $1000 for unlisted calls.
 */
export function PayBox(p: { kind: "submission" | "call"; id: string; name: string; listingCents: number | null; listingText: string; paidSoFarCents: number; seenAt: string; partPaidCents?: number; note?: string; owes?: boolean; minutes?: number; rateCents?: number | null; roomCents?: number; callPoolRoomCents?: number | null; more?: { testId: string; contractId: string } }) {
  const listed = p.listingCents != null;
  const more = p.more;
  const isCall = p.kind === "call" && !more;
  const start = more ? null : p.listingCents;
  const [amount, setAmount] = useState(start == null ? "" : (start / 100).toFixed(2));
  const [rate, setRate] = useState(isCall && listed && p.rateCents != null ? (p.rateCents / 100).toFixed(2) : "");
  const [reason, setReason] = useState("");
  const [ticked, setTicked] = useState(false);
  const [over200, setOver200] = useState(false);
  const [paidSoFar, setPaidSoFar] = useState(p.paidSoFarCents);
  const { press, changes, error, busy, at } = usePress(p.seenAt, (d) => typeof d.paidSoFarCents === "number" && setPaidSoFar(d.paidSoFarCents));
  const [done, setDone] = useState("");
  const [bankErr, setBankErr] = useState("");
  // (NEXT-UI 10) The note typed and not sent is kept on the server ("Not sent yet").
  const keep = useKept(`${more ? "more" : "reject"}:${p.kind}:${p.id}`, { reason }, reason === "", (v) => setReason(v.reason ?? ""));
  const payKey = useMemo(() => newPressId(), []);
  const cents = toCents(amount);
  const below = listed && cents != null && cents < p.listingCents!;
  const over = cents != null && cents > PAY_TICK_CENTS;
  const minutes = p.minutes ?? 0;
  const typeAmount = (v: string) => { setAmount(v); setRate(""); setTicked(false); setOver200(false); };
  const typeRate = (v: string) => {
    setRate(v);
    const r = toCents(v);
    setAmount(r == null ? "" : (Math.round((r * minutes) / 60) / 100).toFixed(2));
    setTicked(false);
    setOver200(false);
  };
  const tickOk = cents === 0 || (ticked && (!over || over200));

  async function go(action: "pay" | "reject") {
    const r = more
      ? await press<{ status?: string; amountCents: number; rejected: boolean; paidSoFarCents?: number; later?: string }>(`/api/tests/${more.testId}/pay-extra`, {
        contractId: more.contractId, ...(p.kind === "call" ? { callId: p.id } : { submissionId: p.id }), amount, note: reason, payKey, tickedCents: ticked ? cents : null, over200: over && over200,
      }, action)
      : await press<{ status?: string; amountCents: number; rejected: boolean; paidSoFarCents?: number; later?: string }>("/api/review", {
        action, kind: p.kind, id: p.id, payKey, amount, reason, ...(isCall && rate ? { rate } : {}), tickedCents: ticked ? cents : null, over200: over && over200,
      }, action);
    if (!r) return;
    // (Batch 11) The bank wants to confirm: its pop-up, then the payment goes through, or nothing was charged (the blue notice under the button).
    let res: typeof r = r;
    if (needsBank(r)) {
      setBankErr("");
      try { res = await confirmWithBank<typeof r>(r); } catch (e) { setBankErr((e as Error).message); return; }
    }
    const r2 = res;
    await keep.clear();
    if (r2.paidSoFarCents != null) setPaidSoFar(r2.paidSoFarCents);
    setDone(r2.rejected ? "Rejected. Nothing was charged." : r2.status === "not_set_up" ? `Recorded ${money(r2.amountCents)}: payments aren't set up yet, so nothing was charged.` : `Paid ${money(r2.amountCents)}${r2.later ? ` · ${r2.later}` : ""}.`);
    setTimeout(() => window.location.reload(), 900);
  }

  return (
    <div className={`space-y-3 ${more ? "w-full rounded-lg border border-white/10 p-3" : "border-t border-white/10 pt-4"}`} data-pay-box={listed ? "listed" : "unlisted"} data-pay-more={more ? p.id : undefined}>
      <p className="text-sm">
        {more && <b className="text-white">Pay more · </b>}
        <b>{listed ? `Listing: ${p.listingText}` : NOT_LISTED}</b>
        {" "}· Paid so far for this part: {money(p.partPaidCents ?? 0)} · You&apos;ve paid {p.name} {money(paidSoFar)} so far on this test.
        {p.roomCents != null && <span className="text-slate-400" data-pay-room=""> · up to {money(p.roomCents)}{p.callPoolRoomCents != null ? ` (up to ${money(p.callPoolRoomCents)} more for unlisted calls)` : ""}</span>}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        {isCall && (
          <div>
            <label className="label" htmlFor={`rate-${p.id}`}>Rate ($/h)</label>
            <input id={`rate-${p.id}`} className="input w-24" inputMode="decimal" data-rate="" value={rate} onChange={(e) => typeRate(e.target.value)} placeholder={listed ? "" : `up to ${money(NO_LISTING_CALL_RATE_CAP_CENTS).replace(/\.00$/, "")}`}
              {...(!listed ? { "data-max": String(NO_LISTING_CALL_RATE_CAP_CENTS / 100), "data-msg": "A call that isn't listed can be paid at most $200 an hour." } : {})} />
            <span className="ml-1 text-xs text-slate-500">× {minutes} min</span>
          </div>
        )}
        <div>
          <label className="label req" htmlFor={`amt-${p.id}`}>Amount ($)</label>
          <input id={`amt-${p.id}`} className="input w-32" inputMode="decimal" data-min="0.5" data-max="999999.99" data-zero-ok="" data-msg="Pay $0.00, or at least $0.50 (the smallest card charge). Stripe can't take more than $999,999.99 in one charge." value={amount} onChange={(e) => typeAmount(e.target.value)} placeholder="0.00" />
        </div>
      </div>
      <div className="min-w-[14rem]">
        <label className={`label ${below && !more ? "req" : ""}`} htmlFor={`why-${p.id}`}>Note to {p.name}{more ? " (optional)" : below ? ` · needed to pay less than the listing's ${money(p.listingCents)}` : listed ? " (optional; needed to reject)" : " (optional)"}</label>
        <input id={`why-${p.id}`} className="input" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={listed ? "What it's missing, or a thank-you" : "A thank-you, or what the pay is for"} />
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
        <button className="btn" disabled={busy || cents == null || !tickOk || !!p.owes || (!!more && cents === 0)} onClick={(e) => checkFields(e.currentTarget.closest("div.space-y-3")) && go("pay")}>{more ? "Pay more" : "Pay"}</button>
        {listed && !more && <button className="btn-danger" disabled={busy} onClick={() => go("reject")}>Reject</button>}
        {p.owes && <span className="text-xs text-amber-200" data-owes-note="">{PAY_WAITS} <a href="#owed">Pay what you owe ↑</a></span>}
        <span className="text-xs text-slate-500">at least $0.50 (or 0)</span>
      </div>
      {(at === "pay" || at === "reject") && <ChangesBox changes={changes} error={error} />}
      {bankErr && <p className="info" data-bank-not-confirmed="">{bankErr}</p>}
      {!more && <p className="note">
        {/* (Batch 10) Every reviewed part can be disputed once, listed or not. */}
        {listed ? `Reject charges nothing. ${p.name} can dispute your decision once.` : `This part isn't listed: pay any amount, $0 included (it closes this row). It can't be rejected; ${p.name} can dispute the amount once.`}
      </p>}
      {p.note && <p className="note">{p.note}</p>}
      {error === "Pay what you owe first." && <a className="text-sm" href="#owed">Pay what you owe ↑</a>}
      {done && <p className="ok">{done}</p>}
    </div>
  );
}
