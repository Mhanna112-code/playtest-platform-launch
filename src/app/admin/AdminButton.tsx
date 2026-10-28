"use client";
import { useState } from "react";
import { api, errOf } from "@/lib/client";

/**
 * A small admin action: optional text/amount inputs, one button, the result or refusal in plain words. `extra`: fixed values sent with the press (e.g. the side of a
 * Reinstate); `choice`: a required pick shown before the inputs (batch 15 section 16: "Developer side" or "Tester side").
 */
export function AdminButton({ action, id, label, fields = [], danger, disabled, extra = {}, choice }: { action: string; id: string; label: string; fields?: { name: string; label: string; ph?: string }[]; danger?: boolean; disabled?: boolean; extra?: Record<string, string>; choice?: { name: string; label: string; options: { value: string; label: string }[] } }) {
  const [v, setV] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {choice && (
        <span className="inline-flex flex-wrap items-center gap-2" role="radiogroup" aria-label={choice.label} data-side-choice="">
          {choice.options.map((o) => (
            <label key={o.value} className="inline-flex items-center gap-1 text-sm">
              <input type="radio" name={`${action}-${id}-${choice.name}`} value={o.value} checked={v[choice.name] === o.value} onChange={() => setV({ ...v, [choice.name]: o.value })} /> {o.label}
            </label>
          ))}
        </span>
      )}
      {fields.map((f) => (
        <input key={f.name} aria-label={f.label} placeholder={f.ph ?? f.label} className="input w-40" value={v[f.name] ?? ""} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
      ))}
      <button
        className={danger ? "btn-danger" : "btn-ghost"}
        disabled={busy || disabled}
        onClick={async () => {
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
      {msg && <span className={msg.ok ? "ok" : "err"}>{msg.text}</span>}
    </span>
  );
}
