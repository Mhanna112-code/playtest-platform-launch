"use client";

/**
 * (Batch 15 section 22; Batch 17 §15) A required "Why?" the other side reads: End early's box, also used by Stop the test. A textarea (red at the field when
 * a press finds it empty) and the "N / 10,000" counter, red past the limit. The press stays disabled with "Say why first" until it has text (the caller's button).
 */
export function WhyBox({ id, label, placeholder, requiredMsg, match, value, onChange, max, countAttr }: {
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
}) {
  return (
    <div>
      <label className="label req" htmlFor={id}>{label}</label>
      <textarea id={id} rows={3} className="input" placeholder={placeholder} data-required="" data-required-msg={requiredMsg} data-match={match} value={value} onChange={(e) => onChange(e.target.value)} />
      <p className={`text-xs ${value.length > max ? "text-rose-300" : "text-slate-500"}`} {...{ [countAttr]: "" }}>{value.length.toLocaleString("en-US")} / {max.toLocaleString("en-US")}</p>
    </div>
  );
}
