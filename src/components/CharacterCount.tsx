import type { HTMLAttributes } from "react";
import { counterText } from "@/lib/rules";

/** A live count beside a limited field. Optional empty fields have no minimum to meet. */
export function CharacterCount({ value, count = value.length, min = 0, max, required = false, minCount = value.trim().length, className = "", ...attrs }: {
  value: string; count?: number; min?: number; max: number; required?: boolean; minCount?: number;
} & HTMLAttributes<HTMLSpanElement>) {
  const under = min > 0 && (required || value.trim() !== "") && minCount < min;
  const bad = count > max || under;
  return <span {...attrs} className={`block text-right text-xs ${bad ? "text-rose-300" : "text-slate-500"} ${className}`} data-character-count="" data-count-invalid={bad ? "" : undefined}>{counterText(count, max)}{min > 0 ? ` (at least ${min.toLocaleString("en-US")})` : ""}</span>;
}
