"use client";
import { useRef, useState } from "react";
import { Star } from "lucide-react";
import { ChangesBox } from "@/components/ChangesBox";
import { ConfirmButton } from "@/components/ConfirmButton";
import { checkFields } from "@/components/FieldChecks";
import { FormMistakes } from "@/components/FormMistakes";
import { FIELD } from "@/lib/client";
import { usePress } from "@/lib/usePress";
import { DraftTag, useKept } from "@/lib/useKept";

/**
 * (NEWEST+5) Rate, as the full app's rating box: 1-5 and an optional note (500 max). A rating that finishes the part
 * asks first (its in-page confirm, with what it ends). Same button rules as every other: stop once under the button,
 * refusals blue, a missing rating red. (Batch 16 section 10) Red at its box (the stars or the note) and listed under the button.
 * (Batch 17 section 1) `disabledLine`: something is still open (unreviewed work to charge or let go, a dispute, a review window): the button is disabled, with that one
 * short grey line under it; the page's poll updates both as things are decided. `anchor`: the box's id (a developer's page has one per tester: "rate-<contract>").
 */
export function RateBox(p: { path: string; seenAt: string; name: string; body?: Record<string, unknown>; headline: string; lines: string[]; working: boolean; disabledLine?: string; anchor?: string }) {
  const [stars, setStars] = useState("");
  const [comment, setComment] = useState("");
  const { press, changes, error, busy } = usePress(p.seenAt);
  // (NEXT-UI 10) The note typed and not sent is kept on the server ("Draft"; batch 35 §8: after signing in, with "Use saved").
  const keep = useKept(`rate:${p.path.replace(/[^A-Za-z0-9]+/g, "-")}${p.body?.contractId ? ":" + String(p.body.contractId) : ""}`, { comment }, comment === "", (v) => setComment(v.comment ?? ""));
  const box = useRef<HTMLDivElement>(null);
  const send = async () => {
    if (!checkFields(box.current)) return;
    const r = await press(p.path, { ...(p.body ?? {}), stars: stars ? Number(stars) : null, comment });
    if (r) {
      await keep.clear();
      window.location.reload();
    }
  };
  return (
    <div ref={box} className="space-y-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.04] p-3 text-sm text-ink-200" id={p.anchor ?? "rate"} data-mistakes-root="">
      <p className="flex items-center gap-1.5 font-medium text-white"><Star className="h-4 w-4 text-amber-300" /> Rate {p.name}</p>
      <p className="text-xs text-ink-400">1 to 5, and a note if you like (shown without your name).{p.working ? ` ${p.headline}` : ""}</p>
      <div className="flex flex-wrap items-end gap-2">
        <select id={`stars-${p.path.replace(/[^A-Za-z0-9]+/g, "-")}`} className="input w-44" value={stars} onChange={(e) => setStars(e.target.value)} aria-label="Your rating, 1 to 5" data-required="" data-required-msg="Choose 1 to 5 stars." data-match="stars">
          <option value="" disabled>Choose…</option>
          <option value="5">5 - excellent</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1 - poor</option>
        </select>
        <input className="input min-w-0 flex-1" maxLength={500} data-match="comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="A note" aria-label="A note" />
        {p.working ? (
          <ConfirmButton live className="btn-secondary" disabled={busy || !!p.disabledLine} title="Rate and finish?" confirmLabel="Rate and finish" onConfirm={send}
            body={<>{[p.headline, ...p.lines].map((l) => <p key={l}>{l}</p>)}</>}>
            Rate and finish
          </ConfirmButton>
        ) : (
          <button className="btn-secondary" disabled={busy || !!p.disabledLine} onClick={send}>Rate</button>
        )}
      </div>
      {p.disabledLine && <p className="text-xs text-ink-400" data-rate-disabled="">{p.disabledLine}</p>}
      {keep.restored && comment !== "" && <p><DraftTag kind="discard" onUseSaved={keep.signedIn ? () => setComment("") : undefined} /></p>}
      <ChangesBox changes={changes} error={error.startsWith(FIELD) ? "" : error} didntGo={p.working} />
      <FormMistakes text={error.startsWith(FIELD) ? error : ""} press={p.working ? "Rate and finish" : "Rate"} />
    </div>
  );
}
