import type { HTMLAttributes } from "react";
import { counterText } from "@/lib/rules";

/** A live count beside a limited field. Optional empty fields have no minimum to meet. */
export function CharacterCount({ value, count = value.length, min = 0, max, required = false, minCount = value.trim().length, className = "", ...attrs }: {
  value: string; count?: number; min?: number; max: number; required?: boolean; minCount?: number;
} & HTMLAttributes<HTMLSpanElement>) {
  const under = min > 0 && (required || value.trim() !== "") && minCount < min;
  const over = count > max;
  const bad = over || under;
  // (Owner, Nov 3) Grey while typing; under the minimum it turns red only once a save was tried (its field is marked: globals.css, [data-count-under]); over the
  // limit it's red at once. "(at least N)" shows only while the minimum isn't met yet.
  return <span {...attrs} className={`block text-right text-xs ${over ? "text-rose-300" : "text-slate-500"} ${className}`} data-character-count="" data-count-invalid={bad ? "" : undefined} data-count-under={under ? "" : undefined}>{counterText(count, max)}{under ? ` (at least ${min.toLocaleString("en-US")})` : ""}</span>;
}
