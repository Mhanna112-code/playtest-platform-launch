"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { isEmail } from "@/lib/format";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState<{ email: string; devOutbox: boolean } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!isEmail(email.trim())) return setErr("Enter an email address like you@email.com.");
    setBusy(true);
    try {
      setSent(await api<{ email: string; devOutbox: boolean }>("/api/auth/request", { email: email.trim() }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <div className="space-y-2" aria-live="polite">
        <h3>Check your email</h3>
        <p className="note">
          We sent a sign-in link to <b>{sent.email}</b>. It works once and expires in 15 minutes.
        </p>
        {sent.devOutbox && (
          <p className="note">
            Dev mode: emails aren&apos;t sent. <a href="/dev/outbox">Open the dev outbox</a> to click the link.
          </p>
        )}
        <button className="btn-ghost" type="button" onClick={() => setSent(null)}>
          Use a different email
        </button>
      </div>
    );

  return (
    <form className="flex flex-wrap gap-2" onSubmit={submit} noValidate>
      <input className="input max-w-xs" type="email" placeholder="you@email.com" aria-label="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="btn" disabled={busy}>
        {busy ? "Sending…" : "Email me a link"}
      </button>
      {err && <p className="err basis-full">{err}</p>}
    </form>
  );
}
