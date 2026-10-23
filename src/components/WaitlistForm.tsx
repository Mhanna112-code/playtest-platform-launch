"use client";
import { Err } from "@/components/Err";
import { useState } from "react";
import { api, errOf } from "@/lib/client";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("developer");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (done) return <p className="ok">You&apos;re on the list. We&apos;ll email you when we open.</p>;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr("");
        try {
          await api("/api/waitlist", { email, role });
          setDone(true);
        } catch (e2) {
          setErr(errOf(e2));
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className="input max-w-xs" type="email" aria-label="Email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <select className="input w-auto" aria-label="I'm a" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="developer">I make apps, games or other products</option>
        <option value="tester">I want to test and get paid</option>
        <option value="both">Both</option>
      </select>
      <button className="btn" disabled={busy}>Join the waitlist</button>
      <Err text={err} />
    </form>
  );
}
