"use client";
import { useState } from "react";
import { Star } from "lucide-react";
import { ChangesBox } from "@/components/ChangesBox";
import { ConfirmButton } from "@/components/ConfirmButton";
import { usePress } from "@/lib/usePress";
import { NotSentTag, useKept } from "@/lib/useKept";

/**
 * (NEWEST+5) Rate, as the full app's rating box: 1-5 and an optional note (500 max). A rating that finishes the part
 * asks first (its in-page confirm, with what it ends). Same button rules as every other: stop once under the button,
 * refusals blue, a missing rating red.
 */
export function RateBox(p: { path: string; seenAt: string; name: string; body?: Record<string, unknown>; headline: string; lines: string[]; working: boolean }) {
  const [stars, setStars] = useState("");
  const [comment, setComment] = useState("");
  const { press, changes, error, busy } = usePress(p.seenAt);
  // (NEXT-UI 10) The note typed and not sent is kept on the server ("Not sent yet").
  const keep = useKept(`rate:${p.path.replace(/[^A-Za-z0-9]+/g, "-")}${p.body?.contractId ? ":" + String(p.body.contractId) : ""}`, { comment }, comment === "", (v) => setComment(v.comment ?? ""));
  const send = async () => {
    const r = await press(p.path, { ...(p.body ?? {}), stars: stars ? Number(stars) : null, comment });
    if (r) {
      await keep.clear();
      window.location.reload();
    }
  };
  return (
    <div className="space-y-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.04] p-3 text-sm text-ink-200" id="rate">
      <p className="flex items-center gap-1.5 font-medium text-white"><Star className="h-4 w-4 text-amber-300" /> Rate {p.name}</p>
      <p className="text-xs text-ink-400">1 to 5, and a note if you like (shown without your name).{p.working ? ` ${p.headline}` : ""}</p>
      <div className="flex flex-wrap items-end gap-2">
        <select className="input w-44" value={stars} onChange={(e) => setStars(e.target.value)} aria-label="Your rating, 1 to 5">
          <option value="" disabled>Choose…</option>
          <option value="5">5 - excellent</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1 - poor</option>
        </select>
        <input className="input min-w-0 flex-1" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="A note" aria-label="A note" />
        {p.working ? (
          <ConfirmButton className="btn-secondary" disabled={busy} title="Rate and finish?" confirmLabel="Rate and finish" onConfirm={send}
            body={<>{[p.headline, ...p.lines].map((l) => <p key={l}>{l}</p>)}</>}>
            Rate and finish
          </ConfirmButton>
        ) : (
          <button className="btn-secondary" disabled={busy} onClick={send}>Rate</button>
        )}
      </div>
      {keep.restored && <p><NotSentTag /></p>}
      <ChangesBox changes={changes} error={error} />
    </div>
  );
}
