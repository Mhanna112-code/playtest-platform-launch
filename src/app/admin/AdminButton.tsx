"use client";
import { useState } from "react";
import { FIELD, api, errOf } from "@/lib/client";
import { FormMistakes } from "@/components/FormMistakes";
import { checkFields } from "@/components/FieldChecks";
import { LIMITS } from "@/lib/limits";
import { counterText, reasonTooLong } from "@/lib/rules";

/**
 * A small admin action: optional text/amount inputs, one button, the result or refusal in plain words. `extra`: fixed values sent with the press (e.g. the side of a
 * Reinstate); `choice`: a required pick shown before the inputs (batch 15 section 16: "Developer side" or "Tester side").
 */
export function AdminButton({ action, id, label, fields = [], danger, disabled, extra = {}, choice }: { action: string; id: string; label: string; fields?: { name: string; label: string; ph?: string }[]; danger?: boolean; disabled?: boolean; extra?: Record<string, string>; choice?: { name: string; label: string; options: { value: string; label: string }[] } }) {
  const [v, setV] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-mistakes-root="">
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
          <span key={f.name} className="inline-flex flex-col">
            <textarea id={`${action}-${id}-note`} aria-label={f.label} placeholder={f.ph ?? f.label} rows={2} className={`input w-64 max-w-full ${(v[f.name] ?? "").length > LIMITS.reason ? "field-bad" : ""}`}
              {...(action === "delete-account" || action === "suspend" ? { "data-required": "", "data-required-msg": `Record why (it is kept with the ${action === "suspend" ? "suspension" : "deletion"}).`, "data-min-chars": "3", "data-msg": `Record why (it is kept with the ${action === "suspend" ? "suspension" : "deletion"}).` } : {})} data-match="record why|keep it to"
              data-red-msg={(v[f.name] ?? "").length > LIMITS.reason ? reasonTooLong() : undefined} value={v[f.name] ?? ""} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
            <span className={`text-right text-xs ${(v[f.name] ?? "").length > LIMITS.reason ? "text-rose-300" : "text-slate-500"}`} data-reason-count="">{counterText((v[f.name] ?? "").length, LIMITS.reason)}</span>
            {(v[f.name] ?? "").length > LIMITS.reason && <span className="err-field">{reasonTooLong()}</span>}
          </span>
        ) : (
          <input key={f.name} aria-label={f.label} placeholder={f.ph ?? f.label} className="input w-40" value={v[f.name] ?? ""} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
        ),
      )}
      <button
        className={danger ? "btn-danger" : "btn-ghost"}
        disabled={busy || disabled}
        onClick={async (e) => {
          if (!checkFields(e.currentTarget.parentElement)) return;
          setBusy(true);
          setMsg(null);
          try {
            await api(`/api/admin/${action}`, { id, ...extra, ...v });
            setMsg({ ok: true, text: "Done." });
            setTimeout(() => window.location.reload(), 600);
          } catch (e) {
            setMsg({ ok: false, text: errOf(e) });
          } finally {
            setBusy(false);
          }
        }}
      >
        {label}
      </button>
      {msg && !msg.text.startsWith(FIELD) && <span className={msg.ok ? "ok" : "err"}>{msg.text}</span>}
      {/* (Batch 16 section 10) A mistake is red at its box and listed here. */}
      <FormMistakes text={msg && !msg.ok && msg.text.startsWith(FIELD) ? msg.text : ""} press={label} />
    </span>
  );
}
