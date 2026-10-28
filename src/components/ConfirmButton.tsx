"use client";
import { useId, useRef, useState, type ReactNode } from "react";
import { LiveNotices } from "@/components/LiveNotices";

/**
 * The full app's in-page confirm: a button that asks first in a small dialog on the page ("Leave this test?"), then
 * presses. The press's stop-once box or refusal still shows under this button.
 */
export function ConfirmButton({ className, title, body, confirmLabel, onConfirm, disabled, before, live, confirmDisabled, confirmHint, children }: {
  className?: string;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  /** Checked first (form mistakes show red at their field): false keeps the dialog shut. */
  before?: () => boolean;
  /** (Owner, Oct 26) Show live blue notices inside the dialog while it is open (Stop, End early). */
  live?: boolean;
  /** (Batch 17 §15) The dialog's own confirm stays disabled until the dialog's form is ready (Stop's "Why?"), with this short grey line over it ("Say why first"). */
  confirmDisabled?: boolean;
  confirmHint?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-haspopup="dialog" className={className} disabled={disabled} onClick={() => { if (!before || before()) { setOpen(true); dialog.current?.showModal(); } }}>{children}</button>
      <dialog ref={dialog} onClose={() => setOpen(false)} aria-labelledby={`${id}-t`} aria-describedby={`${id}-b`}
        className="!m-auto max-h-[calc(100dvh-2rem)] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-white/15 bg-ink-900 p-5 text-left text-ink-200 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm">
        <h2 id={`${id}-t`} className="font-semibold text-white">{title}</h2>
        <div id={`${id}-b`} className="mt-2 space-y-2 text-sm text-ink-300">{body}</div>
        {live && <div className="mt-3"><LiveNotices open={open} /></div>}
        {confirmDisabled && confirmHint && <p className="mt-3 text-right text-xs text-slate-400" data-say-why="">{confirmHint}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => dialog.current?.close()} autoFocus>Cancel</button>
          <button type="button" className="btn-danger px-3 py-1.5 text-sm" data-confirm={confirmLabel} disabled={confirmDisabled} onClick={() => { dialog.current?.close(); onConfirm(); }}>{confirmLabel}</button>
        </div>
      </dialog>
    </>
  );
}
