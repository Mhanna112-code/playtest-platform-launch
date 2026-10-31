"use client";
import { useState } from "react";
import { FIELD, api, errOf } from "@/lib/client";
import { FormMistakes } from "@/components/FormMistakes";
import { LIMITS } from "@/lib/limits";
import { counterText, reasonTooLong } from "@/lib/rules";
import { TEAM_CLOSE_REASON } from "@/lib/moneyLines";
import { ChangesBox } from "@/components/ChangesBox";
import { ADMIN_STOP_HEADING, useAdminStop } from "@/lib/adminStop";
import { DraftTag, useKept } from "@/lib/useKept";
import { adminDraftKey } from "@/lib/keptText";

type Preview = { line: string; lines: string[]; pieces: { kind: string; id: string }[]; at: string };

/**
 * (Owner, Oct 29, batch 30 §5) The team closes a developer's open reviews at $0: on the developer's admin box ("Close all open reviews for $0") and on a test's
 * ("Close this test's open reviews for $0"). Top to bottom like Suspend's: Preview and its list, then the required reason (5 to 1,000 characters; testers read it),
 * then the button. Close sends the Preview's list: anything settled since is left alone, and the result says so.
 * (Owner, Oct 30, batch 34 §1) Close also sends the Preview's time: another admin suspended or reinstated the developer since, it stops once (the box under it).
 * (Owner, Oct 30, batch 35 §11) The reason is a draft ("admin:team-close-<scope>:<id>", admins only): "Draft" after a reload (beside Preview until the box shows),
 * after a sign-in "Draft" with "Discard". Cleared when Close goes through; a stopped or refused Close keeps it.
 */
export function TeamCloseBox({ id, scope }: { id: string; scope: "developer" | "test" }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const stop = useAdminStop();
  const label = scope === "developer" ? "Close all open reviews for $0" : "Close this test's open reviews for $0";
  const short = reason.trim().length < 5;
  const long = reason.length > LIMITS.reason;
  const keep = useKept<{ reason?: unknown }>(adminDraftKey(`team-close-${scope}`, id), { reason }, reason.trim() === "", (d) => setReason(typeof d.reason === "string" ? d.reason : ""));
  const boxShown = !!preview && preview.pieces.length > 0;
  const tag = keep.restored && reason !== "" ? <DraftTag kind="discard" onUseSaved={keep.signedIn ? () => setReason("") : undefined} /> : null;
  const load = () => api<Preview>("/api/admin/preview-team-close", { id, scope }).then((r) => { setMsg(null); setPreview(r); }).catch((e) => setMsg({ ok: false, text: errOf(e) }));
  return (
    <div className="flex w-full max-w-xl flex-col items-start gap-2" data-team-close={scope} data-mistakes-root="">
      <span className="inline-flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost" onClick={load}>Preview: {label.replace(/^Close/, "close")}</button>
        {!boxShown && tag}
      </span>
      {preview && (
        <div className="note w-full space-y-1 rounded-lg border border-white/10 p-2" data-team-close-preview="">
          <p>{preview.line}</p>
          {preview.lines.length > 0 && <ul className="max-h-60 list-disc space-y-0.5 overflow-y-auto pl-5">{preview.lines.map((l, i) => <li key={i} className="break-words">{l}</li>)}</ul>}
        </div>
      )}
      {preview && boxShown && (
        <>
          {tag}
          <span className="flex w-full flex-col">
            <textarea id={`team-close-${scope}-${id}`} aria-label="Why (the testers read it)" placeholder="Why (the testers read it)" rows={2} className={`input w-full ${long ? "field-bad" : ""}`}
              data-required="" data-required-msg={TEAM_CLOSE_REASON} data-min-chars="5" data-msg={TEAM_CLOSE_REASON} data-match="why the team closes|keep it to" data-red-msg={long ? reasonTooLong() : undefined}
              value={reason} onChange={(e) => setReason(e.target.value)} />
            <span className={`text-right text-xs ${long ? "text-rose-300" : "text-slate-500"}`} data-reason-count="">{counterText(reason.length, LIMITS.reason)}</span>
          </span>
          <button
            type="button"
            className="btn-danger"
            disabled={busy || short || long}
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                const r = await api<{ line: string }>("/api/admin/team-close", { id, scope, reason, pieces: preview.pieces, at: preview.at, since: preview.at, ...stop.marks() });
                await keep.clear();
                stop.clear();
                setMsg({ ok: true, text: `${r.line}.` });
                setPreview(null);
                setReason("");
              } catch (e) {
                if (!stop.caught(e)) {
                  stop.clear();
                  setMsg({ ok: false, text: errOf(e) });
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            {label}
          </button>
          <ChangesBox changes={stop.changes} press={label} heading={ADMIN_STOP_HEADING} />
        </>
      )}
      {msg && !msg.text.startsWith(FIELD) && <p className={msg.ok ? "ok" : "err"} data-team-close-result="">{msg.text}</p>}
      <FormMistakes text={msg && !msg.ok && msg.text.startsWith(FIELD) ? msg.text : ""} press={label} />
    </div>
  );
}
