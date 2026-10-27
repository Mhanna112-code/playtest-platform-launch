/**
 * (Owner, Oct 29, batch 11) Written answers can use three formats, stored as Markdown: **bold**, *italic* and ``` code blocks ```. Nothing else is read as formatting:
 * no HTML, no links (a URL stays plain text), so what a tester types can never run in the developer's page. `parseFormatted` turns the text into blocks of
 * runs; the Formatted component renders them as React text (always escaped).
 */
export type Run = { text: string; bold?: boolean; italic?: boolean };
export type Block = { kind: "code"; text: string } | { kind: "text"; runs: Run[] };

const INLINE = /(\*\*[^*\n]+?\*\*|\*[^*\n]+?\*)/g;

function runsOf(text: string): Run[] {
  const out: Run[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    const t = m[0];
    out.push(t.startsWith("**") ? { text: t.slice(2, -2), bold: true } : { text: t.slice(1, -1), italic: true });
    last = m.index! + t.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function parseFormatted(src: string): Block[] {
  const blocks: Block[] = [];
  const parts = src.split(/```/);
  parts.forEach((p, i) => {
    // Odd pieces sit between fences (an unclosed fence runs to the end).
    if (i % 2 === 1) blocks.push({ kind: "code", text: p.replace(/^[^\n]*\n/, (first) => (first.trim() ? first : "")).replace(/\n$/, "") });
    else if (p) blocks.push({ kind: "text", runs: runsOf(p) });
  });
  return blocks;
}

/** The toolbar's three formats: wrap the selection (or insert a placeholder) in a textarea's value. */
export function wrapSelection(value: string, start: number, end: number, kind: "bold" | "italic" | "code") {
  const sel = value.slice(start, end);
  const [open, close, ph] = kind === "bold" ? ["**", "**", "bold text"] : kind === "italic" ? ["*", "*", "italic text"] : ["```\n", "\n```", "code"];
  const inner = sel || ph;
  const next = value.slice(0, start) + open + inner + close + value.slice(end);
  return { value: next, start: start + open.length, end: start + open.length + inner.length };
}
