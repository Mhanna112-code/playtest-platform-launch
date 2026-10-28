"use client";
import { Err } from "@/components/Err";
import { useState } from "react";
import { ChangesBox } from "@/components/ChangesBox";
import { api, errOf, ApiError } from "@/lib/client";
import { stopBox, useStopBox } from "@/lib/topStop";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { GapDialog, JustUpdated, type PopupAnswer } from "@/components/GapDialog";
import { noGaps, PROFILE_COVERS, type GapAsk, type Gaps } from "@/lib/gaps";

/**
 * Join or Apply to join. Stops once (box under the button) if anything about the listing changed since the page loaded;
 * the second press goes ahead on the current listing. No offers or counter-offers here.
 */
export function JoinBox(p: { rejoin?: boolean; timeBack?: string; nda?: string; brokenKey?: boolean; testId: string; seenAt: string; mode: string; invited: boolean; inviteId?: string | null; application: { status: string; changed: boolean; kind?: string } | null; missing: Gaps; needs: { devices: string[]; languages: string[] }; devName: string; spotsLeft: number; dueIfNow: string }) {
  const router = useRouter();
  // (Design doc 7.3) The NDA is accepted before joining or applying; a returning tester says whether the key they had works again.
  const [nda, setNda] = useState(false);
  const [ndaErr, setNdaErr] = useState("");
  const [keyWorks, setKeyWorks] = useState(false);
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
  const [covered, setCovered] = useState<{ at: string; ask: GapAsk } | null>(null);
  const [inviteId, setInviteId] = useState(p.inviteId ?? "");

  // The pop-up's press: "Join anyway" / "Apply anyway", checked on the server against what the pop-up showed.
  async function sendFromPopup(shown: Gaps): Promise<PopupAnswer> {
    const action = rejoining ? "rejoin-ask" : applying ? "apply" : "join";
    try {
      const r = await api<{ sessionId?: string; applied?: boolean }>(`/api/tests/${p.testId}/${action}`, { ndaAccepted: nda, keyStillWorks: keyWorks, note, seenAt: p.seenAt, confirmed, boxAt, anyway: true, gapsShown: shown, inviteId });
      if (r.sessionId) window.location.href = `/app/sessions/${r.sessionId}`;
      else setDone(rejoining ? "Sent. You'll hear back when the developer answers." : "Application sent. You'll hear back when the developer answers.");
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
  async function press(action: "join" | "apply" | "rejoin-ask") {
    setCovered(null);
    if (p.nda && !nda) {
      setNdaErr("Accept the NDA to " + (action === "apply" ? "apply." : action === "rejoin-ask" ? "ask to rejoin." : "join."));
      document.getElementById("nda-accept")?.focus();
      return;
    }
    if (noGaps(p.missing)) return go(action);
    setBusy(true);
    const now = await api<{ gaps: Gaps }>(`/api/tests/${p.testId}/my-gaps`, {}).catch(() => null);
    setBusy(false);
    if (now && noGaps(now.gaps)) {
      setCovered({ at: new Date().toISOString(), ask: action === "apply" ? "apply" : "join" });
      router.refresh();
      return;
    }
    setAsking({ ask: action === "apply" ? "apply" : "join", gaps: now?.gaps ?? p.missing });
  }

  async function go(action: "join" | "apply" | "rejoin-ask" | "withdraw-application", anyway = false) {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ sessionId?: string; applied?: boolean }>(`/api/tests/${p.testId}/${action}`, { ndaAccepted: nda, keyStillWorks: keyWorks, note, seenAt: p.seenAt, confirmed, boxAt, anyway, inviteId });
      if (r.sessionId) window.location.href = `/app/sessions/${r.sessionId}`;
      else if (action === "withdraw-application") window.location.reload();
      else setDone(action === "rejoin-ask" ? "Sent. You'll hear back when the developer answers." : "Application sent. You'll hear back when the developer answers.");
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
        <p className="info">{p.application.kind === "rejoin" ? "You asked to rejoin. You'll hear back when the developer answers." : "You applied to join. You'll hear back when the developer answers."}</p>
        <button className="btn-ghost" disabled={busy} onClick={() => go("withdraw-application")}>Withdraw application</button>
        <ChangesBox changes={box?.changes ?? null} tail={box?.tail} />
        <Err text={err} />
      </div>
    );
  if (p.mode === "invite" && !p.invited) return <p className="note">This test is invite only.</p>;
  const rejoining = !!p.rejoin && !p.invited; // coming back is an ask the developer accepts (an invited tester just joins)
  const applying = !rejoining && p.mode === "apply" && !p.invited; // an invited tester just joins
  return (
    // The full app's join card (claim-form.tsx): the choices, the button with the spots left, and how long they'll have.
    <div className="card space-y-4">
      {p.nda && (
        <div className="space-y-2" id="nda">
          <p className="label !mb-0">The developer&apos;s NDA</p>
          <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-ink-950/60 p-3 text-sm text-slate-300" tabIndex={0}>{p.nda}</div>
          <label className="flex items-center gap-2 text-sm text-white">
            <input id="nda-accept" type="checkbox" checked={nda} onChange={(e) => { setNda(e.target.checked); if (e.target.checked) setNdaErr(""); }} onBlur={() => !nda && setNdaErr("Accept the NDA to " + (applying ? "apply." : "join."))} /> I accept this NDA
          </label>
          {ndaErr && <p className="err-field" role="alert">{ndaErr}</p>}
        </div>
      )}
      {p.brokenKey && (
        <label className="flex items-center gap-2 text-sm text-white">
          <input type="checkbox" checked={keyWorks} onChange={(e) => setKeyWorks(e.target.checked)} /> The access key I had before works again (otherwise you get a new one)
        </label>
      )}
      {(applying || rejoining) && (
        <div>
          <label className="label" htmlFor="note">A note to the developer{rejoining ? " (optional)" : ""}</label>
          <textarea id="note" rows={2} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn" disabled={busy || !!done} onClick={() => press(rejoining ? "rejoin-ask" : applying ? "apply" : "join")}><UserPlus className="h-4 w-4" /> {busy ? (applying || rejoining ? "Sending…" : "Joining…") : rejoining ? "Ask to rejoin" : applying ? "Apply to join" : "Join this test"}</button>
        <span className="text-sm text-slate-400">{p.spotsLeft} spot{p.spotsLeft === 1 ? "" : "s"} left{(applying || rejoining) && " · the developer accepts"}</span>
      </div>
      {covered && (
        <p role="status" className="info"><JustUpdated at={covered.at} /> You now meet this test&apos;s needs. Press {covered.ask === "apply" ? "Apply" : "Join"} to {covered.ask === "apply" ? "apply" : "join"}.</p>
      )}
      {asking && (
        <GapDialog
          testId={p.testId}
          ask={asking.ask}
          initial={asking.gaps}
          needs={p.needs}
          devName={p.devName}
          send={sendFromPopup}
          onCovered={(at) => { setCovered({ at, ask: asking.ask }); setAsking(null); router.refresh(); }}
          onClose={() => setAsking(null)}
        />
      )}
      <ChangesBox changes={box?.changes ?? null} tail={box?.tail} />
      {done && <p className="ok">{done}</p>}
      <Err text={err} />
      {rejoining ? (
        <p className="text-sm text-slate-300">If {p.devName} accepts, your session comes back on the current listing with the time you had left{p.timeBack ? `: ${p.timeBack}` : ""}.</p>
      ) : (
        // (Batch 12 section 6) Every tester's deadline is Open until.
        <p className="text-sm text-slate-300" data-join-deadline="">Your deadline: {p.dueIfNow}</p>
      )}
    </div>
  );
}
