"use client";
import Link from "next/link";
import { PAYOUT_SETUP_HINT } from "@/lib/payout";
import { NdaBox } from "@/components/NdaBox";
import { Err } from "@/components/Err";
import { MistakeList, announcePress, focusFirstMistake } from "@/components/FieldChecks";
import { useEffect, useState } from "react";
import { ChangesBox, type Change } from "@/components/ChangesBox";
import { api, errOf, ApiError } from "@/lib/client";
import { stopBox, useStopBox, type StopBox } from "@/lib/topStop";
import { LIVE_EVENT, mergeChanges, useLiveAppend, wasShownInBox } from "@/lib/live";
import { LongList } from "@/components/LongList";
import { fmtTimeIn } from "@/lib/format";
import { savedZone } from "@/components/TimeZoneSync";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { GapDialog, JustUpdated, type PopupAnswer } from "@/components/GapDialog";
import { noGaps, PROFILE_COVERS, type GapAsk, type Gaps } from "@/lib/gaps";
import { TermsAgainBox } from "@/components/TermsAgainBox";
import { TERMS_UPDATED_CODE } from "@/lib/termsOfUse";

/**
 * Join or Apply to join. Stops once (box under the button) if anything about the listing changed since the page loaded;
 * the second press goes ahead on the current listing. No offers or counter-offers here.
 */
export function JoinBox(p: { rejoin?: boolean; timeBack?: string; nda?: string; brokenKey?: boolean; testId: string; seenAt: string; mode: string; invited: boolean; inviteId?: string | null; application: { status: string; changed: boolean; kind?: string } | null; missing: Gaps; needs: { devices: string[]; languages: string[] }; devName: string; spotsLeft: number; dueIfNow: string; /** (Batch 32 §1) their payout setup isn't done: payments wait for it */ payoutHint?: boolean; /** (Batch 20 section 21) the account hasn't agreed to the current Terms */ termsAgain?: boolean }) {
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
  // (Batch 30 §8) Their application or ask changed (the page followed it live: pending, declined, closed): the "Sent." line gives way to what the page now shows.
  const appState = p.application?.status ?? "";
  useEffect(() => setDone(""), [appState]);
  // (NEXT-UI 4b) The full app's "What this test needs" pop-up (devices and languages), and the blue notice under the
  // button when the profile covers everything by the time it is pressed.
  const [asking, setAsking] = useState<{ ask: GapAsk; gaps: Gaps } | null>(null);
  const [covered, setCovered] = useState<{ at: string; ask: GapAsk } | null>(null);
  const [inviteId, setInviteId] = useState(p.inviteId ?? "");
  // (Batch 18 section 1; batch 20 section 21) The account accepted an older Terms of Use: one more required tick above the button (shown from the start; or once the
  // server says the Terms changed while the page was open), with its red line when pressed unticked.
  const [termsAsk, setTermsAsk] = useState(!!p.termsAgain);
  const [termsErr, setTermsErr] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  // (Batch 30 §12) The seen marker is the page's FIRST render in this tab (a redraw of the page never moves it; lib/client.ts adds what the top box showed).
  const [seenAt] = useState(p.seenAt);
  // (Batch 30 §11) "Changed since you opened this page", right above the button: the top box's lines as they come (newest first), until the tester presses.
  const [since, setSince] = useState<Change[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const added = ((e as CustomEvent<Change[]>).detail ?? []).filter((c) => !c.quiet && !wasShownInBox(c));
      if (!added.length) return;
      setSince((old) => mergeChanges(old, added));
      afterChanges(added);
    };
    window.addEventListener(LIVE_EVENT, on);
    return () => window.removeEventListener(LIVE_EVENT, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /**
   * (Batch 30 §12) Listing changes the page learns of (live, or in a stop box): the page redraws to the current listing (the seen marker stays: only lines it
   * showed count as seen), and an NDA change clears the NDA tick ("read and accept it again below").
   */
  function afterChanges(lines: Change[]) {
    if (lines.some((c) => c.nda)) {
      setNda(false);
      setNdaErr("");
    }
    if (lines.some((c) => c.timed)) router.refresh();
  }
  /** A stop box under the button: it takes over from the "Changed since" list. */
  function showBox(sb: StopBox) {
    setBox(sb);
    setBoxAt(sb.now);
    setSince([]);
    afterChanges(sb.changes);
  }
  useLiveAppend(!!box, (added) => {
    const newest = added.map((a) => a.at).sort().pop();
    if (newest) setBoxAt((b) => (b && b > newest ? b : newest));
  });
  /**
   * (Batch 30 §12, owner's finding) The profile now covers the test's needs: "You now meet this test's needs" shows IN ADDITION to every change the page hadn't
   * shown (the save that covered them included): those stop this press in the box under the button, and the next press goes ahead.
   */
  async function coveredNow(ask: GapAsk) {
    setCovered({ at: new Date().toISOString(), ask });
    const verb = p.rejoin && !p.invited ? "ask" : ask === "apply" ? "apply" : "join";
    const r = await api<{ changes?: Change[]; now?: string; tail?: string }>(`/api/tests/${p.testId}/my-gaps`, { seenAt, verb, ...(boxAt ? { boxAt, confirmed: true } : {}) }).catch(() => null);
    if (r?.changes?.length) showBox({ changes: r.changes, tail: r.tail ?? "Press again to go ahead.", top: false, now: r.now ?? new Date().toISOString() });
    router.refresh();
  }

  // The pop-up's press: "Join anyway" / "Apply anyway", checked on the server against what the pop-up showed.
  async function sendFromPopup(shown: Gaps): Promise<PopupAnswer> {
    const action = rejoining ? "rejoin-ask" : applying ? "apply" : "join";
    try {
      const r = await api<{ sessionId?: string; applied?: boolean }>(`/api/tests/${p.testId}/${action}`, { ndaAccepted: nda, keyStillWorks: keyWorks, note, seenAt, confirmed, boxAt, anyway: true, gapsShown: shown, inviteId, agreeTerms });
      // (Batch 26 section 13) Join anyway opens the session page (the pop-up stays meanwhile); Apply anyway and Ask to rejoin anyway stay here: the pop-up closes and the
      // done line shows.
      if (r.sessionId) {
        window.location.href = `/app/sessions/${r.sessionId}`;
        return { ok: true, moving: true };
      }
      setDone(rejoining ? "Sent. You'll hear back when the developer answers." : "Application sent. You'll hear back when the developer answers.");
      return { ok: true, moving: false };
    } catch (e) {
      if (e instanceof ApiError && e.code === "stop_once") {
        setBoxAt(String(e.data.now ?? new Date().toISOString()));
        setSince([]);
        afterChanges((e.data.changes as Change[]) ?? []);
        return { stop: (e.data.changes as Change[]) ?? [] }; // (batch 34 §14) whole lines: a listing line carries See it
      }
      if (e instanceof ApiError && e.code === "needs" && e.data.gaps) return { gaps: e.data.gaps as Gaps };
      if (e instanceof ApiError && e.code === TERMS_UPDATED_CODE) { setTermsAsk(true); setTermsErr(e.message); return { refused: true }; }
      // (Batch 32 §2; batch 34 §10, owner) Already applied in another tab: the page just redraws to the waiting view (no extra grey line under it).
      if (e instanceof ApiError && e.code === "already_waiting") { router.refresh(); return { refused: true }; }
      if (e instanceof ApiError && e.code === "invited") { setErr(e.message); router.refresh(); return { refused: true }; } // (batch 34 §16)
      setErr(errOf(e));
      return { refused: true };
    }
  }
  // Join / Apply with something missing: the pop-up asks first (never a refusal). Covered by now: a notice, no pop-up.
  async function press(action: "join" | "apply" | "rejoin-ask") {
    setCovered(null);
    setSince([]);
    if (p.nda && !nda) {
      setNdaErr("Accept the NDA to " + (action === "apply" ? "apply." : action === "rejoin-ask" ? "ask to rejoin." : "join."));
      // (Batch 16 section 10) The tick is red with its line, listed under the button, and gets the cursor.
      requestAnimationFrame(() => { const root = document.getElementById("join-card"); announcePress(root); focusFirstMistake(root); });
      return;
    }
    if (noGaps(p.missing)) return go(action);
    setBusy(true);
    const now = await api<{ gaps: Gaps }>(`/api/tests/${p.testId}/my-gaps`, {}).catch(() => null);
    setBusy(false);
    if (now && noGaps(now.gaps)) {
      await coveredNow(action === "apply" ? "apply" : "join");
      return;
    }
    setAsking({ ask: action === "apply" ? "apply" : "join", gaps: now?.gaps ?? p.missing });
  }

  async function go(action: "join" | "apply" | "rejoin-ask" | "withdraw-application", anyway = false) {
    setBusy(true);
    setErr("");
    try {
      setSince([]);
      const r = await api<{ sessionId?: string; applied?: boolean }>(`/api/tests/${p.testId}/${action}`, { ndaAccepted: nda, keyStillWorks: keyWorks, note, seenAt, confirmed, boxAt, anyway, inviteId, agreeTerms });
      if (r.sessionId) window.location.href = `/app/sessions/${r.sessionId}`;
      else if (action === "withdraw-application") window.location.reload();
      else setDone(action === "rejoin-ask" ? "Sent. You'll hear back when the developer answers." : "Application sent. You'll hear back when the developer answers.");
    } catch (e) {
      const sb = stopBox(e);
      if (e instanceof ApiError && e.code === TERMS_UPDATED_CODE) { setTermsAsk(true); setTermsErr(e.message); }
      else if (sb) showBox(sb);
      else if (e instanceof ApiError && e.code === "invite_replaced") {
        // The new invite is shown right here; the next press joins on it. (Batch 34 §10) The server's line is one whole sentence ("… sent you a new invite on it. Press
        // Join to join on it."); the page switches to the new invite and counts the refusal as seen, so the next press goes ahead without a reload.
        setErr(e.message);
        if (typeof e.data.newInviteId === "string") setInviteId(e.data.newInviteId);
        if (typeof e.data.now === "string") setBoxAt(e.data.now);
      } else if (e instanceof ApiError && e.code === "needs" && e.data.gaps) setAsking({ ask: action === "apply" ? "apply" : "join", gaps: e.data.gaps as Gaps });
      // (Batch 16 section 10) The server's "Accept the NDA to join." belongs to the tick.
      else if (e instanceof ApiError && e.code === "nda" && p.nda) { setNdaErr(e.message); requestAnimationFrame(() => { const root = document.getElementById("join-card"); announcePress(root); focusFirstMistake(root); }); }
      // (Batch 16 section 32) The invite closed meanwhile: refused with the reason (no stop box), and the page drops the invite.
      else if (e instanceof ApiError && e.code === "invite_closed") { setErr(e.message); router.refresh(); }
      else if (e instanceof ApiError && e.code === "already_waiting") router.refresh(); // (batch 34 §10) just the waiting view
      // (Batch 34 §16) Apply / Ask to rejoin on a page that already showed an invite (another tab's page): the line, and the page redraws to Join.
      else if (e instanceof ApiError && e.code === "invited") { setErr(e.message); router.refresh(); }
      else setErr(errOf(e));
    } finally {
      setBusy(false);
    }
  }

  // (Batch 34 §16, owner's finding) An invite beats a waiting application or ask: with a sent invite the page shows the invited join box (Join), never the
  // waiting view; joining closes the application as joined.
  if (p.application?.status === "pending" && p.application.changed && p.mode !== "invite" && !p.invited)
    return (
      <div className="info space-y-2">
        <p>This test changed since you applied.</p>
        {termsAsk && <TermsAgainBox agreed={agreeTerms} onAgree={setAgreeTerms} red={termsErr} />}
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={busy} onClick={() => go("join")}>Join on the current listing</button>
          <button className="btn-ghost" disabled={busy} onClick={() => go("withdraw-application")}>Withdraw application</button>
        </div>
        <ChangesBox side="tester" changes={box?.changes ?? null} tail={box?.tail} seeIt="#listing" alertsWhere="join" />
        <Err text={err} />
      </div>
    );
  if (p.application?.status === "pending" && !p.invited)
    return (
      <div className="space-y-2">
        <p className="info">{p.application.kind === "rejoin" ? "You asked to rejoin. You'll hear back when the developer answers." : "You applied to join. You'll hear back when the developer answers."}</p>
        <button className="btn-ghost" disabled={busy} onClick={() => go("withdraw-application")}>Withdraw application</button>
        <ChangesBox side="tester" changes={box?.changes ?? null} tail={box?.tail} seeIt="#listing" alertsWhere="join" />
        <Err text={err} />
      </div>
    );
  if (p.mode === "invite" && !p.invited) return <p className="note">This test is invite only.</p>;
  const rejoining = !!p.rejoin && !p.invited; // coming back is an ask the developer accepts (an invited tester just joins)
  const applying = !rejoining && p.mode === "apply" && !p.invited; // an invited tester just joins
  return (
    // The full app's join card (claim-form.tsx): the choices, the button with the spots left, and how long they'll have.
    <div className="card space-y-4" id="join-card" data-mistakes-root="">
      {p.nda && (
        <div className="space-y-2" id="nda">
          <p className="label !mb-0">The developer&apos;s NDA</p>
          <NdaBox text={p.nda} />
          <label className="flex items-center gap-2 text-sm text-white">
            <input id="nda-accept" type="checkbox" data-red-msg={ndaErr || undefined} checked={nda} onChange={(e) => { setNda(e.target.checked); if (e.target.checked) setNdaErr(""); }} onBlur={() => !nda && setNdaErr("Accept the NDA to " + (applying ? "apply." : "join."))} /> I accept this NDA
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
      {/* (Batch 30 §11) Right above the button where the tester is about to act (only the updated-Terms tick, when shown, sits between): the changes the top box got
          since the page opened, newest first (3, then "Show N more"). */}
      {since.length > 0 && !box && (
        <div className="info text-sm" role="status" data-changed-since="">
          <p className="font-medium">Changed since you opened this page</p>
          <LongList className="mt-0.5 list-disc space-y-0.5 pl-5" tall="max-h-52">
            {[...since].sort((a, b) => (a.at < b.at ? 1 : -1)).map((c) => (
              <li key={`${c.at}|${c.text}`}>{c.timed ? c.text : `${c.text} · ${fmtTimeIn(c.at, savedZone())}`}{c.timed && c.kind === "info" && <> · <a href="#listing">See it</a></>}</li>
            ))}
          </LongList>
        </div>
      )}
      {/* (Batch 20 section 21) Above the button, with the other ticks. */}
      {termsAsk && <TermsAgainBox agreed={agreeTerms} onAgree={setAgreeTerms} red={termsErr} />}
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
          onCovered={() => { const ask = asking.ask; setAsking(null); void coveredNow(ask); }}
          onClose={() => setAsking(null)}
          press={rejoining ? "Ask to rejoin" : applying ? "Apply" : "Join"}
          seeIt="#listing"
        />
      )}
      <MistakeList press={rejoining ? "Ask to rejoin" : applying ? "Apply to join" : "Join this test"} />
      <ChangesBox side="tester" changes={box?.changes ?? null} tail={box?.tail} seeIt="#listing" alertsWhere="join" press={rejoining ? "Ask to rejoin" : applying ? "Apply" : "Join"} />{/* (Batch 32 §9) the box names the press, the needs-covered path too */}
      {done && <p className="ok">{done}</p>}
      <Err text={err} />
      {rejoining ? (
        <p className="text-sm text-slate-300">If {p.devName} accepts, your session comes back on the current listing with the time you had left{p.timeBack ? `: ${p.timeBack}` : ""}.</p>
      ) : (
        // (Batch 15 section 18) Every tester gets the same days from when they join.
        <p className="text-sm text-slate-300" data-join-deadline="">Your deadline: {p.dueIfNow}</p>
      )}
      {p.payoutHint && <p className="text-sm text-slate-400" data-payout-hint="">{PAYOUT_SETUP_HINT} <Link href="/app/payments#payout" className="underline">Finish setup</Link></p>}
    </div>
  );
}
