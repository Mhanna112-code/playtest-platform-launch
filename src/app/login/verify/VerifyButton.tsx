"use client";
import { useState } from "react";
import { api } from "@/lib/client";

export function VerifyButton({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true);
    setErr("");
    try {
      await api("/api/auth/verify", { token });
      window.location.href = "/app";
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <p className="note">Press the button to finish signing in on this device.</p>
      <button className="btn" onClick={go} disabled={busy}>
        {busy ? "Signing in…" : "Sign in to Playtest"}
      </button>
      {err && (
        <p className="err">
          {err} <a href="/login">Get a new link</a>
        </p>
      )}
    </div>
  );
}
