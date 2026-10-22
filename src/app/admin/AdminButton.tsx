"use client";
import { useState } from "react";
import { api, errOf } from "@/lib/client";

/** A small admin action: optional text/amount inputs, one button, the result or refusal in plain words. */
export function AdminButton({ action, id, label, fields = [], danger }: { action: string; id: string; label: string; fields?: { name: string; label: string; ph?: string }[]; danger?: boolean }) {
  const [v, setV] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {fields.map((f) => (
        <input key={f.name} aria-label={f.label} placeholder={f.ph ?? f.label} className="input w-40" value={v[f.name] ?? ""} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
      ))}
      <button
        className={danger ? "btn-danger" : "btn-ghost"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            await api(`/api/admin/${action}`, { id, ...v });
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
