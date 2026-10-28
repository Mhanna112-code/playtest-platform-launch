"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, FIELD, api, errOf } from "@/lib/client";
import { checkFields } from "@/components/FieldChecks";
import { FormMistakes } from "@/components/FormMistakes";
import { LIMITS } from "@/lib/limits";
import { counterText, reasonTooLong } from "@/lib/rules";

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

/**
 * The admin's decision on a dispute: the total pay for THIS piece, between what it was paid (min) and the part's listing minus
 * what was already paid for that part on other pieces (max; batch 10: for an unlisted part, its max of $1000 or $200/h × the logged minutes, minus what was already paid). Blank keeps the pay as it is. Range hint next to the box,
 * red at the box when it is left with an amount outside it.
 */
export function DisputeDecision({ id, minCents, maxCents, side: side0 = "", sideAt: sideAt0 = null, dev = "The developer" }: { id: string; minCents: number; maxCents: number; side?: string; sideAt?: string | null; dev?: string }) {
  const root = useRef<HTMLDivElement>(null);
  // (Owner, Oct 30, batch 15 section 27) The developer's side appears live ("added <time>"); a Decide pressed before reading one that arrived after the page loaded stops once.
  const loaded = useMemo(() => new Date().toISOString(), []);
  const [side, setSide] = useState({ text: side0, at: sideAt0 });
  const [stopped, setStopped] = useState(false);
  useEffect(() => {
    if (side.text) return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const r = await fetch(`/api/admin/dispute?id=${encodeURIComponent(id)}`, { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (r && r.devSide) setSide({ text: r.devSide, at: r.devSideAt });
    }, 10_000);
    return () => clearInterval(t);
  }, [id, side.text]);
  const [total, setTotal] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div ref={root} className="space-y-2" data-mistakes-root="">
      {side.text && <p data-dev-side="">Developer&apos;s side{side.at ? ` (added ${new Date(side.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })})` : ""}: “{side.text}”</p>}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor={`total-${id}`}>Total pay for this piece</label>
        <span>$</span>
        <input id={`total-${id}`} className="input w-28" inputMode="decimal" aria-label="Total pay for this piece ($)" data-min={String(minCents / 100)} data-max={String(maxCents / 100)}
          data-msg={`Enter an amount from ${dollars(minCents)} to ${dollars(maxCents)}, or leave it blank to keep the pay as it is.`} data-match="^(?!Keep it to)" value={total} onChange={(e) => setTotal(e.target.value)} />
        <span className="text-xs text-slate-500">{dollars(minCents)}-{dollars(maxCents)} · leave blank to keep it as it is</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor={`note-${id}`}>Note to both</label>
        {/* (Batch 15 section 20) Up to 1,000 characters, a live counter, red when over. */}
        <textarea id={`note-${id}`} rows={2} className={`input w-72 max-w-full ${note.length > LIMITS.reason ? "field-bad" : ""}`} data-match="^Keep it to" data-red-msg={note.length > LIMITS.reason ? reasonTooLong() : undefined} value={note} onChange={(e) => setNote(e.target.value)} />
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
              await api("/api/admin/decide", { id, total, note, seenAt: loaded, confirmed: stopped });
              setMsg({ ok: true, text: "Done." });
              setTimeout(() => window.location.reload(), 600);
            } catch (e) {
              if (e instanceof ApiError && e.code === "stop_once") {
                setStopped(true);
                if (typeof e.data.devSide === "string") setSide((s) => ({ text: e.data.devSide as string, at: s.at ?? new Date().toISOString() }));
                setMsg({ ok: false, text: `Your Decide didn't go through. ${((e.data.changes as { text: string }[]) ?? []).map((c) => c.text).join(" ")}` });
              } else setMsg({ ok: false, text: errOf(e) });
            } finally {
              setBusy(false);
            }
          }}
        >
          Decide
        </button>
        {msg && !msg.text.startsWith(FIELD) && <span className={msg.ok ? "ok" : stopped && msg.text.startsWith("Your Decide") ? "info" : "err"} data-decide-msg="">{msg.text}</span>}
      </div>
      {/* (Batch 16 section 10) A mistake is red at its box and listed here. */}
      <FormMistakes text={msg && !msg.ok && msg.text.startsWith(FIELD) ? msg.text : ""} press="Decide" />
    </div>
  );
}
