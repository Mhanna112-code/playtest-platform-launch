"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client";

/** "Resend" the email confirmation link, answered in place. */
export function ResendConfirm() {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button className="btn-ghost px-3 py-1 text-xs" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          await api("/api/auth/resend", {});
          setMsg("Sent: check your inbox (and spam).");
        } catch (e) {
          setMsg(e instanceof ApiError ? e.message : "Try again in a moment.");
        } finally {
          setBusy(false);
        }
      }}>{busy ? "Sending…" : "Resend"}</button>
      {msg && <span>{msg}</span>}
    </span>
  );
}
