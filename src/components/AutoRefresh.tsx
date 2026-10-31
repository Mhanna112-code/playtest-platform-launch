"use client";
import { useEffect, useRef, useState } from "react";
import { pageBusy, watchTyping } from "@/lib/pageBusy";
import { useRouter } from "next/navigation";
import { bankCheckOpen } from "@/lib/bankConfirm";
import { PRESS_REFUSED_EVENT } from "@/lib/client";
import { publishIgnoredAlerts, publishTesterAlertsOff } from "@/lib/testerAlerts";
import { LIVE_TICK, liveBeat, noteRedrawAsked, onBoxLines, rideLiveClock } from "@/lib/liveSync";

/**
 * Keeps an open page current: polls a fingerprint every 20 s and refreshes the page's data when it changes (`refresh={false}`: only watches, e.g. on Edit, which must keep what was typed).
 * (Owner, Oct 31, batch 35 §37) It polls on the page's one 20-second beat (lib/liveSync.ts), the same tick as the live top box's check, and redraws at once when
 * that box finds a new line (the box then shows the line as the redraw lands).
 * (Owner, Oct 28) When the TEAM stops the test while a developer's test page or Edit is open, the page moves to the top of the test page at once (where the banner stays), not after a refused press.
 */
/** (Batch 19 section 5) True the first time for this key in this tab (sessionStorage; without it, always true once per page load). */
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

export function AutoRefresh({ query, refresh = true, v }: { query: string; refresh?: boolean; /** (Batch 17 section 9) The fingerprint the page was rendered with: a page shown again from the browser's cache (Back) refreshes at its first poll if it changed since. */ v?: string }) {
  const router = useRouter();
  const last = useRef<string | null>(v ?? null);
  // (Batch 19 section 5) The fingerprint the page is SHOWING (the `v` it was last rendered with): a poll that differs refreshes until the page shows it, so a refresh that
  // didn't take (a page shown again with Back) is tried again, and one that still hasn't shown after a few seconds loads the page again.
  const shown = useRef<string | null>(v ?? null);
  useEffect(() => {
    shown.current = v ?? null;
  }, [v]);
  const stopped = useRef<boolean | null>(null);
  const restrictedNow = useRef(false);
  // (Owner, Oct 28, batch 20 section 18) A last-resort reload never happens under someone's typing or an open box: it waits (a quiet "This page has updates ·
  // Refresh" shows meanwhile), and goes ahead only once nothing would be lost and the page still needs it.
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    let alive = true;
    watchTyping();
    const reloadWhenFree = (still: () => boolean) => {
      const go = () => {
        if (!alive || !still()) return setWaiting(false);
        if (pageBusy()) {
          setWaiting(true);
          setTimeout(go, 5000);
          return;
        }
        window.location.reload();
      };
      go();
    };
    const testId = /^test=([^&]+)/.exec(query)?.[1];
    // (Batch 35 §37) Runs on the page's beat ("live-tick"), the same tick as the live top box's check: no timer of its own.
    const tick = async () => {
      try {
        const r = await fetch(`/api/pulse?${query}`, { cache: "no-store" });
        if (!r.ok) return;
        const { v, adminStopped, restricted, alerts } = (await r.json()) as { v: string; adminStopped?: boolean; restricted?: boolean; alerts?: { ignored?: string[]; testerOff?: boolean } };
        // (Batch 20 section 8) The Alerts setting as saved now (changed in another browser or device): the menu, toggle and chips follow.
        if (alive && Array.isArray(alerts?.ignored)) publishIgnoredAlerts(alerts.ignored, false);
        if (alive && typeof alerts?.testerOff === "boolean") publishTesterAlertsOff(alerts.testerOff, false);
        if (testId && alive && stopped.current === false && adminStopped) {
          try { window.history.scrollRestoration = "manual"; } catch { /* ignore */ }
          window.location.href = `/app/tests/${testId}`; // Edit goes back to the test page; the test page reloads at its top
          return;
        }
        stopped.current = !!adminStopped;
        restrictedNow.current = !!restricted;
        // (Batch 17 §11) While the bank's check is open inline, the page waits: a refresh could move the piece (and the check) away from under the developer.
        if (refresh && bankCheckOpen()) return;
        // A suspension / hold is routed by SessionWatch (a hard move to the dashboard): refreshing a page the server is about to redirect would race it.
        const was = shown.current ?? last.current;
        if (refresh && !restricted && was !== null && v !== was && alive) {
          noteRedrawAsked(); // (batch 35 §37) the box's line of this same beat waits for this redraw instead of asking a second one
          router.refresh();
          // Backstop: if the refresh left the main column empty (the server redirected it mid-flight), load the page again.
          setTimeout(() => reloadWhenFree(() => !document.querySelector("main")?.children.length), 6000);
          // (Batch 19 section 5) A page with its own fingerprint that still shows the old one: load it again.
          // Once per polled fingerprint, so a page whose own fingerprint can't match never reloads in a loop.
          if (shown.current !== null) setTimeout(() => { if (alive && shown.current !== null && shown.current !== v && !bankCheckOpen() && onceFor(`${query}|${v}`)) reloadWhenFree(() => shown.current !== null && shown.current !== v && !bankCheckOpen()); }, 5000);
        }
        last.current = v;
      } catch {
        // offline: try again next time
      }
    };
    tick(); // its own poll at once (a page shown again from the cache); the beats follow
    const leave = rideLiveClock();
    const onBeat = () => void tick();
    window.addEventListener(LIVE_TICK, onBeat);
    // (Batch 35 §37) The live top box found a new line: the page redraws at once (not on Edit's watch-only AutoRefresh, not while the bank's check is open, not
    // while SessionWatch is routing a hold or suspension).
    const offLines = onBoxLines(() => {
      if (!alive || !refresh || bankCheckOpen() || restrictedNow.current) return false;
      router.refresh();
      return true;
    });
    // (Batch 19 section 5) Shown again from the browser's back/forward cache: check at once (the page may be older than the last poll it made before it was left).
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      if (shown.current === null && refresh) router.refresh();
      liveBeat(); // every check on the page, this poll included
    };
    window.addEventListener("pageshow", onShow);
    // (Owner, Oct 29, batch 28 §9) A press refused because the state changed: redraw at once (the same as the poll's refresh; typed text and open boxes are kept),
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
      offLines();
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener(PRESS_REFUSED_EVENT, onRefused);
    };
  }, [query, router, refresh]);
  if (!waiting) return null;
  return (
    <button type="button" className="fixed bottom-5 right-5 z-40 rounded-full border border-white/15 bg-slate-900/95 px-4 py-2 text-sm text-slate-200 shadow-xl" data-page-updates="" onClick={() => window.location.reload()}>
      This page has updates · Refresh
    </button>
  );
}
