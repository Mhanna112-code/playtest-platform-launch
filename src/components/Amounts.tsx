import React from "react";

/** An amount as the app writes it: "$1,000.00", "$12.50", "$200.00/h", "-$5.00" (whole-dollar forms like "$10" too). */
export const AMOUNT_RE = /-?\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?(?:\/h)?/g;

/** (Owner, Nov 3, long text) The class that keeps an amount whole: one unit that never breaks over two lines. */
export const WHOLE_AMOUNT = "inline-block whitespace-nowrap";

/**
 * (Owner, Nov 3, long text) A line with every amount kept whole: each "$1,000.00" is one unit that never splits over two lines, and in a line cut with "…"
 * (truncate) an amount shows in full or not at all, never as "$1,00…". The words are unchanged (only the amounts get their own span).
 */
export function keepAmounts(text: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(AMOUNT_RE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(<span key={m.index} className={WHOLE_AMOUNT} data-amount="">{m[0]}</span>);
    last = m.index! + m[0].length;
  }
  if (!out.length) return text;
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
