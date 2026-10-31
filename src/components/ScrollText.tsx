/**
 * (Owner, Oct 30, batch 15 sections 3, 17 and 20) Long text shown in full, in a scroll box. Short text shows without a scroll bar.
 * - `ScrollText`: a question or the steps (What to do), about 6 lines tall.
 * - `ReasonQuote`: a reason or a note, italic and quoted, about 4 lines tall.
 * Plain server-safe markup (no state), usable from server and client components.
 */
export function ScrollText({ text, lines = 6, className = "", label }: { text: string; lines?: number; className?: string; label?: string }) {
  return (
    <div
      className={`max-w-full overflow-y-auto whitespace-pre-wrap break-words pr-1 [overflow-wrap:anywhere] ${className}`}
      style={{ maxHeight: `${lines * 1.5}em` }}
      tabIndex={0}
      role="region"
      aria-label={label ?? "Text"}
      data-scroll-text=""
    >
      {text}
    </div>
  );
}

export function ReasonQuote({ text, className = "" }: { text: string; className?: string }) {
  if (!text.trim()) return null;
  return (
    // (Owner, Oct 31, batch 35 §43) A long unbroken word wraps too (overflow-wrap: anywhere), never widening the page.
    <blockquote className={`min-w-0 max-w-full overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere] border-l-2 border-white/20 pl-3 italic text-slate-200 ${className}`} style={{ maxHeight: "6em" }} tabIndex={0} data-reason="">
      “{text.trim()}”
    </blockquote>
  );
}
