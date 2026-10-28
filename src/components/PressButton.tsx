"use client";
import { ChangesBox } from "@/components/ChangesBox";
import { useState } from "react";
import { usePress } from "@/lib/usePress";
import { confirmWithBank, needsBank } from "@/lib/bankConfirm";

/**
 * One button that goes through the page's stop-once gate: the first press may stop (the box shows right under it and
 * stays live); the second goes ahead. A refusal shows in the same place.
 */
export function PressButton(p: { seenAt: string; path: string; body: Record<string, unknown>; children: React.ReactNode; className?: string; onDone?: (r: unknown) => void; before?: () => boolean; disabled?: boolean }) {
  const { press, changes, error, busy } = usePress(p.seenAt);
  const [bankErr, setBankErr] = useState("");
  return (
    <>
      <button
        className={p.className ?? "btn-ghost"}
        disabled={busy || !!p.disabled}
        onClick={async () => {
          if (p.before && !p.before()) return;
          setBankErr("");
          let r = await press(p.path, p.body);
          // (Batch 11) The bank wants to confirm (Subscribe): its pop-up first; refused, nothing was charged.
          if (needsBank(r)) {
            try { r = await confirmWithBank(r); } catch (e) { setBankErr((e as Error).message); return; }
          }
          if (r) (p.onDone ?? (() => window.location.reload()))(r);
        }}
      >
        {p.children}
      </button>
      <ChangesBox changes={changes} error={error} />
      {bankErr && <p className="info" data-bank-not-confirmed="">{bankErr}</p>}
    </>
  );
}
