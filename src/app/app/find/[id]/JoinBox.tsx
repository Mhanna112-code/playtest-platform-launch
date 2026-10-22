"use client";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { api } from "@/lib/client";
import { stopBox, type StopBox } from "@/lib/topStop";

/**
 * Join or Apply to join. Stops once (box under the button) if anything about the listing changed since the page loaded;
 * the second press goes ahead on the current listing. No offers or counter-offers here.
 */
export function JoinBox(p: { testId: string; seenAt: string; mode: string; invited: boolean; application: { status: string; changed: boolean } | null }) {
  const [keepPrivate, setKeepPrivate] = useState(false);
  const [note, setNote] = useState("");
  const [box, setBox] = useState<StopBox | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  async function go(action: "join" | "apply" | "withdraw-application") {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ sessionId?: string; applied?: boolean }>(`/api/tests/${p.testId}/${action}`, { keepPrivate, note, seenAt: p.seenAt, confirmed });
      if (r.sessionId) window.location.href = `/app/sessions/${r.sessionId}`;
      else if (action === "withdraw-application") window.location.reload();
      else setDone("Application sent. You'll hear back when the developer answers.");
    } catch (e) {
      const sb = stopBox(e);
      if (sb) {
        setBox(sb);
        setConfirmed(true);
      } else setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (p.application?.status === "pending" && p.application.changed && p.mode === "anyone")
    return (
      <div className="info space-y-2">
        <p>This test changed since you applied.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={busy} onClick={() => go("join")}>Join on the current listing</button>
          <button className="btn-ghost" disabled={busy} onClick={() => go("withdraw-application")}>Withdraw application</button>
        </div>
        <ChangesBox changes={box?.changes ?? null} tail={box?.tail} />
        {err && <p className="err">{err}</p>}
      </div>
    );
  if (p.application?.status === "pending")
    return (
      <div className="space-y-2">
        <p className="info">You applied to join. You&apos;ll hear back when the developer answers.</p>
        <button className="btn-ghost" disabled={busy} onClick={() => go("withdraw-application")}>Withdraw application</button>
        {err && <p className="err">{err}</p>}
      </div>
    );
  if (p.mode === "invite" && !p.invited) return <p className="note">This test is invite only.</p>;
  const applying = p.mode === "apply";
  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <input type="checkbox" checked={keepPrivate} onChange={(e) => setKeepPrivate(e.target.checked)} /> I&apos;ll keep this build and what I see private
      </label>
      {applying && (
        <div>
          <label className="label" htmlFor="note">A note to the developer</label>
          <textarea id="note" rows={2} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      <button className="btn" disabled={busy || !!done} onClick={() => go(applying ? "apply" : "join")}>{busy ? "Sending…" : applying ? "Apply to join" : "Join this test"}</button>
      <ChangesBox changes={box?.changes ?? null} tail={box?.tail} />
      {done && <p className="ok">{done}</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
