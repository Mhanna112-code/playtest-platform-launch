"use client";
import { useState } from "react";
import { Err } from "@/components/Err";
import { api, errOf } from "@/lib/client";
import { announceAuth } from "@/components/SessionWatch";

/**
 * A signed-out form (log in, sign up, forgot, reset): posts its fields as JSON; a form mistake shows red, a refusal
 * blue; on success it goes to `next` (or shows `done`).
 */
export function AuthForm(p: { announce?: "in"; path: string; extra?: Record<string, string>; next?: string; done?: React.ReactNode; submit: string; busy: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = Object.fromEntries([...new FormData(e.currentTarget).entries()].map(([k, v]) => [k, String(v)]));
    setBusy(true);
    setErr("");
    try {
      // (Batch 15 section 11) The browser's own time zone goes with sign-in and sign-up (bell lines and emails are written in it).
      let timeZone = "";
      try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""; } catch { /* unknown: UTC */ }
      await api(p.path, { ...fields, ...(p.extra ?? {}), timeZone });
      if (p.announce) announceAuth("in", p.next || "/app");
      if (p.next) window.location.href = p.next;
      else {
        setOk(true);
        setBusy(false);
      }
    } catch (e) {
      setErr(errOf(e));
      setBusy(false);
    }
  }
  if (ok && p.done) return <div className="card space-y-2">{p.done}</div>;
  return (
    <form method="post" onSubmit={onSubmit} className="card space-y-4" noValidate>
      {p.children}
      <Err text={err} />
      <button className="btn w-full" disabled={busy}>{busy ? p.busy : p.submit}</button>
      {p.footer}
    </form>
  );
}
