"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, FIELD, api, errOf } from "@/lib/client";
import { checkFields } from "@/components/FieldChecks";
import { FormMistakes } from "@/components/FormMistakes";
import { LIMITS } from "@/lib/limits";
import { counterText, decideTickLabel, reasonTooLong } from "@/lib/rules";
import { DraftTag, useKept } from "@/lib/useKept";
import { adminDraftKey } from "@/lib/keptText";
import { useFinished } from "@/lib/usePress";
import { PressDone } from "@/components/PressDone";
import { ReasonQuote } from "@/components/ScrollText";

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

/**
 * (Owner, Oct 30, batch 35 §11) What Decide's draft puts back: the total and the note. The tick is never kept: a restored raise is ticked again before Decide
 * (batch 35 §1), whatever the draft holds.
 */
export const decideFromDraft = (d: Record<string, unknown>) => ({ total: typeof d.total === "string" ? d.total : "", note: typeof d.note === "string" ? d.note : "", tickedFor: null as number | null });

/**
 * The admin's decision on a dispute: the total pay for THIS piece, between what it was paid (min) and the part's listing minus
 * what was already paid for that part on other pieces (max; batch 10: for an unlisted part, its max of $1000 or $200/h × the logged minutes, minus what was already paid). Blank keeps the pay as it is. Range hint next to the box,
 * red at the box when it is left with an amount outside it.
 * (Owner, Oct 30, batch 35 §11) The total and the note are a draft ("admin:decide:<id>", admins only): "Draft" after a reload; after a sign-in the total's "Use saved"
 * puts it back to blank (keep the pay as it is) and the note's "Discard" empties it. A restored raise needs the tick again (§1: the tick is never kept). Cleared when
 * Decide goes through; a stopped or refused Decide keeps it.
 * (Owner, Oct 31, batch 35 §41) Decided: the total, the note and the tick are hidden and Decide stays greyed with "Done." until the console has loaded again.
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
  const fin = useFinished();
  // (Owner, Oct 30, batch 35 §1) A raise names what it charges in a tick next to Decide, for any amount; changing the amount unticks it.
  const typed = /^\s*\$?\d+(\.\d{1,2})?\s*$/.test(total) ? Math.round(parseFloat(total.replace("$", "")) * 100) : null;
  const extra = typed != null && typed > minCents && typed <= Math.max(minCents, maxCents) ? typed - minCents : 0;
  const [tickedFor, setTickedFor] = useState<number | null>(null);
  const ticked = extra > 0 && tickedFor === typed;
  const keep = useKept<Record<string, unknown>>(adminDraftKey("decide", id), { total, note }, total.trim() === "" && note.trim() === "", (d) => {
    const back = decideFromDraft(d);
    setTotal(back.total);
    setNote(back.note);
    setTickedFor(back.tickedFor);
  });
  return (
    <div ref={root} className="space-y-2" data-mistakes-root="">
      {/* (Batch 35 §43) The developer's side in the small quoted box. */}
      {side.text && <div data-dev-side="">Developer&apos;s side{side.at ? ` (added ${new Date(side.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })})` : ""}:<ReasonQuote text={side.text} className="mt-0.5" /></div>}
      {fin.done ? (
        <div className="flex flex-wrap items-center gap-2" data-decide-done="">
          <button className="btn-ghost" disabled>Decide</button>
          <PressDone line={fin.line} />
        </div>
      ) : <>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor={`total-${id}`}>Total pay for this piece</label>
        <span>$</span>
        <input id={`total-${id}`} className="input w-28" inputMode="decimal" data-money="" aria-label="Total pay for this piece ($)" data-min={String(minCents / 100)} data-max={String(maxCents / 100)}
          data-msg={`Enter an amount from ${dollars(minCents)} to ${dollars(maxCents)}, or leave it blank to keep the pay as it is.`} data-match="^(?!Keep it to)" value={total} onChange={(e) => setTotal(e.target.value)} />
        {/* (Owner, Oct 31, batch 35 §39) One Discard for the total and the note (nothing is saved for them): both emptied, the tick needed again. */}
        {keep.restored && (total !== "" || note !== "") && <DraftTag disabled={busy || fin.done} kind="discard" field="decide" onUseSaved={() => { setTotal(""); setNote(""); setTickedFor(null); }} />}
        <span className="text-xs text-slate-500">{dollars(minCents)}-{dollars(maxCents)} · leave blank to keep it as it is</span>
      </div>
      {/* (Batch 35 §36) As Suspend's box: the note the panel's full width, its counter under its right edge, Decide below. */}
      <div className="flex w-full flex-col items-start gap-2" data-admin-box="stacked">
        <label className="text-sm" htmlFor={`note-${id}`}>Note to both</label>
        {/* (Batch 15 section 20) Up to 1,000 characters, a live counter, red when over. */}
        <span className="flex w-full flex-col">
        <textarea id={`note-${id}`} rows={2} className={`input w-full max-w-full ${note.length > LIMITS.reason ? "field-bad" : ""}`} data-match="^Keep it to" data-red-msg={note.length > LIMITS.reason ? reasonTooLong() : undefined} value={note} onChange={(e) => setNote(e.target.value)} />
        <span className={`block text-right text-xs ${note.length > LIMITS.reason ? "text-rose-300" : "text-slate-500"}`} data-reason-count="">{counterText(note.length, LIMITS.reason)}</span>
        {note.length > LIMITS.reason && <span className="err-field">{reasonTooLong()}</span>}
        </span>
        <button
          className="btn-ghost"
          disabled={busy || (extra > 0 && !ticked)}
          onClick={async () => {
            if (!checkFields(root.current)) return;
            setBusy(true);
            setMsg(null);
            try {
              await api("/api/admin/decide", { id, total, note, seenAt: loaded, confirmed: stopped, ...(ticked ? { tickCents: extra } : {}) });
              await keep.clear();
              fin.finish("Done.", { reload: true });
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
      {extra > 0 && (
        <label className="flex items-start gap-2 text-sm" data-decide-tick="">
          <input type="checkbox" className="mt-1" checked={ticked} onChange={(e) => setTickedFor(e.target.checked ? typed : null)} />
          <span>{decideTickLabel(dev, extra, typed!)}</span>
        </label>
      )}
      </>}
      {/* (Batch 16 section 10) A mistake is red at its box and listed here. */}
      <FormMistakes text={msg && !msg.ok && msg.text.startsWith(FIELD) ? msg.text : ""} press="Decide" />
    </div>
  );
}
