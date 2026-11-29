"use client";
import { useEffect, useRef } from "react";
import { pageBusy, watchTyping } from "@/lib/pageBusy";
import { useRouter } from "next/navigation";
import { bankCheckOpen } from "@/lib/bankConfirm";
import { PRESS_REFUSED_EVENT, leaveMovedPage, pageHeaders } from "@/lib/client";
import { publishIgnoredAlerts, publishTesterAlertsOff } from "@/lib/testerAlerts";
import { LIVE_TICK, liveBeat, noteRedrawAsked, onBoxLines, rideLiveClock } from "@/lib/liveSync";
import { reloadKeepingPlace } from "@/lib/keepPlace";
import { publishShownVersion, setVersionSource } from "@/lib/pageVersion";

/**
 * Keeps an open page current: polls a fingerprint every 20 s and refreshes the page's data when it changes (`refresh={false}`: only watches, e.g. on Edit, which must keep what was typed).
 * Used by every page that redraws live (the session page, the test page and Edit, the dashboards, payments, profiles, the admin pages), each with its
 * own `query` for /api/pulse and the fingerprint it was rendered with (`v`).
 * It polls on the page's one 20-second beat (lib/liveSync.ts), the same tick as the live top box's check, and redraws at once when
 * that box finds a new line (the box then shows the line as the redraw lands).
 * When the TEAM stops the test while a developer's test page or Edit is open, the page moves to the top of the test page at once (where the banner stays), not after a refused press.
 *
 * What makes it poll or redraw (the main effect below):
 *   - the poll (`tick`): once at mount, then on every beat (LIVE_TICK); a beat comes at once on tab focus, a page shown again from the back/forward cache,
 *     and a refused press;
 *   - the live box's new lines (onBoxLines): a redraw at once, without a poll;
 *   - a refused press (PRESS_REFUSED_EVENT): a redraw at once, then a beat.
 */
/** True the first time for this key in this tab (sessionStorage; without it, always true once per page load). */
const reloadedFor = new Set<string>();
function onceFor(key: string) {
  if (reloadedFor.has(key)) return false;
  reloadedFor.add(key);
  try {
    const k = `autorefresh-reload:${key}`;
    if (window.sessionStorage.getItem(k)) return false;
    window.sessionStorage.setItem(k, "1");
  } catch {
    // storage blocked: the in-page set still stops a second try
  }
  return true;
}

export function AutoRefresh({ query, refresh = true, v, sessionActive }: { query: string; refresh?: boolean; sessionActive?: boolean; /** The fingerprint the page was rendered with: a page shown again from the browser's cache (Back) refreshes at its first poll if it changed since. */ v?: string }) {
  const router = useRouter();
  const shownActive = useRef(sessionActive);
  useEffect(() => { shownActive.current = sessionActive; }, [sessionActive]);
  const last = useRef<string | null>(v ?? null);
  // The fingerprint the page is SHOWING (the `v` it was last rendered with): a poll that differs refreshes until the page shows it, so a refresh that
  // didn't take (a page shown again with Back) is tried again, and one that still hasn't shown after a few seconds loads the page again.
  const shown = useRef<string | null>(v ?? null);
  useEffect(() => {
    shown.current = v ?? null;
    // The version the page shows now: a refusal or stop line from before a newer one goes.
    if (v) publishShownVersion(query, v);
  }, [v, query]);
  // A line's baseline: this page's version on the server when the line appeared (the same poll). Only a page drawn with a fingerprint.
  useEffect(() => {
    if (v === undefined || !refresh) return;
    return setVersionSource(query, () => fetch(`/api/pulse?${query}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j: { v?: unknown } | null) => (typeof j?.v === "string" ? j.v : null)));
  }, [query, refresh, v === undefined]); // eslint-disable-line react-hooks/exhaustive-deps
  const stopped = useRef<boolean | null>(null);
  const restrictedNow = useRef(false);
  // A last-resort reload waits quietly while someone is typing or has a box open,
  // and goes ahead only once nothing would be lost and the page still needs it.
  useEffect(() => {
    let alive = true;
    watchTyping();
    const reloadWhenFree = (still: () => boolean) => {
      const go = () => {
        if (!alive || !still()) return;
        if (pageBusy()) {
          setTimeout(go, 5000);
          return;
        }
        reloadKeepingPlace(); // back at the same place, never at a stale "#…"
      };
      go();
    };
    const testId = /^test=([^&]+)/.exec(query)?.[1];
    /**
     * The poll: runs on the page's beat ("live-tick"), the same tick as the live top box's check: no timer of its own.
     *   1. Fetch the page's state (/api/pulse): its fingerprint `v` and what else the page must follow.
     *   2. Opened somewhere else (`moved`): leave the page; nothing else matters.
     *   3. Follow the Alerts as saved now (the test's ticked-off types, the tester's Alerts Off).
     *   4. The team stopped the test while it is open: go to the top of the test page.
     *   5. Note the stop and the hold; the bank's check open: wait.
     *   6. A session rejoined while this page shows it ended: load the page again (once).
     *   7. The fingerprint changed (and no hold is being routed): redraw, with two backstops (an empty main column; a redraw that didn't take).
     *   8. Remember this fingerprint. Offline: try again on the next beat.
     */
    const tick = async () => {
      try {
        // 1. A one-at-a-time page names itself: the answer says whether this copy was opened somewhere else since.
        const r = await fetch(`/api/pulse?${query}`, { cache: "no-store", headers: pageHeaders() });
        if (!r.ok) return;
        const { v, adminStopped, restricted, alerts, sessionActive: activeNow, moved } = (await r.json()) as { v: string; sessionActive?: boolean; adminStopped?: boolean; restricted?: boolean; alerts?: { ignored?: string[]; v?: number; testerOff?: boolean }; moved?: boolean };
        // 2. Opened somewhere else: every button here is disabled and the tab goes to the dashboard (nothing else on this poll matters).
        if (alive && moved) {
          leaveMovedPage();
          return;
        }
        // 3. The Alerts setting as saved now (changed in another browser or device): the menu, toggle and chips follow.
        if (alive && testId && Array.isArray(alerts?.ignored)) publishIgnoredAlerts(testId, alerts.ignored, false, alerts.v); // this test's; never over a newer save
        if (alive && typeof alerts?.testerOff === "boolean") publishTesterAlertsOff(alerts.testerOff, false);
        // 4. The team stopped the test since the last poll.
        if (testId && alive && stopped.current === false && adminStopped) {
          try { window.history.scrollRestoration = "manual"; } catch { /* ignore */ }
          window.location.href = `/app/tests/${testId}`; // Edit goes back to the test page; the test page reloads at its top
          return;
        }
        // 5. The stop and the hold as polled; while the bank's check is open, nothing below.
        stopped.current = !!adminStopped;
        restrictedNow.current = !!restricted;
        // While the bank's check is open inline, the page waits: a refresh could move the piece (and the check) away from under the developer.
        if (refresh && bankCheckOpen()) return;
        // 6. Rejoining restores the same session URL. Load its current server tree rather than retaining an ended client view.
        if (refresh && shownActive.current === false && activeNow === true && alive && onceFor(`${query}|rejoined|${v}`)) {
          reloadWhenFree(() => shownActive.current === false && !bankCheckOpen());
          return;
        }
        // 7. A suspension / hold is routed by SessionWatch (a hard move to the dashboard): refreshing a page the server is about to redirect would race it.
        const was = shown.current ?? last.current;
        if (refresh && !restricted && was !== null && v !== was && alive) {
          noteRedrawAsked(); // the box's line of this same beat waits for this redraw instead of asking a second one
          router.refresh();
          // Backstop: if the refresh left the main column empty (the server redirected it mid-flight), load the page again.
          setTimeout(() => reloadWhenFree(() => !document.querySelector("main")?.children.length), 6000);
          // A page with its own fingerprint that still shows the old one: load it again.
          // Once per polled fingerprint, so a page whose own fingerprint can't match never reloads in a loop.
          if (shown.current !== null) setTimeout(() => { if (alive && shown.current !== null && shown.current !== v && !bankCheckOpen() && onceFor(`${query}|${v}`)) reloadWhenFree(() => shown.current !== null && shown.current !== v && !bankCheckOpen()); }, 5000);
        }
        // 8. The fingerprint polled.
        last.current = v;
      } catch {
        // offline: try again next time
      }
    };
    tick(); // its own poll at once (a page shown again from the cache); the beats follow
    const leave = rideLiveClock();
    const onBeat = () => void tick();
    window.addEventListener(LIVE_TICK, onBeat);
    window.addEventListener("focus", liveBeat);
    // The live top box found a new line: the page redraws at once (not on Edit's watch-only AutoRefresh, not while the bank's check is open, not
    // while SessionWatch is routing a hold or suspension).
    const offLines = onBoxLines(() => {
      if (!alive || !refresh || bankCheckOpen() || restrictedNow.current) return false;
      router.refresh();
      return true;
    });
    // Shown again from the browser's back/forward cache: check at once (the page may be older than the last poll it made before it was left).
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      if (shown.current === null && refresh) router.refresh();
      liveBeat(); // every check on the page, this poll included
    };
    window.addEventListener("pageshow", onShow);
    // A press refused because the state changed: redraw at once (the same as the poll's refresh; typed text and open boxes are kept),
    // then check the fingerprint as usual. Not while the bank's check is open.
    const onRefused = () => {
      if (!alive || !refresh || bankCheckOpen()) return;
      router.refresh();
      liveBeat();
    };
    window.addEventListener(PRESS_REFUSED_EVENT, onRefused);
    return () => {
      alive = false;
      leave();
      window.removeEventListener(LIVE_TICK, onBeat);
      window.removeEventListener("focus", liveBeat);
      offLines();
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener(PRESS_REFUSED_EVENT, onRefused);
    };
  }, [query, router, refresh]);
  return null;
}
