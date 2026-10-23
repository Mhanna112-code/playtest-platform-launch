"use client";
import { useState } from "react";
import { Err } from "@/components/Err";
import { PasswordInput } from "@/components/PasswordInput";
import { api, errOf } from "@/lib/client";

/** Change your password: your other devices are signed out. */
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v)]));
    setBusy(true);
    setErr("");
    setDone(false);
    try {
      await api("/api/auth/password", f);
      setDone(true);
      form.reset();
    } catch (e) {
      setErr(errOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel" onSubmit={submit} noValidate aria-label="Password">
      <h2>{hasPassword ? "Change your password" : "Choose a password"}</h2>
      {hasPassword && (
        <div>
          <label className="label req" htmlFor="current">Current password</label>
          <PasswordInput id="current" name="current" autoComplete="current-password" />
        </div>
      )}
      <div>
        <label className="label req" htmlFor="new-password">New password</label>
        <PasswordInput id="new-password" name="password" autoComplete="new-password" minLength={8} />
      </div>
      <div>
        <label className="label req" htmlFor="confirm-password">Type it again</label>
        <PasswordInput id="confirm-password" name="confirm" autoComplete="new-password" minLength={8} />
      </div>
      <p className="text-xs text-ink-500">At least 8 characters. Saving signs you out on your other devices.</p>
      <Err text={err} />
      {done && <p className="ok">Password changed. Your other devices are signed out.</p>}
      <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save the new password"}</button>
    </form>
  );
}
