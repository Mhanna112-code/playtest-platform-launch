"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { Change } from "@/components/ChangesBox";
import { announce, clearShown, mergeChanges, setShown, wasShownInBox } from "@/lib/live";
import { LongList } from "@/components/LongList";
import { ContractLink } from "@/components/ContractLink";
import { jumpTo } from "@/lib/markJump";
import { KEY_BOX_ID } from "@/lib/keys";
import { pillLabel, pillSide, type PillSide } from "@/lib/livePill";
import { seeItClick } from "@/components/ListingInfo";

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

  // (Owner, Oct 29, batch 27 section 4; replaces batch 15 section 28's first-update scroll) Nothing moves on its own any more: EVERY live update that arrives while
  // this box is out of view raises the floating pill ("1 new update", counting up), whether or not anything is being typed. Its arrow points where the updates are
  // ("↑" above the screen, "↓" below: on Edit the box sits under Save). Pressing it scrolls to the box and it goes; it also goes once the box comes into view.
  // The flash on the new line stays. Reduced motion: a jump, no animation.
  const [pill, setPill] = useState(0);
  const [side, setSide] = useState<PillSide>("up");
  const [flash, setFlash] = useState("");
  const where = () => pillSide(box.current?.getBoundingClientRect(), window.innerHeight);
  /**
   * (Owner's finding, Oct 30, batch 32 §12) Lines count as seen (the press's seen marker moves on) only once this box is in view: lines that arrived while it was
   * out of view, with only the pill up, still stop the next press once (another device's Send used to go straight through and replace what was sent there).
   */
  const unseenUpTo = useRef("");
  const seenNowInView = () => {
    if (unseenUpTo.current) setShown(scope, unseenUpTo.current);
    unseenUpTo.current = "";
  };
  const go = () => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    box.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    setPill(0);
    seenNowInView();
  };
  /**
   * (Owner, Oct 28, batch 20 section 13, bug found by the owner) EVERY live update nobody pressed for is announced, not only the page's first (batch 27 section 4:
   * by the pill alone, adding to its count; the first one no longer scrolls). Before, only the first update of a page load was announced (later ones only checked a `pill` value frozen at 0 in the poll's
   * closure), so a call request arriving while the tester typed in the Dispute box (after an earlier update had used the one scroll) showed nothing.
   */
  function announceFresh(n: number, newest: string) {
    setFlash(newest);
    setTimeout(() => setFlash(""), 2500);
    // (Batch 27 section 4) Out of view: the pill, never a scroll (typing or not).
    setTimeout(() => {
      const s = where();
      if (!s) return;
      setSide(s);
      setPill((p) => p + n);
    }, 50);
  }
  // The pill leaves once the box is in view; its arrow follows the box while the page scrolls.
  useEffect(() => {
    if (!pill) return;
    const onScroll = () => {
      const s = where();
      if (!s) {
        setPill(0);
        seenNowInView();
      } else setSide(s);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
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
      // (Batch 35 §34) A keyed line (the one listing line) replaces the box's earlier one, covering its fields too.
      if (added.length) setLines((old) => mergeChanges(old, added));
      // Only a live update nobody pressed for is announced (lines a stop box showed are quiet); (batch 27 section 4) each one raises the pill when the box is out of view.
      // Ignored (greyed) Alerts lines count as updates too, since they still show.
      const fresh = added.filter((c) => !wasShownInBox(c));
      if (fresh.length) announceFresh(fresh.length, key(fresh[fresh.length - 1]));
      // (Batch 32 §12) Seen only when the box is in view; otherwise kept until it comes into view (a later poll with nothing new keeps the earlier mark).
      if (!where()) {
        unseenUpTo.current = "";
        setShown(scope, r.now);
      } else if (added.length || unseenUpTo.current) unseenUpTo.current = r.now;
      else setShown(scope, r.now);
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
      <button type="button" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full border border-sky-300/50 bg-slate-900/95 px-4 py-2 text-sm text-sky-100 shadow-xl" data-live-pill={side} onClick={go}>
        {pillLabel(pill, side)}
      </button>
    )}
    <div ref={box} className="info flex items-start gap-3 scroll-mt-24" role="status" aria-live="polite" data-live-top>
      {/* (Design doc 2) The newest 3 lines, then "Show N more" opening a scroll box about 8 lines tall. */}
      <div className="mr-auto min-w-0">
      <LongList className="space-y-0.5" tall="max-h-52">
        {show.map((l) => (
          <li key={key(l)} className={`${l.ignored ? "text-sky-100/50" : ""} ${flash === key(l) ? "rounded bg-sky-300/20 transition-colors" : ""}`} data-flash={flash === key(l) ? "" : undefined} title={l.ignored ? "You turned these stops off in Alerts" : undefined}>
            {/* (Batch 15 section 35) A line about a row on this page opens it (a new dispute: its Needs you row). */}
            {/* (Batch 30 §10) A listing save's line says its own time ("Marc Hanna edited the listing at 6:55 PM: …"): not twice. */}
            <b>{l.timed ? "Updated:" : `Updated · ${time(l.at)}:`}</b> {l.link ? <a href={`#${l.link}`} onClick={(e) => { e.preventDefault(); jumpTo(l.link!); }}>{l.text}</a> : l.text}
            {/* (Owner, Oct 27) A tester switched to or kept after new terms: "See their contract" scrolls to their row on the test page; on Edit it opens the test page at that row in a new tab. */}
            {l.kind === "terms" && l.contract && contractLink && (
              <>
                {" "}
                <ContractLink contract={l.contract} mode={contractLink} />
              </>
            )}
            {/* (Batch 34 §12) "Nora Lane gave you an access key for “…”": See it jumps to the key box (the page redraws with it at once: the session's poll includes the key). */}
            {l.kind === "keygiven" && <> · <a href={`#${KEY_BOX_ID}`} data-see-it="key" onClick={(e) => { e.preventDefault(); jumpTo(KEY_BOX_ID); }}>See it</a></>}
            {(l.kind === "info" || l.listing) && seeIt && (
              <>
                {l.timed || l.listing ? " · " : " "}
                {/* (Batch 30 §15) The page can mark the lines that save changed (the session page's contract box; batch 34 §14: the developer's Listing panel). */}
                <a href={seeIt} data-see-it="" onClick={(e) => seeItClick(e, seeIt, l.at, l.saveAt, l.keys)}>See it</a>
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
