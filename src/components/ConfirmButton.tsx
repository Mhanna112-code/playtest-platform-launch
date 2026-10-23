"use client";
import { useId, useRef, type ReactNode } from "react";

/**
 * The full app's in-page confirm: a button that asks first in a small dialog on the page ("Leave this test?"), then
 * presses. The press's stop-once box or refusal still shows under this button.
 */
export function ConfirmButton({ className, title, body, confirmLabel, onConfirm, disabled, before, children }: {
  className?: string;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  /** Checked first (form mistakes show red at their field): false keeps the dialog shut. */
  before?: () => boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  return (
    <>
      <button type="button" aria-haspopup="dialog" className={className} disabled={disabled} onClick={() => { if (!before || before()) dialog.current?.showModal(); }}>{children}</button>
      <dialog ref={dialog} aria-labelledby={`${id}-t`} aria-describedby={`${id}-b`}
        className="!m-auto max-h-[calc(100dvh-2rem)] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-white/15 bg-ink-900 p-5 text-left text-ink-200 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm">
        <h2 id={`${id}-t`} className="font-semibold text-white">{title}</h2>
        <div id={`${id}-b`} className="mt-2 space-y-2 text-sm text-ink-300">{body}</div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => dialog.current?.close()} autoFocus>Cancel</button>
          <button type="button" className="btn-danger px-3 py-1.5 text-sm" data-confirm={confirmLabel} onClick={() => { dialog.current?.close(); onConfirm(); }}>{confirmLabel}</button>
        </div>
      </dialog>
    </>
  );
}
