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
import { TO_TOP_EVENT, handedToTop, useStopLinePage } from "@/lib/stopLine";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const key = (c: Change) => `${c.at}|${c.text}`;
const time0 = (at: string | Date) => new Date(at).getTime();
/** (Owner, Dec 10 2026) A line that says its own time ("This test was stopped at 3:10 PM."): "Updated:", never the time twice (as the stop box drew it). */
const saysItsTime = (l: Change) => l.timed || / at \d{1,2}:\d{2}\s?[AP]M\.?$/.test(l.text);
/** An ignored line's words that open its row: still the line's grey, underlined on hover. */
const IGNORED_REST = "text-inherit no-underline hover:underline";

export function LiveNoticeText({ line: l, testId }: { line: Change; testId?: string }) {
  // (Owner, Dec 10 2026) A stop's line handed to this box may open a page of its own ("/app/…", as it did in the stop box): its words link there.
  const away = !!l.link?.startsWith("/");
  const rest = l.link ? (away ? l.link : `${testId ? `/app/tests/${testId}` : ""}#${l.link}`) : undefined;
  return withLineLinks(l.text, l.links, {
    draw: (text) => text,
    rest,
    restClass: l.ignored ? IGNORED_REST : undefined,
    onRest: testId || !l.link || away ? undefined : (e) => {
      e.preventDefault();
      jumpToFirst(l.link!);
    },
  });
}

/**
 * The live top notice: one box at the top of the page listing every change since the page was opened
 * (new terms, payments, call changes, listing edits, your own actions in another tab), newest first, as the page's
 * 20-second refresh picks them up. Shown changes count as seen: the page's buttons then send a later "seen" marker.
 * Used by the session page, the test page and Edit, the join page and the tester's dashboard (`scope`: "session:<id>", "test:<id>", "listing:<id>",
 * "invites:me"; the api/live route reads the lines for each).
 *
 * When it checks (`tick`, inside the main effect below):
 *   - on the page's one 20-second beat (lib/liveSync.ts LIVE_TICK; the redraw poll, AutoRefresh, rides the same beat);
 *   - at once whenever the page redraws (a new `seenAt`, the server render time: the poll's redraw, a press, focus, another part of the page);
 *   - at once at mount when it takes over from the same scope's box drawn just before it (lib/live.ts takeOver), from the time that box had shown up to.
 * A check that finds new lines asks the page to redraw at once and shows them as the redraw lands, so the rows and the line change together.
 *
 * How it moves the page's seen time (lib/live.ts, what every press sends as `seenAt`): each check that shows its lines moves it to the server's `now`
 * (setShownOnPage when there were new lines, setShown when none). On unmount it clears it for this scope and hands over to the next box the time up
 * to which it showed every line (`shownTo`, or just before the first line it still held).
 */
export function LiveTop({ scope, seenAt, seeIt, contractLink, stopLines = false }: { scope: string; seenAt: string; seeIt?: string; contractLink?: "scroll" | { testId: string };
  /** (Owner, Dec 10 2026) This page's stops show as one line under the button and their changes come here (the session, join and test pages; not Edit or Home) */ stopLines?: boolean }) {
  // (Owner, Dec 10 2026) A box drawn again in place lists what the page's stops handed to the one before it.
  const [lines, setLines] = useState<Change[]>(() => (stopLines ? mergeChanges([], handedToTop()) : []));
  const [hiddenUpTo, setHiddenUpTo] = useState("");
  // (Owner, Dec 10 2026) Lines a stop handed here show even when Dismiss hid older lines (until the next Dismiss).
  const [unhidden, setUnhidden] = useState<Set<string>>(() => new Set());
  useStopLinePage(stopLines);
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
   * (Owner, Dec 10 2026) A press stopped once on this page: its changes come here at once, whatever the Alerts (the line under the button says to check them),
   * never twice (mergeChanges skips a line the box already has); known, so the next check doesn't count them as new; quiet (no pill: the stop listed them).
   */
  useEffect(() => {
    if (!stopLines) return;
    const on = (e: Event) => {
      const added = (e as CustomEvent<Change[]>).detail ?? [];
      if (!added.length) return;
      added.forEach((c) => known.current.add(key(c)));
      setLines((old) => mergeChanges(old, added));
      setUnhidden((u) => new Set([...u, ...added.map(key)]));
    };
    window.addEventListener(TO_TOP_EVENT, on);
    return () => window.removeEventListener(TO_TOP_EVENT, on);
  }, [stopLines]);

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
    /** Step 1, fetch: every line on this page's scope since `since` (the page-open time, or earlier after a takeover), and the server's `now` (the time up to
     * which those lines cover everything). Null when offline (the next beat tries again). */
    const fetchLines = () => api<{ changes: Change[]; now: string }>(`/api/live?scope=${encodeURIComponent(scope)}&since=${encodeURIComponent(since.current)}`).catch(() => null);
    /** Step 2, find new lines: those this box hasn't had before (by time and text); from now on they count as known. */
    const newLinesOf = (changes: Change[]) => {
      const added = changes.filter((c) => !known.current.has(key(c)));
      added.forEach((c) => known.current.add(key(c)));
      return added;
    };
    /**
     * Step 3, apply (shown): the new lines join the box, a fresh one raises the pill, the page's seen time moves to the server's `now`, and an open stop box
     * under a button hears of them (announce). `redrawn`: they came with the page's redraw (a listener that would redraw for them needn't: whileRedrawn).
     * How the seen time moves: with new lines, setShownOnPage (shown on the page counts as seen at once, call changes too: no stop box for them afterwards);
     * with none, setShown (nothing new, everything up to `now` was already on the page). This box's own shownTo moves to `now` too (handed over on unmount).
     */
    const showLines = (added: Change[], r: { now: string }, redrawn: boolean) => {
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
    /**
     * One live check. It runs on the page's 20-second beat (LIVE_TICK, below), at once whenever the page redraws (the `seenAt` effect above: a poll's
     * redraw, a press, focus, another part of the page), and once at mount when this box takes over from one drawn in its place (`tookOver`).
     *   1. Fetch (fetchLines); offline or unmounted: stop.
     *   2. Find the new lines (newLinesOf).
     *   3. Show them (showLines), by one of three branches:
     *      a. No new lines: apply at once (only the seen time moves).
     *      b. A takeover check whose lines all date from before this render: they came with the redraw that just mounted this box; apply at once, as redrawn.
     *      c. Otherwise: hold them and ask the page to redraw (liveSync boxSync.lines); they show as the redraw lands (at once if the page already drew
     *         during this check; after a few seconds if no redraw comes; at once if nothing on the page redraws).
     */
    const tick = async (tookOver = false) => {
      const started = Date.now();
      // 1. Fetch.
      const r = await fetchLines();
      if (!r || !alive) return;
      // 2. The new lines.
      const added = newLinesOf(r.changes);
      // 3. Show them, by branch.
      const apply = (redrawn: boolean) => showLines(added, r, redrawn);
      // The first check of a box drawn again in place of the old one: lines from before this render came with the redraw that just landed.
      const cameWithRedraw = tookOver && added.every((c) => time0(c.at) <= time0(drawnWith.current));
      // Held until they show (handed over to the next box if this one goes first).
      if (!cameWithRedraw) held.current.push(...added);
      if (!added.length) apply(false); // a.
      else if (cameWithRedraw) apply(true); // b.
      else sync.lines(started, apply); // c. New lines redraw the page at once and show as it lands.
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

  const show = lines.filter((l) => !hiddenUpTo || new Date(l.at).toISOString() > hiddenUpTo || unhidden.has(key(l))).sort((a, b) => (time0(a.at) < time0(b.at) ? 1 : -1));
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
            <b>{saysItsTime(l) ? "Updated:" : `Updated · ${time(l.at)}:`}</b> {/* Each person and test it names is its own green link; a line about a row keeps its other words opening that row, beside them. */}
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
      <button className="btn-ghost text-xs" onClick={() => { setHiddenUpTo(new Date(show[0].at).toISOString()); setUnhidden(new Set()); }}>Dismiss</button>
    </div>
    </>
  );
}
