"use client";
import { useState } from "react";
import { api, errOf } from "@/lib/client";

/**
 * (Design doc 10) "Preview a suspension's effects": what suspending this account would do right now. (Batch 17 §6) `onLoaded` gets the Preview's time: Suspend and
 * Reinstate send it, and are refused if another admin changed that side after it. (Owner, Oct 29, batch 23 section 7) Top to bottom: the button, then its effects
 * (which tests pause, which calls are cancelled, who is affected, money waiting) full width, above the side choice, the reason box and Suspend.
 */
export function PreviewButton({ id, onLoaded }: { id: string; onLoaded?: (at: string) => void }) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [err, setErr] = useState("");
  return (
    <div className="w-full space-y-1" data-preview-block="">
      <button type="button" className="btn-ghost" onClick={() => api<{ lines: string[]; at?: string }>("/api/admin/preview-suspension", { id }).then((r) => { setErr(""); setLines(r.lines); if (r.at) onLoaded?.(r.at); }).catch((e) => setErr(errOf(e)))}>Preview suspension</button>
      {lines && (
        <ul className="note w-full list-disc space-y-0.5 rounded-lg border border-white/10 p-2 pl-6" data-preview="">
          {lines.map((l) => <li key={l} className="break-words">{l}</li>)}
        </ul>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
