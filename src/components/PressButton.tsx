"use client";
import { ChangesBox } from "@/components/ChangesBox";
import { useState } from "react";
import { usePress } from "@/lib/usePress";
import { needsBank } from "@/lib/bankConfirm";
import { useBankCheck } from "@/components/BankCheck";
import { PressDone } from "@/components/PressDone";

/**
 * One button that goes through the page's stop-once gate: the first press may stop (the box shows right under it and
 * stays live); the second goes ahead. A refusal shows in the same place.
 * (Batch 35 §40, §41) Once it goes through (`onDone` first, e.g. a draft cleared), the page redraws in place and the button stays greyed with `doneLine` under it until it has.
 */
export function PressButton(p: { seenAt: string; path: string; body: Record<string, unknown>; children: React.ReactNode; className?: string; onDone?: (r: unknown) => unknown; before?: () => boolean; disabled?: boolean; /** the result line while the page redraws */ doneLine?: string; /** (batch 35 §40) the page loads again (keeping its place) instead of redrawing: a page that keeps its load time */ reload?: boolean }) {
  const { press, changes, error, busy, finish, doneLine } = usePress(p.seenAt);
  const [bankErr, setBankErr] = useState("");
  const bank = useBankCheck();
  return (
    <>
      <button
        className={p.className ?? "btn-ghost"}
        disabled={busy || bank.open || !!p.disabled}
        onClick={async () => {
          if (p.before && !p.before()) return;
          setBankErr("");
          let r = await press(p.path, p.body);
          // (Batch 11) The bank wants to confirm (Subscribe): (batch 17 §11) its check opens inline, right under this button; refused, nothing was charged.
          if (needsBank(r)) {
            try { r = await bank.check(r); } catch (e) { setBankErr((e as Error).message); return; }
          }
          if (!r) return;
          await p.onDone?.(r);
          finish(p.doneLine ?? "", { reload: p.reload });
        }}
      >
        {p.children}
      </button>
      {bank.view}
      <ChangesBox changes={changes} error={error} />
      <PressDone line={doneLine} />
      {bankErr && <p className="info" data-bank-not-confirmed="">{bankErr}</p>}
    </>
  );
}
