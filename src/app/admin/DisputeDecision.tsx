"use client";
import { useRef, useState } from "react";
import { api, errOf } from "@/lib/client";
import { checkFields } from "@/components/FieldChecks";
import { LIMITS } from "@/lib/limits";
import { counterText, reasonTooLong } from "@/lib/rules";

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

/**
 * The admin's decision on a dispute: the total pay for THIS piece, between what it was paid (min) and the part's listing minus
 * what was already paid for that part on other pieces (max; batch 10: for an unlisted part, its max of $1000 or $200/h × the logged minutes, minus what was already paid). Blank keeps the pay as it is. Range hint next to the box,
 * red at the box when it is left with an amount outside it.
 */
export function DisputeDecision({ id, minCents, maxCents }: { id: string; minCents: number; maxCents: number }) {
  const root = useRef<HTMLDivElement>(null);
  const [total, setTotal] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div ref={root} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor={`total-${id}`}>Total pay for this piece</label>
        <span>$</span>
        <input id={`total-${id}`} className="input w-28" inputMode="decimal" aria-label="Total pay for this piece ($)" data-min={String(minCents / 100)} data-max={String(maxCents / 100)}
          data-msg={`Enter an amount from ${dollars(minCents)} to ${dollars(maxCents)}, or leave it blank to keep the pay as it is.`} value={total} onChange={(e) => setTotal(e.target.value)} />
        <span className="text-xs text-slate-500">{dollars(minCents)}-{dollars(maxCents)} · leave blank to keep it as it is</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor={`note-${id}`}>Note to both</label>
        {/* (Batch 15 section 20) Up to 1,000 characters, a live counter, red when over. */}
        <textarea id={`note-${id}`} rows={2} className={`input w-72 max-w-full ${note.length > LIMITS.reason ? "field-bad" : ""}`} value={note} onChange={(e) => setNote(e.target.value)} />
        <span className={`block text-right text-xs ${note.length > LIMITS.reason ? "text-rose-300" : "text-slate-500"}`} data-reason-count="">{counterText(note.length, LIMITS.reason)}</span>
        {note.length > LIMITS.reason && <span className="err-field">{reasonTooLong()}</span>}
        <button
          className="btn-ghost"
          disabled={busy}
          onClick={async () => {
            if (!checkFields(root.current)) return;
            setBusy(true);
            setMsg(null);
            try {
              await api("/api/admin/decide", { id, total, note });
              setMsg({ ok: true, text: "Done." });
              setTimeout(() => window.location.reload(), 600);
            } catch (e) {
              setMsg({ ok: false, text: errOf(e) });
            } finally {
              setBusy(false);
            }
          }}
        >
          Decide
        </button>
        {msg && <span className={msg.ok ? "ok" : "err"}>{msg.text}</span>}
      </div>
    </div>
  );
}
