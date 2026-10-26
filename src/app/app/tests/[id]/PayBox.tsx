"use client";
import { useMemo, useState } from "react";
import { checkFields } from "@/components/FieldChecks";
import { ChangesBox } from "@/components/ChangesBox";
import { money, toCents } from "@/lib/format";
import { usePress } from "@/lib/usePress";
import { NotSentTag, useKept } from "@/lib/useKept";

/**
 * The one Pay box (with Reject next to it) for a piece of sent work or a held call. Beside it: the listing amount (or
 * "Not in the listing") and what this tester has been paid so far on the test. Its stop-once box sits directly under it.
 */
export function PayBox(p: { kind: "submission" | "call"; id: string; name: string; listingCents: number | null; listingText: string; paidSoFarCents: number; seenAt: string; partPaidCents?: number; note?: string }) {
  const start = p.listingCents; // always the listing (or the call's agreed rate × length); the developer may pay more
  const [amount, setAmount] = useState(start == null ? "" : (start / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const [ticked, setTicked] = useState(false);
  const [paidSoFar, setPaidSoFar] = useState(p.paidSoFarCents);
  const { press, changes, error, busy, at } = usePress(p.seenAt, (d) => typeof d.paidSoFarCents === "number" && setPaidSoFar(d.paidSoFarCents));
  const [done, setDone] = useState("");
  // (NEXT-UI 10) The reject reason typed and not sent is kept on the server ("Not sent yet").
  const keep = useKept(`reject:${p.kind}:${p.id}`, { reason }, reason === "", (v) => setReason(v.reason ?? ""));
  const payKey = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()), []);
  const cents = toCents(amount);
  const below = p.listingCents != null && cents != null && cents < p.listingCents;

  async function go(action: "pay" | "reject") {
    const r = await press<{ status?: string; amountCents: number; rejected: boolean; paidSoFarCents?: number; later?: string }>("/api/review", {
      action, kind: p.kind, id: p.id, payKey, amount, reason, tickedCents: ticked ? cents : null,
    }, action);
    if (!r) return;
    await keep.clear();
    if (r.paidSoFarCents != null) setPaidSoFar(r.paidSoFarCents);
    setDone(r.rejected ? "Rejected. Nothing was charged." : r.status === "not_set_up" ? `Recorded ${money(r.amountCents)}: payments aren't set up yet, so nothing was charged.` : `Paid ${money(r.amountCents)}${r.later ? ` · ${r.later}` : ""}.`);
    setTimeout(() => window.location.reload(), 900);
  }

  // The full app's pattern: the reason box sits with Reject; one press on Reject rejects (stop once); no mode switch.
  return (
    <div className="space-y-3 border-t border-white/10 pt-4">
      <p className="text-sm">
        <b>{p.listingCents == null ? "Not in their contract" : `Listing: ${p.listingText}`}</b>
        {" "}· Paid so far for this part: {money(p.partPaidCents ?? 0)} · You&apos;ve paid {p.name} {money(paidSoFar)} so far on this test.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label req" htmlFor={`amt-${p.id}`}>Amount ($)</label>
          <input id={`amt-${p.id}`} className="input w-32" inputMode="decimal" data-min="0.5" data-max="999999.99" data-zero-ok="" data-msg="Pay $0.00, or at least $0.50 (the smallest card charge). Stripe can't take more than $999,999.99 in one charge." value={amount} onChange={(e) => { setAmount(e.target.value); setTicked(false); }} placeholder="0.00" />
        </div>
        <label className="mb-2 flex items-center gap-2 text-sm text-ink-200">
          <input type="checkbox" checked={ticked} disabled={cents == null} onChange={(e) => setTicked(e.target.checked)} /> charged now: {cents == null ? "–" : money(cents)}
        </label>
        <button className="btn" disabled={busy || !ticked || cents == null} onClick={(e) => checkFields(e.currentTarget.closest("div.space-y-3")) && go("pay")}>Pay</button>
        <span className="text-xs text-slate-500">at least $0.50 (or 0)</span>
      </div>
      {at === "pay" && <ChangesBox changes={changes} error={error} />}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <label className={`label ${below ? "req" : ""}`} htmlFor={`why-${p.id}`}>Why (the tester sees it){below ? ` · needed to pay less than the listing's ${money(p.listingCents)}` : " · needed to reject"}</label>
          <input id={`why-${p.id}`} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What it's missing" />
        </div>
        <button className="btn-danger" disabled={busy} onClick={() => go("reject")}>Reject</button>
        {keep.restored && <NotSentTag />}
      </div>
      {at === "reject" && <ChangesBox changes={changes} error={error} />}
      <p className="note">Reject charges nothing.{p.listingCents != null && p.listingCents > 0 ? ` It's in ${p.name}'s contract, so they can dispute it once.` : " It's not in their contract, so it's final."}</p>
      {p.note && <p className="note">{p.note}</p>}
      {error === "Pay what you owe first." && <a className="text-sm" href="#owed">Pay what you owe ↑</a>}
      {done && <p className="ok">{done}</p>}
    </div>
  );
}
