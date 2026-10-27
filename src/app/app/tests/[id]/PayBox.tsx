"use client";
import { useMemo, useState } from "react";
import { checkFields } from "@/components/FieldChecks";
import { ChangesBox } from "@/components/ChangesBox";
import { money, toCents } from "@/lib/format";
import { usePress } from "@/lib/usePress";
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
 */
export function PayBox(p: { kind: "submission" | "call"; id: string; name: string; listingCents: number | null; listingText: string; paidSoFarCents: number; seenAt: string; partPaidCents?: number; note?: string; owes?: boolean; minutes?: number; rateCents?: number | null }) {
  const listed = p.listingCents != null;
  const isCall = p.kind === "call";
  const start = p.listingCents;
  const [amount, setAmount] = useState(start == null ? "" : (start / 100).toFixed(2));
  const [rate, setRate] = useState(isCall && listed && p.rateCents != null ? (p.rateCents / 100).toFixed(2) : "");
  const [reason, setReason] = useState("");
  const [ticked, setTicked] = useState(false);
  const [over200, setOver200] = useState(false);
  const [paidSoFar, setPaidSoFar] = useState(p.paidSoFarCents);
  const { press, changes, error, busy, at } = usePress(p.seenAt, (d) => typeof d.paidSoFarCents === "number" && setPaidSoFar(d.paidSoFarCents));
  const [done, setDone] = useState("");
  // (NEXT-UI 10) The note typed and not sent is kept on the server ("Not sent yet").
  const keep = useKept(`reject:${p.kind}:${p.id}`, { reason }, reason === "", (v) => setReason(v.reason ?? ""));
  const payKey = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()), []);
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
    const r = await press<{ status?: string; amountCents: number; rejected: boolean; paidSoFarCents?: number; later?: string }>("/api/review", {
      action, kind: p.kind, id: p.id, payKey, amount, reason, ...(isCall && rate ? { rate } : {}), tickedCents: ticked ? cents : null, over200: over && over200,
    }, action);
    if (!r) return;
    await keep.clear();
    if (r.paidSoFarCents != null) setPaidSoFar(r.paidSoFarCents);
    setDone(r.rejected ? "Rejected. Nothing was charged." : r.status === "not_set_up" ? `Recorded ${money(r.amountCents)}: payments aren't set up yet, so nothing was charged.` : `Paid ${money(r.amountCents)}${r.later ? ` · ${r.later}` : ""}.`);
    setTimeout(() => window.location.reload(), 900);
  }

  return (
    <div className="space-y-3 border-t border-white/10 pt-4" data-pay-box={listed ? "listed" : "unlisted"}>
      <p className="text-sm">
        <b>{listed ? `Listing: ${p.listingText}` : NOT_LISTED}</b>
        {" "}· Paid so far for this part: {money(p.partPaidCents ?? 0)} · You&apos;ve paid {p.name} {money(paidSoFar)} so far on this test.
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
        <label className={`label ${below ? "req" : ""}`} htmlFor={`why-${p.id}`}>Note to {p.name}{below ? ` · needed to pay less than the listing's ${money(p.listingCents)}` : listed ? " (optional; needed to reject)" : " (optional)"}</label>
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
        <button className="btn" disabled={busy || cents == null || !tickOk || !!p.owes} onClick={(e) => checkFields(e.currentTarget.closest("div.space-y-3")) && go("pay")}>Pay</button>
        {listed && <button className="btn-danger" disabled={busy} onClick={() => go("reject")}>Reject</button>}
        {p.owes && <span className="text-xs text-amber-200" data-owes-note="">{PAY_WAITS} <a href="#owed">Pay what you owe ↑</a></span>}
        <span className="text-xs text-slate-500">at least $0.50 (or 0)</span>
      </div>
      {(at === "pay" || at === "reject") && <ChangesBox changes={changes} error={error} />}
      <p className="note">
        {listed ? `Reject charges nothing.${p.listingCents! > 0 ? ` It's in ${p.name}'s contract, so they can dispute it once.` : ""}` : "This part isn't listed: pay any amount, $0 included (it closes this row). It can't be rejected or disputed."}
      </p>
      {p.note && <p className="note">{p.note}</p>}
      {error === "Pay what you owe first." && <a className="text-sm" href="#owed">Pay what you owe ↑</a>}
      {done && <p className="ok">{done}</p>}
    </div>
  );
}
