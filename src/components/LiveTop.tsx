"use client";
import { withLineLinks } from "@/components/LineLinks";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { Change } from "@/components/ChangesBox";
import { announce, clearShown, handOver, mergeChanges, setShown, setShownOnPage, takeOver, wasShownInBox } from "@/lib/live";
import { LongList } from "@/components/LongList";
import { ContractLink } from "@/components/ContractLink";
import { jumpTo, jumpToFirst } from "@/lib/markJump";
import { KEY_BOX_ID } from "@/lib/keys";
import { pillLabel, pillSide, type PillSide } from "@/lib/livePill";
import { seeItClick } from "@/components/ListingInfo";
import { LIVE_TICK, boxSync, rideLiveClock, whileRedrawn } from "@/lib/liveSync";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const key = (c: Change) => `${c.at}|${c.text}`;
const time0 = (at: string | Date) => new Date(at).getTime();
/** An ignored line's words that open its row: still the line's grey, underlined on hover. */
const IGNORED_REST = "text-inherit no-underline hover:underline";

export function LiveNoticeText({ line: l, testId }: { line: Change; testId?: string }) {
  const rest = l.link ? `${testId ? `/app/tests/${testId}` : ""}#${l.link}` : undefined;
  return withLineLinks(l.text, l.links, {
    draw: (text) => text,
    rest,
    restClass: l.ignored ? IGNORED_REST : undefined,
    onRest: testId || !l.link ? undefined : (e) => {
      e.preventDefault();
      jumpToFirst(l.link!);
    },
  });
}

/**
 * The live top notice: one box at the top of the page listing every change since the page was opened
 * (new terms, payments, call changes, listing edits, your own actions in another tab), newest first, as the page's
 * 20-second refresh picks them up. Shown changes count as seen: the page's buttons then send a later "seen" marker.
 * It checks on the page's one 20-second beat (lib/liveSync.ts), at once whenever the page redraws, and a new line redraws the page at once.
 */
export function LiveTop({ scope, seenAt, seeIt, contractLink }: { scope: string; seenAt: string; seeIt?: string; contractLink?: "scroll" | { testId: string } }) {
  const [lines, setLines] = useState<Change[]>([]);
  const [hiddenUpTo, setHiddenUpTo] = useState("");
  const known = useRef(new Set<string>());
  const since = useRef(seenAt); // the page-open time: the list always covers everything since then
  const box = useRef<HTMLDivElement>(null);
  // What this box has shown every line up to (its last shown check), and the lines it picked up but still holds for the page's redraw: a box
  // drawn again in its place (lib/live.ts handOver) checks from before them.
  const shownTo = useRef(seenAt);
  const held = useRef<Change[]>([]);

  // Nothing moves on its own: EVERY live update that arrives while
  // this box is out of view raises the floating pill ("1 new update", counting up), whether or not anything is being typed. Its arrow points where the updates are
  // ("↑" above the screen, "↓" below: on Edit the box sits under Save). Pressing it scrolls to the box and it goes; it also goes once the box comes into view.
  // The flash on the new line stays. Reduced motion: a jump, no animation.
  const [pill, setPill] = useState(0);
  const [side, setSide] = useState<PillSide>("up");
  const [flash, setFlash] = useState("");
  const where = () => pillSide(box.current?.getBoundingClientRect(), window.innerHeight);
  /**
   * Lines count as seen (the press's seen marker moves on) only once this box is in view: lines that arrived while it was
   * out of view, with only the pill up, still stop the next press once.
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
   * EVERY live update nobody pressed for is announced, not only the page's first: by the pill alone, adding to its count (nothing scrolls). The count is read
   * fresh each time, never a `pill` value frozen in the poll's closure.
   */
  function announceFresh(n: number, newest: string) {
    setFlash(newest);
    setTimeout(() => setFlash(""), 2500);
    // Out of view: the pill, never a scroll (typing or not).
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

  /**
   * One check, not two: the box checks on the page's one beat (the same tick as the page's redraw poll), and at once whenever the
   * page redraws (a new server render time: the poll's redraw, a press, focus, another part of the page). New lines ask the page to redraw at once; while that
   * redraw is on its way they are held and show (with the pill) as it lands, so the rows and the line change together.
   */
  const [sync] = useState(boxSync);
  const check = useRef<() => Promise<void>>(async () => {});
  const drawnWith = useRef(seenAt);
  useEffect(() => {
    if (drawnWith.current === seenAt) return;
    drawnWith.current = seenAt; // the page redrew: held lines show now, and the box checks at once
    sync.drawn();
    void check.current();
  }, [seenAt, sync]);

  useEffect(() => {
    let alive = true;
    const tick = async (tookOver = false) => {
      const started = Date.now();
      const r = await api<{ changes: Change[]; now: string }>(`/api/live?scope=${encodeURIComponent(scope)}&since=${encodeURIComponent(since.current)}`).catch(() => null);
      if (!r || !alive) return;
      const added = r.changes.filter((c) => !known.current.has(key(c)));
      added.forEach((c) => known.current.add(key(c)));
      const apply = (redrawn: boolean) => {
        if (!alive) return;
        held.current = held.current.filter((c) => !added.includes(c));
        if (time0(r.now) > time0(shownTo.current)) shownTo.current = r.now;
        // A keyed line (the one listing line) replaces the box's earlier one, covering its fields too.
        if (added.length) setLines((old) => mergeChanges(old, added));
        // Only a live update nobody pressed for is announced (lines a stop box showed are quiet); each one raises the pill when the box is out of view.
        // Ignored (greyed) Alerts lines count as updates too, since they still show.
        const fresh = added.filter((c) => !wasShownInBox(c));
        if (fresh.length) announceFresh(fresh.length, key(fresh[fresh.length - 1]));
        // Shown on the page (the redraw, the pill up or the box in view): seen at once, so no stop notice for it afterwards.
        unseenUpTo.current = "";
        if (added.length) setShownOnPage(scope, r.now);
        else setShown(scope, r.now);
        whileRedrawn(redrawn, () => announce(added));
      };
      // New lines redraw the page at once and show as it lands (at once if it already redrew during this check).
      // The first check of a box drawn again in place of the old one: lines from before this render came with the redraw that just landed.
      const cameWithRedraw = tookOver && added.every((c) => time0(c.at) <= time0(drawnWith.current));
      if (!cameWithRedraw) held.current.push(...added);
      if (!added.length) apply(false);
      else if (cameWithRedraw) apply(true);
      else sync.lines(started, apply);
    };
    check.current = tick;
    // No timer of its own: the page's one 20-second clock beats for the box and the redraw together.
    const leave = rideLiveClock();
    const onTick = () => void tick();
    window.addEventListener(LIVE_TICK, onTick);
    // Drawn again in place of this scope's box (lib/live.ts takeOver): check at once from what that one had shown, so nothing it picked up but
    // hadn't shown is lost; the page has just drawn.
    const from = takeOver(scope);
    if (from) {
      if (time0(from) < time0(since.current)) since.current = from;
      sync.drawn();
      void tick(true);
    }
    return () => {
      alive = false;
      leave();
      window.removeEventListener(LIVE_TICK, onTick);
      sync.stop();
      clearShown(scope);
      // The box drawn in its place counts from before any line this one hasn't shown.
      const firstHeld = Math.min(...held.current.map((c) => time0(c.at)));
      handOver(scope, firstHeld - 1 < time0(shownTo.current) ? new Date(firstHeld - 1).toISOString() : shownTo.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- announceFresh and where read refs and setters only
  }, [scope, sync]);

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
      {/* The newest 3 lines, then "Show N more" opening a scroll box about 8 lines tall. */}
      <div className="mr-auto min-w-0">
      <LongList className="space-y-0.5" tall="max-h-52">
        {show.map((l) => (
          <li key={key(l)} className={`${l.ignored ? "text-sky-100/50" : ""} ${flash === key(l) ? "rounded bg-sky-300/20 transition-colors" : ""}`} data-flash={flash === key(l) ? "" : undefined} title={l.ignored ? "You turned these stops off in Alerts" : undefined}>
            {/* A line about a row on this page opens it (a new dispute: its Needs you row). */}
            {/* A listing save's line says its own time ("Marc Hanna edited the listing at 6:55 PM: …"): not twice. */}
            <b>{l.timed ? "Updated:" : `Updated · ${time(l.at)}:`}</b> {/* Each person and test it names is its own green link; a line about a row keeps its other words opening that row, beside them. */}
            {/* Every line about something with a place on the page opens it (jumps and marks; a request whose row has left: its Call requests box),
                ignored (greyed) lines too: those keep their grey and their title, the rest of the words linked in the line's own colour. */}
            <LiveNoticeText line={l} testId={typeof contractLink === "object" ? contractLink.testId : undefined} />
            {/* A tester switched to or kept after new terms: "See their contract" scrolls to their row on the test page; on Edit it opens the test page at that row in a new tab. */}
            {l.kind === "terms" && l.contract && contractLink && (
              <>
                {" "}
                <ContractLink contract={l.contract} mode={contractLink} />
              </>
            )}
            {/* "Nora Lane gave you an access key for “…”": See it jumps to the key box (the page redraws with it at once: the session's poll includes the key). */}
            {l.kind === "keygiven" && <> · <a href={`#${KEY_BOX_ID}`} data-see-it="key" onClick={(e) => { e.preventDefault(); jumpTo(KEY_BOX_ID); }}>See it</a></>}
            {(l.kind === "info" || l.listing) && seeIt && (
              <>
                {l.timed || l.listing ? " · " : " "}
                {/* The page can mark the lines that save changed (the session page's contract box; the developer's Listing panel). */}
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
