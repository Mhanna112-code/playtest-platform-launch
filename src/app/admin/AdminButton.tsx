"use client";
import { useState } from "react";
import { FIELD, api, errOf, isFieldError } from "@/lib/client";
import { FormMistakes } from "@/components/FormMistakes";
import { checkFields } from "@/components/FieldChecks";
import { LIMITS } from "@/lib/limits";
import { counterText, reasonTooLong } from "@/lib/rules";
import { ChangesBox } from "@/components/ChangesBox";
import { ADMIN_STOP_HEADING, useAdminStop } from "@/lib/adminStop";
import { DraftTag, useKept } from "@/lib/useKept";
import { adminDraftKey } from "@/lib/keptText";

/** (Batch 35 §11) Where a draft keeps the state it was typed for (`draftFor`). */
export const DRAFT_FOR = "_for";

/**
 * (Batch 35 §11) What an admin button's draft puts back: only its own boxes, and a side its choice still offers (a draft never adds another value to the press).
 * Null: the draft was typed for another state (`draftFor`), so nothing comes back and it goes.
 */
export function adminDraftValues(d: Record<string, unknown>, fields: { name: string }[], choice?: { name: string; options: { value: string }[] }, draftFor?: string): Record<string, string> | null {
  if (draftFor !== undefined && d[DRAFT_FOR] !== draftFor) return null;
  const out: Record<string, string> = {};
  for (const f of fields) if (typeof d[f.name] === "string") out[f.name] = d[f.name] as string;
  if (choice && typeof d[choice.name] === "string" && choice.options.some((o) => o.value === d[choice.name])) out[choice.name] = d[choice.name] as string;
  return out;
}

/**
 * A small admin action: optional text/amount inputs, one button, the result or refusal in plain words. `extra`: fixed values sent with the press (e.g. the side of a
 * Reinstate); `choice`: a required pick shown before the inputs (batch 15 section 16: "Developer side" or "Tester side"). `onRefused` (batch 17 §6): a refusal is
 * handed to the caller (which shows it and updates the account's state) instead of showing next to the button; form mistakes stay red at their box.
 * (Owner, Oct 30, batch 34 §1) `extra.since` is the page's time: when another admin changed the same thing since and the press is still possible, the server stops it once
 * and the blue box shows under the button ("Your Pause didn't go through. Since this page loaded: … Press Pause again to go ahead."); the next press goes ahead.
 * `onStop` gets the stop's data (e.g. the account's state now).
 * (Owner, Oct 30, batch 35 §11) What's typed in its boxes (a reason, a note, Extend's days; with Suspend's side choice) is a draft ("admin:<action>:<id>", admins
 * only): "Draft" after a reload, after a sign-in "Draft" with "Discard" (nothing is saved for these boxes). Cleared when the press goes through; a stopped or
 * refused press keeps it. A button with no box keeps nothing. `draftFor`: the draft is kept with that state, and a draft typed for another one is never put back (the
 * box swapped in for a new state starts empty: batch 27 section 5, batch 33 §7).
 */
export function AdminButton({ action, id, label, fields = [], danger, disabled, extra = {}, choice, onRefused, onStop, stacked = false, draftFor }: { action: string; id: string; label: string; fields?: { name: string; label: string; ph?: string }[]; danger?: boolean; disabled?: boolean; extra?: Record<string, string>; choice?: { name: string; label: string; options: { value: string; label: string }[] }; onRefused?: (e: unknown) => void; onStop?: (data: Record<string, unknown>) => void; /** (Batch 23 section 7) top to bottom, full width: the side choice, the reason box, then the button */ stacked?: boolean; /** (Batch 35 §11) the state the box belongs to (Suspend: the sides open): a draft typed for another state never comes back */ draftFor?: string }) {
  const [v, setV] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const stop = useAdminStop();
  const typedAny = fields.some((f) => (v[f.name] ?? "").trim() !== "");
  const [put, setPut] = useState(false); // a draft was put back (one for another state never is)
  const keep = useKept<Record<string, unknown>>(adminDraftKey(action, id), draftFor === undefined ? v : { ...v, [DRAFT_FOR]: draftFor }, !typedAny, (d) => {
    const back = adminDraftValues(d, fields, choice, draftFor);
    if (!back) return void keep.clear(); // typed for another state: it goes
    setV(back);
    setPut(true);
  }, fields.length === 0);
  return (
    <span className={stacked ? "flex w-full flex-col items-start gap-2" : "inline-flex flex-wrap items-center gap-2"} data-mistakes-root="">
      {choice && (
        <span className="inline-flex flex-wrap items-center gap-2" role="radiogroup" aria-label={choice.label} data-side-choice="">
          {choice.options.map((o) => (
            <label key={o.value} className="inline-flex items-center gap-1 text-sm">
              <input type="radio" name={`${action}-${id}-${choice.name}`} value={o.value} checked={v[choice.name] === o.value} onChange={() => setV({ ...v, [choice.name]: o.value })} /> {o.label}
            </label>
          ))}
        </span>
      )}
      {fields.map((f) =>
        // (Owner, Oct 30, batch 15 section 20) A reason ("note") box: up to 1,000 characters with a live counter; over it is red at the field (the server refuses it too).
        f.name === "note" ? (
          <span key={f.name} className={stacked ? "flex w-full flex-col" : "inline-flex flex-col"}>
            <textarea id={`${action}-${id}-note`} aria-label={f.label} placeholder={f.ph ?? f.label} rows={2} className={`input ${stacked ? "w-full" : "w-64"} max-w-full ${(v[f.name] ?? "").length > LIMITS.reason ? "field-bad" : ""}`}
              {...(action === "delete-account" || action === "suspend" ? { "data-required": "", "data-required-msg": `Record why (it is kept with the ${action === "suspend" ? "suspension" : "deletion"}).`, "data-min-chars": "3", "data-msg": `Record why (it is kept with the ${action === "suspend" ? "suspension" : "deletion"}).` } : {})} data-match="record why|keep it to"
              data-red-msg={(v[f.name] ?? "").length > LIMITS.reason ? reasonTooLong() : undefined} value={v[f.name] ?? ""} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
            <span className={`text-right text-xs ${(v[f.name] ?? "").length > LIMITS.reason ? "text-rose-300" : "text-slate-500"}`} data-reason-count="">{counterText((v[f.name] ?? "").length, LIMITS.reason)}</span>
            {(v[f.name] ?? "").length > LIMITS.reason && <span className="err-field">{reasonTooLong()}</span>}
          </span>
        ) : (
          <input key={f.name} aria-label={f.label} placeholder={f.ph ?? f.label} className="input w-40" value={v[f.name] ?? ""} onChange={(e) => setV({ ...v, [f.name]: e.target.value })}
            {...(f.name === "days" ? { inputMode: "numeric" as const, "data-whole": "" } : {})} />
        ),
      )}
      {keep.restored && put && typedAny && <DraftTag kind="discard" onUseSaved={keep.signedIn ? () => setV({}) : undefined} />}
      <button
        className={danger ? "btn-danger" : "btn-ghost"}
        disabled={busy || disabled}
        onClick={async (e) => {
          if (!checkFields(e.currentTarget.parentElement)) return;
          setBusy(true);
          setMsg(null);
          try {
            await api(`/api/admin/${action}`, { id, ...extra, ...v, ...stop.marks() });
            await keep.clear();
            stop.clear();
            setMsg({ ok: true, text: "Done." });
            setTimeout(() => window.location.reload(), 600);
          } catch (e) {
            if (stop.caught(e)) onStop?.((e as { data: Record<string, unknown> }).data);
            else if (onRefused && !isFieldError(e)) { stop.clear(); onRefused(e); }
            else {
              if (!isFieldError(e)) stop.clear(); // a refusal replaces the box (a form mistake keeps it)
              setMsg({ ok: false, text: errOf(e) });
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        {label}
      </button>
      {msg && !msg.text.startsWith(FIELD) && <span className={msg.ok ? "ok" : "err"}>{msg.text}</span>}
      <ChangesBox changes={stop.changes} press={label} heading={ADMIN_STOP_HEADING} />
      {/* (Batch 16 section 10) A mistake is red at its box and listed here. */}
      <FormMistakes text={msg && !msg.ok && msg.text.startsWith(FIELD) ? msg.text : ""} press={label} />
    </span>
  );
}
