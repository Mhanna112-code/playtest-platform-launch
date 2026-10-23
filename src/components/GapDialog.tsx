"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Languages, RefreshCw } from "lucide-react";
import { api } from "@/lib/client";
import { noGaps, sameGaps, testerGapButton, testerGapText, type GapAsk, type Gaps } from "@/lib/gaps";

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

export type PopupAnswer = { ok: true } | { stop: string[]; gaps?: undefined } | { gaps: Gaps; stop?: undefined } | { refused: true };

/**
 * The full app's "What this test needs" pop-up (claim-form.tsx / useLanguageGate): opens when Join / Apply is pressed
 * and the profile misses a device or language the test needs. It lists every unmet need, stays open, updates live
 * (the profile in another tab, the test's needs), closes by itself when the profile covers everything, and its main
 * button ("Join anyway" / "Apply anyway") sends the press. Something missing that it didn't show, or a listing change,
 * stops once INSIDE it. Mounting it opens it.
 */
export function GapDialog(p: { testId: string; ask: GapAsk; initial: Gaps; send: (shown: Gaps) => Promise<PopupAnswer>; onCovered: (at: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [shown, setShown] = useState<Gaps>(p.initial);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const [changedAt, setChangedAt] = useState<string | null>(null);
  const [stop, setStop] = useState<{ lines: string[]; button: string } | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Open: checked every few seconds and on coming back to the tab. What's covered drops off; all covered closes it.
  useEffect(() => {
    const live = async () => {
      if (sendingRef.current) return;
      const r = await api<{ gaps: Gaps }>(`/api/tests/${p.testId}/my-gaps`, {}).catch(() => null);
      if (!r || sendingRef.current || sameGaps(r.gaps, shownRef.current)) return;
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
    sendingRef.current = true;
    setSending(true);
    setStop(null);
    const button = testerGapButton(shownRef.current, p.ask);
    const r = await p.send(shownRef.current);
    if ("ok" in r) return; // the page moves on
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
      {stop && (
        <div role="alert" className="mb-3 space-y-1.5 rounded-lg border border-sky-300/40 bg-sky-300/[0.08] p-2.5 text-sm text-sky-100">
          {stop.lines.length > 0 && <ul className="list-disc space-y-0.5 pl-6">{stop.lines.map((c) => <li key={c}>{c}</li>)}</ul>}
          <p><strong className="font-semibold text-sky-50">Your “{stop.button}” didn&apos;t go through.</strong> Check what this test needs now, then press again.</p>
        </div>
      )}
      <h2 id={`${id}-title`} className="flex items-center gap-2 font-semibold text-white"><Languages className="h-5 w-5 text-amber-300" /> {title}</h2>
      <p id={`${id}-text`} role="status" className="mt-2 text-sm text-slate-300">{changedAt && !stop && <><JustUpdated at={changedAt} /> </>}{testerGapText(shown, p.ask)}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn px-3 py-1.5 text-sm" onClick={go} disabled={sending} autoFocus>{sending ? "Sending…" : testerGapButton(shown, p.ask)}</button>
        {/* A new tab: this pop-up stays where it is and follows the profile as it's saved there. */}
        <a href="/app/profile" target="_blank" rel="noopener" className="btn-secondary px-3 py-1.5 text-sm">Edit my profile</a>
        <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => ref.current?.close()} disabled={sending}>Cancel</button>
      </div>
    </dialog>
  );
}
