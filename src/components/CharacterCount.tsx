"use client";
import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { counterText } from "@/lib/rules";

/** The field this counter belongs to is marked red (the same boxes globals.css looks at for [data-count-under]). */
const FIELD_MARKED = ':scope > .field-bad, :scope > [aria-invalid="true"], :scope > [data-note-after] .field-bad, :scope > [data-note-after] [aria-invalid="true"]';

/** A live count beside a limited field. Optional empty fields have no minimum to meet. */
export function CharacterCount({ value, count = value.length, min = 0, max, required = false, minCount = value.trim().length, className = "", ...attrs }: {
  value: string; count?: number; min?: number; max: number; required?: boolean; minCount?: number;
} & HTMLAttributes<HTMLSpanElement>) {
  const under = min > 0 && (required || value.trim() !== "") && minCount < min;
  const over = count > max;
  const bad = over || under;
  // (Owner, Nov 3) Grey while typing; under the minimum it turns red only once a save was tried (its field is marked: globals.css, [data-count-under]); over the
  // limit it's red at once. "(at least N)" shows only while the minimum isn't met yet.
  // (Owner, Nov 3, later) Once red after a save, it STAYS red while typing (even if the field's own mark clears on the first key) until the text is within its limits.
  const ref = useRef<HTMLSpanElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!bad) { setStuck(false); return; }
    const box = ref.current?.parentElement;
    if (!box) return;
    const look = () => { if (box.querySelector(FIELD_MARKED)) setStuck(true); };
    look();
    const watch = new MutationObserver(look);
    watch.observe(box, { attributes: true, subtree: true, attributeFilter: ["class", "aria-invalid"] });
    return () => watch.disconnect();
  }, [bad]);
  return <span {...attrs} ref={ref} className={`block text-right text-xs ${over || (stuck && bad) ? "text-rose-300" : "text-slate-500"} ${className}`} data-character-count="" data-count-invalid={bad ? "" : undefined} data-count-under={under ? "" : undefined} data-count-stuck={stuck && bad ? "" : undefined}>{counterText(count, max)}{under ? ` (at least ${min.toLocaleString("en-US")})` : ""}</span>;
}
