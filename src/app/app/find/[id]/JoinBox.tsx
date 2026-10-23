"use client";
import { Err } from "@/components/Err";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { PressButton } from "@/components/PressButton";
import { api, errOf, ApiError } from "@/lib/client";
import { stopBox, useStopBox } from "@/lib/topStop";
import { useRouter } from "next/navigation";
import { GapDialog, JustUpdated, type PopupAnswer } from "@/components/GapDialog";
import { noGaps, PROFILE_COVERS, type GapAsk, type Gaps } from "@/lib/gaps";

/**
 * Join or Apply to join. Stops once (box under the button) if anything about the listing changed since the page loaded;
 * the second press goes ahead on the current listing. No offers or counter-offers here.
 */
export function JoinBox(p: { testId: string; seenAt: string; mode: string; invited: boolean; inviteId?: string | null; application: { status: string; changed: boolean } | null; missing: Gaps }) {
  const router = useRouter();
  const [keepPrivate, setKeepPrivate] = useState(false);
  const [note, setNote] = useState("");
  const [box, setBox] = useStopBox();
  // (Owner) When the box was made: the next press goes ahead only if nothing new happened since.
  const [boxAt, setBoxAt] = useState("");
  const confirmed = !!boxAt;
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  // (NEXT-UI 4b) The full app's "What this test needs" pop-up (devices and languages), and the blue notice under the
  // button when the profile covers everything by the time it is pressed.
  const [asking, setAsking] = useState<{ ask: GapAsk; gaps: Gaps } | null>(null);
  const [covered, setCovered] = useState<string | null>(null);
  const [inviteId, setInviteId] = useState(p.inviteId ?? "");

  // The pop-up's press: "Join anyway" / "Apply anyway", checked on the server against what the pop-up showed.
  async function sendFromPopup(shown: Gaps): Promise<PopupAnswer> {
    const action = applying ? "apply" : "join";
    try {
      const r = await api<{ sessionId?: string; applied?: boolean }>(`/api/tests/${p.testId}/${action}`, { keepPrivate, note, seenAt: p.seenAt, confirmed, boxAt, anyway: true, gapsShown: shown, inviteId });
      if (r.sessionId) window.location.href = `/app/sessions/${r.sessionId}`;
      else setDone("Application sent. You'll hear back when the developer answers.");
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiError && e.code === "stop_once") {
        setBoxAt(String(e.data.now ?? new Date().toISOString()));
        return { stop: ((e.data.changes as { text: string }[]) ?? []).map((c) => c.text) };
      }
      if (e instanceof ApiError && e.code === "needs" && e.data.gaps) return { gaps: e.data.gaps as Gaps };
      setErr(errOf(e));
      return { refused: true };
    }
  }
  // Join / Apply with something missing: the pop-up asks first (never a refusal). Covered by now: a notice, no pop-up.
  async function press(action: "join" | "apply") {
    setCovered(null);
    if (noGaps(p.missing)) return go(action);
    setBusy(true);
    const now = await api<{ gaps: Gaps }>(`/api/tests/${p.testId}/my-gaps`, {}).catch(() => null);
    setBusy(false);
    if (now && noGaps(now.gaps)) {
      setCovered(new Date().toISOString());
      router.refresh();
      return;
    }
    setAsking({ ask: action, gaps: now?.gaps ?? p.missing });
  }

  async function go(action: "join" | "apply" | "withdraw-application", anyway = false) {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ sessionId?: string; applied?: boolean }>(`/api/tests/${p.testId}/${action}`, { keepPrivate, note, seenAt: p.seenAt, confirmed, boxAt, anyway, inviteId });
      if (r.sessionId) window.location.href = `/app/sessions/${r.sessionId}`;
      else if (action === "withdraw-application") window.location.reload();
      else setDone("Application sent. You'll hear back when the developer answers.");
    } catch (e) {
      const sb = stopBox(e);
      if (sb) {
        setBox(sb);
        setBoxAt(sb.now);
      } else if (e instanceof ApiError && e.code === "invite_replaced") {
        // The new invite is shown right here; the next press joins on it.
        setErr(`${e.message}${e.data.terms ? ` ${String(e.data.terms)}. Press Join to join on it.` : ""}`);
        if (typeof e.data.newInviteId === "string") setInviteId(e.data.newInviteId);
      } else if (e instanceof ApiError && e.code === "needs" && e.data.gaps) setAsking({ ask: action === "apply" ? "apply" : "join", gaps: e.data.gaps as Gaps });
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
  const applying = p.mode === "apply" && !p.invited; // an invited tester just joins
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
        <button className="btn" disabled={busy || !!done} onClick={() => press(applying ? "apply" : "join")}>{busy ? "Sending…" : applying ? "Apply to join" : "Join this test"}</button>
        {p.inviteId && !done && (
          <PressButton seenAt={p.seenAt} path={`/api/invites/${inviteId}`} body={{}} onDone={() => (window.location.href = "/app")}>No thanks</PressButton>
        )}
      </div>
      {covered && (
        <p role="status" className="info"><JustUpdated at={covered} /> {PROFILE_COVERS}</p>
      )}
      {asking && (
        <GapDialog
          testId={p.testId}
          ask={asking.ask}
          initial={asking.gaps}
          send={sendFromPopup}
          onCovered={(at) => { setAsking(null); setCovered(at); router.refresh(); }}
          onClose={() => setAsking(null)}
        />
      )}
      <ChangesBox changes={box?.changes ?? null} tail={box?.tail} />
      {done && <p className="ok">{done}</p>}
      <Err text={err} />
    </div>
  );
}
