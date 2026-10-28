"use client";
import { useState, type InputHTMLAttributes } from "react";

/** Password field with a show/hide button, so people can check what they typed (as on the full Playtest Platform). (Batch 16 section 10) data-note-after: a red line goes under the box, not inside it. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative" data-note-after="">
      <input {...props} type={visible ? "text" : "password"} className="input pr-16" />
      <button type="button" onClick={() => setVisible((v) => !v)} className="absolute inset-y-0 right-0 flex w-16 items-center justify-center text-xs text-ink-400 hover:text-ink-200" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}>
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}
