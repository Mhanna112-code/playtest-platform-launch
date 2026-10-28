"use client";
import { useState } from "react";
import { FormMistakes } from "@/components/FormMistakes";
import { PasswordInput } from "@/components/PasswordInput";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { api, ApiError, errOf } from "@/lib/client";
import { mergeChanges } from "@/lib/live";

/**
 * Change your password: your other devices are signed out. (Batch 16 section 10) A mistake is red at its box and listed under the button.
 * (Owner, Oct 28, batch 16 section 27) Changed in another tab or device since the page opened (e.g. the password): the first press stops once with what
 * changed, keeping what was typed; the second goes ahead.
 */
export function PasswordForm({ hasPassword, seenAt: seen0 }: { hasPassword: boolean; seenAt?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [seenAt] = useState(seen0 ?? "");
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [boxAt, setBoxAt] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v)]));
    setBusy(true);
    setErr("");
    setDone(false);
    try {
      await api("/api/auth/password", { ...f, ...(seenAt ? { seenAt, confirmed: changes != null, ...(changes != null && boxAt ? { boxAt } : {}) } : {}) });
      setChanges(null);
      setDone(true);
      form.reset();
    } catch (e) {
      if (e instanceof ApiError && e.code === "stop_once") {
        setChanges((c) => (c ? mergeChanges(c, (e.data.changes as Change[]) ?? []) : ((e.data.changes as Change[]) ?? [])));
        if (typeof e.data.now === "string") setBoxAt(e.data.now);
      } else setErr(errOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card space-y-5" onSubmit={submit} noValidate aria-label="Password">
      <h2 className="font-semibold text-white">{hasPassword ? "Change your password" : "Choose a password"}</h2>
      {hasPassword && (
        <div>
          <label className="label req" htmlFor="current">Current password</label>
          <PasswordInput id="current" name="current" autoComplete="current-password" data-match="current password" />
        </div>
      )}
      <div>
        <label className="label req" htmlFor="new-password">New password</label>
        <PasswordInput id="new-password" name="password" autoComplete="new-password" minLength={8} data-required="" data-required-msg="Use at least 8 characters" data-min-chars="8" data-msg="Use at least 8 characters" data-match="at least 8|200 characters" />
      </div>
      <div>
        <label className="label req" htmlFor="confirm-password">Type it again</label>
        <PasswordInput id="confirm-password" name="confirm" autoComplete="new-password" minLength={8} data-match="don't match" />
      </div>
      <p className="text-xs text-slate-500">At least 8 characters. Saving signs you out on your other devices.</p>
      {done && <p className="text-emerald-300">Password changed. Your other devices are signed out.</p>}
      <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save the new password"}</button>
      <ChangesBox changes={changes} press="Save the new password" />
      <FormMistakes text={err} press="Save the new password" />
    </form>
  );
}
