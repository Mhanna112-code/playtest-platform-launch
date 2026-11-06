"use client";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { MARKABLE } from "@/lib/markJump";
import { copyText } from "@/components/Cut";

/**
 * (Design doc 8) The tester's access key, with Copy. (Owner, Nov 6, §304) No "This key doesn't work": a tester whose key fails tells the developer in chat, and
 * the developer sends a free key in a message. A key once reported (status "broken", before §304) shows like any other.
 */
export function KeyBox({ value, fresh }: { value: string; fresh?: boolean }) {
  const [copied, setCopied] = useState<"" | "yes" | "no">("");
  return (
    // (Batch 34 §12) The "gave you an access key" line's See it jumps here (KEY_BOX_ID, marked for a moment).
    <div className={`space-y-1.5 text-sm ${MARKABLE}`} id="access-key">
      <p className="flex flex-wrap items-center gap-2 text-white">
        <KeyRound className="h-4 w-4 text-amber-300" /> <strong>Your access key:</strong>
        <code className="break-all rounded bg-white/[0.06] px-2 py-0.5 font-mono text-amber-100">{value}</code>
        {/* (Owner, Nov 3) Copy the key in one press; "Copied" for a moment (or how to copy it by hand when the browser refuses). */}
        <button type="button" className="btn-ghost px-3 py-1 text-xs" data-key-copy="" onClick={async () => { const ok = await copyText(value); setCopied(ok ? "yes" : "no"); setTimeout(() => setCopied(""), 2500); }}>
          {copied === "yes" ? "Copied" : "Copy"}
        </button>
        {copied === "no" && <span className="text-xs text-slate-400" role="status">Couldn&apos;t copy: select the key and copy it.</span>}
      </p>
      {fresh && <p className="info" role="status">The developer gave you a new access key.</p>}
    </div>
  );
}
