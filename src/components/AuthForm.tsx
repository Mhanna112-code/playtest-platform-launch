"use client";
import { useState } from "react";
import { FormMistakes } from "@/components/FormMistakes";
import { api, errOf } from "@/lib/client";
import { announceAuth } from "@/components/SessionWatch";

/**
 * A signed-out form (log in, sign up, forgot, reset): posts its fields as JSON; a form mistake shows red, a refusal
 * blue; on success it goes to `next` (or shows `done`). (Batch 16 section 10) A mistake is red at its field (each box's data-match names the
 * server lines that belong to it) and listed under the button.
 */
export function AuthForm(p: { announce?: "in"; /** (Batch 35 §153) Sign-up: the press goes to the server even while a box here is red, so every missing part is red at once. */ allAtOnce?: boolean; path: string; extra?: Record<string, string>; next?: string; done?: React.ReactNode; submit: string; busy: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const fields: Record<string, string | string[]> = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]));
    // (Batch 35 §153) A tick list (data-list="devices"): every ticked value, as a list (none ticked: an empty list, so the server names what's missing).
    for (const el of Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-list]"))) fields[el.dataset.list!] = fd.getAll(el.dataset.list!).map(String);
    setBusy(true);
    setErr("");
    try {
      // (Batch 15 section 11) The browser's own time zone goes with sign-in and sign-up (bell lines and emails are written in it).
      let timeZone = "";
      try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""; } catch { /* unknown: UTC */ }
      const r = await api<{ sameAccount?: boolean }>(p.path, { ...fields, ...(p.extra ?? {}), timeZone });
      const next = p.next && r?.sameAccount === false ? "/app" : p.next;
      if (p.announce) announceAuth("in", next || "/app");
      if (next) window.location.href = next;
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
    <form method="post" onSubmit={onSubmit} className="card space-y-4" noValidate {...(p.allAtOnce ? { "data-red-and-blue": "" } : {})}>
      {p.children}
      <button className="btn w-full" disabled={busy}>{busy ? p.busy : p.submit}</button>
      <FormMistakes text={err} press={p.submit} />
      {p.footer}
    </form>
  );
}
