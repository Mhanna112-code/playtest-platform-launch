"use client";
import { CharacterCount } from "@/components/CharacterCount";
import { WHY_MIN_CHARS, WHY_TOO_SHORT } from "@/lib/rules";
import { lockText } from "@/lib/sendLock";

/**
 * (Batch 15 section 22; Batch 17 §15) A required "Why?" the other side reads: End early's box, also used by Stop the test. A textarea (red at the field when
 * a press finds it empty) and the "N / 10,000" counter, red past the limit. The press stays disabled with "Say why first" until it has text (the caller's button).
 */
export function WhyBox({ id, label, placeholder, requiredMsg, match, value, onChange, max, countAttr, locked = false }: {
  id: string;
  label: string;
  placeholder: string;
  /** The server's own refusal, shown red at the field ("Say why you're ending their work (they read it)."). */
  requiredMsg: string;
  /** Which server refusals belong to this field (FormMistakes / FieldChecks). */
  match: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  /** The counter's data attribute ("data-end-count", "data-stop-count"), for checks and recordings. */
  countAttr: string;
  /** (Owner, Nov 5, §261) Its press (Stop, End their work now) is going through: the box is read-only. */
  locked?: boolean;
}) {
  return (
    <div>
      <label className="label req" htmlFor={id}>{label}</label>
      {/* (Batch 20 section 27) At least 10 characters: red "Say a little more: at least 10 characters." on leaving it or pressing. */}
      <textarea id={id} rows={3} className="input" maxLength={max} placeholder={placeholder} data-required="" data-required-msg={requiredMsg} data-min-chars={String(WHY_MIN_CHARS)} data-msg={WHY_TOO_SHORT} data-match={`${match}|say a little more`} value={value} onChange={(e) => onChange(e.target.value)} {...lockText(locked)} />
      <CharacterCount value={value} min={WHY_MIN_CHARS} max={max} required {...{ [countAttr]: "" }} />
    </div>
  );
}
