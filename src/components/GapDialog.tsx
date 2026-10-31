"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Languages, RefreshCw } from "lucide-react";
import { api } from "@/lib/client";
import { noGaps, sameGaps, TESTER_ASK, testerGapButton, testerGapText, type GapAsk, type Gaps } from "@/lib/gaps";
import { MissingNeedWords } from "@/components/MissingNeeds";
import { seeItClick } from "@/components/ListingInfo";
import type { Change } from "@/components/ChangesBox";

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** The full app's blue-notice label: a small round "updated" badge, then "Just updated (2:41 PM):" in bold. */
export function JustUpdated({ at }: { at: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <span aria-hidden className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-sky-300/60 bg-sky-400/15">
        <RefreshCw className="h-4 w-4 text-sky-300" />
      </span>
      <strong className="font-semibold text-sky-50">Just updated ({clock(at)}):</strong>
    </span>
  );
}

/**
 * The pop-up's press answered. (Owner, Oct 29, batch 26 section 13) `ok` with `moving`: the page is going elsewhere (Join anyway opens the session page), so the pop-up
 * stays as it is; `ok` without it (Apply anyway, Ask to rejoin anyway: the page stays): the pop-up closes and the page shows its done line ("Sent. You'll hear back…").
 */
export type PopupAnswer = { ok: true; moving?: boolean } | { stop: Change[]; gaps?: undefined } | { gaps: Gaps; stop?: undefined } | { refused: true };
/** (Batch 26 section 13) What the pop-up does after a press went through: stay while the page moves on, else close. */
export const afterSent = (r: { ok: true; moving?: boolean }) => (r.moving ? "stay" : "close");

/**
 * The full app's "What this test needs" pop-up (claim-form.tsx / useLanguageGate): opens when Join / Apply is pressed
 * and the profile misses a device or language the test needs. It lists every unmet need, stays open, updates live
 * (the profile in another tab, the test's needs), closes by itself when the profile covers everything, and its main
 * button ("Join anyway" / "Apply anyway") sends the press. Something missing that it didn't show, or a listing change,
 * stops once INSIDE it. Mounting it opens it.
 */
export type Needs = { devices: string[]; languages: string[] };

/** What the test itself changed in what it needs: "Nora Lane added Spanish to the languages this test needs", and so on. */
export function needsChange(dev: string, before: Needs, now: Needs) {
  const out: string[] = [];
  for (const [noun, a, b] of [["languages", before.languages, now.languages], ["devices", before.devices, now.devices]] as const) {
    const added = b.filter((x) => !a.includes(x)), removed = a.filter((x) => !b.includes(x));
    if (added.length) out.push(`${dev} added ${added.join(", ")} to the ${noun} this test needs`);
    if (removed.length) out.push(`${dev} removed ${removed.join(", ")} from the ${noun} this test needs`);
  }
  return out;
}

/** (Batch 34 §14) A listing line in the pop-up's stop: the server's "… edited the listing at 12:23 PM: …" and the test's needs it saw change ("… added Spanish to …"). */
const isListingLine = (c: Change) => !!c.listing || (!!c.timed && c.kind === "info");

/**
 * (Owner, Oct 30, batch 34 §14) The pop-up's blue stop: its lines (a listing line ends "· See it", which closes the pop-up and scrolls to the listing), then
 * "Your Join didn't go through." naming the press (Join / Apply / Ask to rejoin), never "Your press".
 */
export function PopupStop({ lines, press, seeIt }: { lines: Change[]; press: string; seeIt?: string }) {
  return (
    <div role="alert" className="mb-3 space-y-1.5 rounded-lg border border-sky-300/40 bg-sky-300/[0.08] p-2.5 text-sm text-sky-100" data-popup-stop="">
      {lines.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-6">
          {lines.map((c, i) => (
            <li key={`${c.text}|${i}`}>{c.text}{seeIt && isListingLine(c) && <> · <a href={seeIt} data-see-it="" onClick={(e) => seeItClick(e, seeIt, c.at, c.saveAt)}>See it</a></>}</li>
          ))}
        </ul>
      )}
      <p><strong className="font-semibold text-sky-50">Your {press} didn&apos;t go through.</strong> Check what this test needs now, then press again.</p>
    </div>
  );
}

export function GapDialog(p: { testId: string; ask: GapAsk; initial: Gaps; needs: Needs; devName: string; send: (shown: Gaps) => Promise<PopupAnswer>; onCovered: (at: string) => void; onClose: () => void; /** (Batch 34 §14) the page's press: "Join" / "Apply" / "Ask to rejoin" */ press: string; /** (Batch 34 §14) where a listing line's See it goes ("#listing") */ seeIt?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [shown, setShown] = useState<Gaps>(p.initial);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const [changedAt, setChangedAt] = useState<string | null>(null);
  const [stop, setStop] = useState<{ lines: Change[]; button: string } | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  // The TEST's needs when this opened, and what it changed since: a listing change, so the first "anyway" press stops
  // once, naming it (like the Invite anyway box), then the next goes ahead.
  const needs0 = useRef(p.needs);
  const [testChange, setTestChange] = useState<string[]>([]);
  const testChangeRef = useRef<string[]>([]);
  testChangeRef.current = testChange;
  const acked = useRef(true);
  // (Batch 35 §14) The Save that last changed the test's needs (the server says): the pop-up's own needs lines name it, so their See it marks that Save's fields only.
  const needsSave = useRef<string | undefined>(undefined);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Open: checked every few seconds and on coming back to the tab. What's covered drops off; all covered closes it.
  useEffect(() => {
    const live = async () => {
      if (sendingRef.current) return;
      const r = await api<{ gaps: Gaps; needs: Needs; needsSaveAt?: string }>(`/api/tests/${p.testId}/my-gaps`, {}).catch(() => null);
      if (!r || sendingRef.current) return;
      const changed = needsChange(p.devName, needs0.current, r.needs);
      if (changed.length) needsSave.current = r.needsSaveAt;
      if (JSON.stringify(changed) !== JSON.stringify(testChangeRef.current)) {
        setTestChange(changed);
        acked.current = changed.length === 0;
      }
      if (sameGaps(r.gaps, shownRef.current)) return;
      if (noGaps(r.gaps)) {
        ref.current?.close();
        p.onCovered(new Date().toISOString());
        return;
      }
      setShown(r.gaps);
      setChangedAt(new Date().toISOString());
    };
    const t = setInterval(live, 4_000);
    window.addEventListener("focus", live);
    document.addEventListener("visibilitychange", live);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", live);
      document.removeEventListener("visibilitychange", live);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for this pop-up
  }, [p.testId]);

  async function go() {
    if (sendingRef.current) return;
    const button = testerGapButton(shownRef.current, p.ask);
    // The test's needs changed while this was open: stop once, naming the change, before joining.
    if (!acked.current && testChangeRef.current.length) {
      acked.current = true;
      const at = new Date().toISOString();
      setStop({ lines: testChangeRef.current.map((text) => ({ text, at, listing: true, ...(needsSave.current ? { saveAt: needsSave.current } : {}) })), button });
      setChangedAt(new Date().toISOString());
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setStop(null);
    const r = await p.send(shownRef.current);
    if ("ok" in r) {
      if (afterSent(r) === "stay") return; // the page moves on
      sendingRef.current = false;
      setSending(false);
      ref.current?.close(); // (batch 26 section 13) the page stays: its done line shows under the button
      return;
    }
    sendingRef.current = false;
    setSending(false);
    if ("refused" in r) {
      ref.current?.close(); // the reason shows under the page's button
      return;
    }
    if (r.gaps) {
      if (noGaps(r.gaps)) {
        ref.current?.close();
        p.onCovered(new Date().toISOString());
        return;
      }
      setShown(r.gaps);
    }
    setStop({ lines: r.stop ?? [], button });
    setChangedAt(new Date().toISOString());
  }

  const title = shown.languages.length && shown.devices.length ? "What this test needs" : shown.devices.length ? "A device this test runs on" : shown.languages.length ? "A language this test needs" : "What this test needs";
  return (
    <dialog ref={ref} aria-labelledby={`${id}-title`} aria-describedby={`${id}-text`} onClose={p.onClose}
      className="!m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-ink-900 p-5 text-slate-200 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm">
      {stop && <PopupStop lines={stop.lines} press={p.press} seeIt={p.seeIt} />}
      <h2 id={`${id}-title`} className="flex items-center gap-2 font-semibold text-white"><Languages className="h-5 w-5 text-amber-300" /> {title}</h2>
      <p id={`${id}-text`} role="status" className="mt-2 text-sm text-slate-300">{changedAt && !stop && <><JustUpdated at={changedAt} /> </>}{noGaps(shown) ? testerGapText(shown, p.ask) : <>Your profile <MissingNeedWords g={shown} />. {TESTER_ASK[p.ask].question}</>}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn px-3 py-1.5 text-sm" onClick={go} disabled={sending} autoFocus>{sending ? "Sending…" : testerGapButton(shown, p.ask)}</button>
        {/* A new tab: this pop-up stays where it is and follows the profile as it's saved there. */}
        <a href="/app/profile" target="_blank" rel="noopener" className="btn-secondary px-3 py-1.5 text-sm">Edit my profile</a>
        <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => ref.current?.close()} disabled={sending}>Cancel</button>
      </div>
    </dialog>
  );
}
