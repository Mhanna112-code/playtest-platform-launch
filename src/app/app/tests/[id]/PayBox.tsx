"use client";
import { useMemo, useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { money, toCents } from "@/lib/format";
import { usePress } from "@/lib/usePress";

/**
 * The one Pay box (with Reject next to it) for a piece of sent work or a held call. Beside it: the listing amount (or
 * "Not in the listing") and what this tester has been paid so far on the test. Its stop-once box sits directly under it.
 */
export function PayBox(p: { kind: "submission" | "call"; id: string; name: string; listingCents: number | null; listingText: string; paidSoFarCents: number; seenAt: string; askedCents?: number | null; partPaidCents?: number; note?: string }) {
  const start = p.askedCents ?? p.listingCents;
  const [amount, setAmount] = useState(start == null ? "" : (start / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const [ticked, setTicked] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [paidSoFar, setPaidSoFar] = useState(p.paidSoFarCents);
  const { press, changes, error, busy } = usePress(p.seenAt, (d) => typeof d.paidSoFarCents === "number" && setPaidSoFar(d.paidSoFarCents));
  const [done, setDone] = useState("");
  const payKey = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()), []);
  const cents = toCents(amount);
  const below = p.listingCents != null && cents != null && cents < p.listingCents;

  async function go(action: "pay" | "reject") {
    const r = await press<{ status?: string; amountCents: number; rejected: boolean; paidSoFarCents?: number }>("/api/review", {
      action, kind: p.kind, id: p.id, payKey, amount, reason, tickedCents: ticked ? cents : null,
    });
    if (!r) return;
    if (r.paidSoFarCents != null) setPaidSoFar(r.paidSoFarCents);
    setDone(r.rejected ? "Rejected. Nothing was charged." : r.status === "not_set_up" ? `Recorded ${money(r.amountCents)}: payments aren't set up yet, so nothing was charged.` : `Paid ${money(r.amountCents)}.`);
    setTimeout(() => window.location.reload(), 900);
  }

  return (
    <div className="space-y-2 rounded-lg bg-white/[0.03] p-3">
      <p className="text-sm">
        <b>{p.listingCents == null ? "Not in their contract" : `Listing: ${p.listingText}`}</b>
        {p.askedCents != null && <> · {p.name} asked {money(p.askedCents)}</>} · Paid so far for this part: {money(p.partPaidCents ?? 0)} · You&apos;ve paid {p.name} {money(paidSoFar)} so far on this test.
      </p>
      {!rejecting ? (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label req" htmlFor={`amt-${p.id}`}>Amount ($)</label>
            <input id={`amt-${p.id}`} className="input w-32" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setTicked(false); }} placeholder="0.00" />
          </div>
          <label className="mb-2 text-sm">
            <input type="checkbox" checked={ticked} disabled={cents == null} onChange={(e) => setTicked(e.target.checked)} /> charged now: {cents == null ? "–" : money(cents)}
          </label>
          <button className="btn-green" disabled={busy || !ticked || cents == null} onClick={() => go("pay")}>Pay</button>
          <button className="btn-ghost" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="note">Nothing is charged.{p.listingCents != null && p.listingCents > 0 ? ` It's in ${p.name}'s contract, so they can dispute this once.` : " It's not in their contract, so this is final."}</p>
          <button className="btn-danger" disabled={busy} onClick={() => go("reject")}>Reject</button>{" "}
          <button className="btn-ghost" onClick={() => setRejecting(false)}>Back to Pay</button>
        </div>
      )}
      {(below || rejecting) && (
        <div>
          <label className="label req" htmlFor={`why-${p.id}`}>{rejecting ? "Why are you rejecting it?" : `Why less than the listing's ${money(p.listingCents)}?`} ({p.name} reads it)</label>
          <textarea id={`why-${p.id}`} rows={2} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
      {p.note && <p className="note">{p.note}</p>}
      <ChangesBox changes={changes} error={error} />
      {error === "Pay what you owe first." && <a className="text-sm" href="#owed">Pay what you owe ↑</a>}
      {done && <p className="ok">{done}</p>}
    </div>
  );
}
