import { parseFormatted } from "@/lib/markdown";
import React from "react";

/** (Owner, Oct 29, batch 11) A written answer shown formatted: bold, italic and code blocks only, always as escaped text (no HTML, no links). */
export function Formatted({ text, className = "" }: { text: string; className?: string }) {
  const blocks = parseFormatted(text ?? "");
  return (
    <div className={`space-y-1 ${className}`} data-formatted="">
      {blocks.map((b, i) =>
        b.kind === "code" ? (
          <pre key={i} className="overflow-x-auto rounded-md bg-black/40 p-2 font-mono text-xs text-slate-200"><code>{b.text}</code></pre>
        ) : (
          <p key={i} className="whitespace-pre-wrap break-words">
            {b.runs.map((r, j) => (r.bold ? <strong key={j}>{r.text}</strong> : r.italic ? <em key={j}>{r.text}</em> : <span key={j}>{r.text}</span>))}
          </p>
        ),
      )}
    </div>
  );
}
