"use client";
import { CharacterCount } from "@/components/CharacterCount";
import { useEffect, useRef, useState } from "react";
import { MistakeList, checkFields } from "@/components/FieldChecks";
import { CANCEL_HOURS } from "@/lib/rules";
import { lockText } from "@/lib/sendLock";

/**
 * The full app's "Cancel ▾" on a booked call (call-tools.tsx): a small drop-down with a reason box, the button and the
 * one-line rule. Lean has one way to cancel (no "ask to cancel"): at once; a reason is needed within 24 hours of the
 * call. The press's stop-once box or refusal shows under the call's row (the caller's `box`). (Batch 16 section 10) A missing reason is red at the box,
 * with the server's own line (checkCancel), and listed under the button.
 */
export const CANCEL_REASON_LINE = "The call is less than 24 hours away: say why you're cancelling (the other side sees it).";
export function CancelMenu(p: { needsReason: boolean; busy: boolean; other: string; onCancel: (reason: string) => void; label?: string; rule?: string }) {
  const [reason, setReason] = useState("");
  // (Owner, Nov 5, §261) While THIS menu's Cancel is going through (`busy` is the whole panel's), its Why is read-only; another press in the panel leaves it be.
  const [mine, setMine] = useState(false);
  useEffect(() => { if (!p.busy) setMine(false); }, [p.busy]);
  const root = useRef<HTMLDivElement>(null);
  return (
    <details className="w-full [&:not([open])]:w-auto" data-cancel-menu="">
      <summary className="btn-secondary w-fit cursor-pointer list-none px-3 py-1 text-xs">Cancel ▾</summary>
      <div ref={root} className="mt-2 flex flex-wrap items-start gap-2" data-mistakes-root="">
        <span className="w-56">
        <input
          className="input w-full py-1 text-xs"
          placeholder={p.needsReason ? "Why? (less than 24 hours away)" : "Why (optional)"}
          aria-label="Why"
          maxLength={300}
          {...(p.needsReason ? { "data-required": "", "data-required-msg": CANCEL_REASON_LINE, "data-min-chars": "3", "data-msg": CANCEL_REASON_LINE } : {})}
          data-match="say why you're cancelling"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          {...lockText(mine && p.busy)}
        />
        <CharacterCount value={reason} min={p.needsReason ? 3 : 0} max={300} required={p.needsReason} />
        {/* (Owner, Nov 6, §293) At the field, in small grey: the reason is optional until 24 hours before the call (then required, marked as such). */}
        {!p.needsReason && <p className="mt-0.5 text-[11px] text-slate-500" data-why-optional="">Optional until {CANCEL_HOURS} hours before the call</p>}
        </span>
        <button className="btn-secondary px-3 py-1 text-xs" disabled={p.busy} onClick={() => { if (!checkFields(root.current)) return; setMine(true); p.onCancel(reason); }}>{p.label ?? "Cancel this call"}</button>
        <p className="w-full text-xs text-slate-400">
          {p.rule ?? (p.needsReason
            ? `Less than ${CANCEL_HOURS} hours ahead: say why. ${p.other} is told.`
            : `${CANCEL_HOURS} hours or more ahead: it's cancelled at once and ${p.other} is told. A reason is optional.`)}
        </p>
        <div className="w-full"><MistakeList press={p.label ?? "Cancel this call"} /></div>
      </div>
    </details>
  );
}
