"use client";
import { Err } from "@/components/Err";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { PressButton } from "@/components/PressButton";
import { api, errOf, ApiError } from "@/lib/client";
import { stopBox, useStopBox } from "@/lib/topStop";

/**
 * Join or Apply to join. Stops once (box under the button) if anything about the listing changed since the page loaded;
 * the second press goes ahead on the current listing. No offers or counter-offers here.
 */
export function JoinBox(p: { testId: string; seenAt: string; mode: string; invited: boolean; inviteId?: string | null; application: { status: string; changed: boolean } | null }) {
  const [keepPrivate, setKeepPrivate] = useState(false);
  const [note, setNote] = useState("");
  const [box, setBox] = useStopBox();
  const [confirmed, setConfirmed] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [warn, setWarn] = useState("");
  const [inviteId, setInviteId] = useState(p.inviteId ?? "");

  async function go(action: "join" | "apply" | "withdraw-application", anyway = false) {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ sessionId?: string; applied?: boolean }>(`/api/tests/${p.testId}/${action}`, { keepPrivate, note, seenAt: p.seenAt, confirmed, anyway, inviteId });
      if (r.sessionId) window.location.href = `/app/sessions/${r.sessionId}`;
      else if (action === "withdraw-application") window.location.reload();
      else setDone("Application sent. You'll hear back when the developer answers.");
    } catch (e) {
      const sb = stopBox(e);
      if (sb) {
        setBox(sb);
        setConfirmed(true);
      } else if (e instanceof ApiError && e.code === "invite_replaced") {
        // The new invite is shown right here; the next press joins on it.
        setErr(`${e.message}${e.data.terms ? ` New invite: ${String(e.data.terms)}.` : ""}`);
        if (typeof e.data.newInviteId === "string") setInviteId(e.data.newInviteId);
      } else if (e instanceof ApiError && e.code === "needs") setWarn(e.message);
      else setErr(errOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (p.application?.status === "pending" && p.application.changed && p.mode !== "invite")
    return (
      <div className="info space-y-2">
        <p>This test changed since you applied.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={busy} onClick={() => go("join")}>Join on the current listing</button>
          <button className="btn-ghost" disabled={busy} onClick={() => go("withdraw-application")}>Withdraw application</button>
        </div>
        <ChangesBox changes={box?.changes ?? null} tail={box?.tail} />
        <Err text={err} />
      </div>
    );
  if (p.application?.status === "pending")
    return (
      <div className="space-y-2">
        <p className="info">You applied to join. You&apos;ll hear back when the developer answers.</p>
        <button className="btn-ghost" disabled={busy} onClick={() => go("withdraw-application")}>Withdraw application</button>
        <ChangesBox changes={box?.changes ?? null} tail={box?.tail} />
        <Err text={err} />
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
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={busy || !!done} onClick={() => go(applying ? "apply" : "join")}>{busy ? "Sending…" : applying ? "Apply to join" : "Join this test"}</button>
        {p.inviteId && !done && (
          <PressButton seenAt={p.seenAt} path={`/api/invites/${inviteId}`} body={{}} onDone={() => (window.location.href = "/app")}>No thanks</PressButton>
        )}
      </div>
      {warn && (
        <div className="info space-y-2">
          <p>{warn}</p>
          <div className="flex gap-2">
            <button className="btn" disabled={busy} onClick={() => go("join", true)}>Join anyway</button>
            <button className="btn-ghost" onClick={() => setWarn("")}>Cancel</button>
          </div>
        </div>
      )}
      <ChangesBox changes={box?.changes ?? null} tail={box?.tail} />
      {done && <p className="ok">{done}</p>}
      <Err text={err} />
    </div>
  );
}
