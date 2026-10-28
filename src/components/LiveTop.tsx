"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { Change } from "@/components/ChangesBox";
import { announce, clearShown, setShown, wasShownInBox } from "@/lib/live";
import { LongList } from "@/components/LongList";
import { ContractLink } from "@/components/ContractLink";
import { jumpTo } from "@/lib/markJump";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const key = (c: Change) => `${c.at}|${c.text}`;

/**
 * The live top notice (owner, NEWEST+3): one box at the top of the page listing every change since the page was opened
 * (new terms, payments, call changes, listing edits, your own actions in another tab), newest first, as the page's
 * 20-second refresh picks them up. Shown changes count as seen: the page's buttons then send a later "seen" marker.
 */
export function LiveTop({ scope, seenAt, every = 20_000, seeIt, contractLink }: { scope: string; seenAt: string; every?: number; seeIt?: string; contractLink?: "scroll" | { testId: string } }) {
  const [lines, setLines] = useState<Change[]>([]);
  const [hiddenUpTo, setHiddenUpTo] = useState("");
  const known = useRef(new Set<string>());
  const since = useRef(seenAt); // the page-open time: the list always covers everything since then
  const box = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  // (Owner, Oct 30, batch 15 section 28) The FIRST live update since the page loaded scrolls the page smoothly up to this box and flashes the new line, once per page
  // load. Never mid-task (DEFAULT): while a field has focus or a pop-up is open, a small floating pill "1 new update ↑" shows instead (it scrolls up when pressed and
  // goes once the box is in view). Nothing moves when the box is already in view. Reduced motion: a jump, no animation.
  const [pill, setPill] = useState(0);
  const [flash, setFlash] = useState("");
  const inView = () => {
    const r = box.current?.getBoundingClientRect();
    return !!r && r.top >= 0 && r.bottom <= window.innerHeight;
  };
  const go = () => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    box.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    setPill(0);
  };
  function scrollUp(n: number, newest: string) {
    setFlash(newest);
    setTimeout(() => setFlash(""), 2500);
    setTimeout(() => {
      if (inView()) return;
      const el = document.activeElement;
      const busy = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable) || !!document.querySelector("dialog[open], [role='dialog'], [aria-modal='true']");
      if (busy) setPill(n);
      else go();
    }, 50);
  }
  // The pill leaves once the box is in view.
  useEffect(() => {
    if (!pill) return;
    const onScroll = () => { if (inView()) setPill(0); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pill]);

  // A note from a press that went ahead just before the page reloaded ("Done. Also: the test was renamed ...").
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem("press-note");
      if (!raw) return;
      window.sessionStorage.removeItem("press-note");
      const n = JSON.parse(raw) as { text: string; at: string; path: string };
      if (Date.now() - new Date(n.at).getTime() < 60_000) setLines((old) => [...old, { text: n.text, at: n.at }]);
    } catch {
      // nothing to show
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await api<{ changes: Change[]; now: string }>(`/api/live?scope=${encodeURIComponent(scope)}&since=${encodeURIComponent(since.current)}`).catch(() => null);
      if (!r || !alive) return;
      const added = r.changes.filter((c) => !known.current.has(key(c)));
      added.forEach((c) => known.current.add(key(c)));
      if (added.length) setLines((old) => [...old, ...added]);
      // Scroll once, only for a live update nobody pressed for (lines a stop box showed are quiet).
      // Ignored (greyed) Alerts lines count as updates too, since they still show.
      if (added.some((c) => !wasShownInBox(c)) && !scrolled.current) {
        scrolled.current = true;
        const fresh = added.filter((c) => !wasShownInBox(c));
        scrollUp(fresh.length, key(fresh[fresh.length - 1]));
      } else if (pill) setPill((n) => n + added.length);
      setShown(scope, r.now);
      announce(added);
    };
    const t = setInterval(tick, every);
    const onTick = () => tick();
    window.addEventListener("live-tick", onTick);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("live-tick", onTick);
      clearShown(scope);
    };
  }, [scope, every]);

  const show = lines.filter((l) => !hiddenUpTo || new Date(l.at).toISOString() > hiddenUpTo).sort((a, b) => (a.at < b.at ? 1 : -1));
  if (!show.length) return null;
  return (
    <>
    {pill > 0 && (
      <button type="button" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full border border-sky-300/50 bg-slate-900/95 px-4 py-2 text-sm text-sky-100 shadow-xl" data-live-pill="" onClick={go}>
        {pill} new update{pill === 1 ? "" : "s"} ↑
      </button>
    )}
    <div ref={box} className="info flex items-start gap-3 scroll-mt-24" role="status" aria-live="polite" data-live-top>
      {/* (Design doc 2) The newest 3 lines, then "Show N more" opening a scroll box about 8 lines tall. */}
      <div className="mr-auto min-w-0">
      <LongList className="space-y-0.5" tall="max-h-52">
        {show.map((l) => (
          <li key={key(l)} className={`${l.ignored ? "text-sky-100/50" : ""} ${flash === key(l) ? "rounded bg-sky-300/20 transition-colors" : ""}`} data-flash={flash === key(l) ? "" : undefined} title={l.ignored ? "You turned these stops off in Alerts" : undefined}>
            {/* (Batch 15 section 35) A line about a row on this page opens it (a new dispute: its Needs you row). */}
            <b>Updated · {time(l.at)}:</b> {l.link ? <a href={`#${l.link}`} onClick={(e) => { e.preventDefault(); jumpTo(l.link!); }}>{l.text}</a> : l.text}
            {/* (Owner, Oct 27) A tester switched to or kept after new terms: "See their contract" scrolls to their row on the test page; on Edit it opens the test page at that row in a new tab. */}
            {l.kind === "terms" && l.contract && contractLink && (
              <>
                {" "}
                <ContractLink contract={l.contract} mode={contractLink} />
              </>
            )}
            {l.kind === "info" && seeIt && (
              <>
                {" "}
                <a href={seeIt} onClick={() => setTimeout(() => (document.querySelector(seeIt) as HTMLDetailsElement | null)?.setAttribute("open", ""), 0)}>See it</a>
              </>
            )}
          </li>
        ))}
      </LongList>
      </div>
      <button className="btn-ghost text-xs" onClick={() => setHiddenUpTo(new Date(show[0].at).toISOString())}>Dismiss</button>
    </div>
    </>
  );
}
