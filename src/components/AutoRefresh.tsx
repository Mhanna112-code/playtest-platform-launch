"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { bankCheckOpen } from "@/lib/bankConfirm";

/**
 * Keeps an open page current: polls a fingerprint every 20 s and refreshes the page's data when it changes (`refresh={false}`: only watches, e.g. on Edit, which must keep what was typed).
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
  useEffect(() => {
    let alive = true;
    const testId = /^test=([^&]+)/.exec(query)?.[1];
    const tick = async () => {
      window.dispatchEvent(new Event("live-tick")); // the live top notice checks at the same moment
      try {
        const r = await fetch(`/api/pulse?${query}`, { cache: "no-store" });
        if (!r.ok) return;
        const { v, adminStopped, restricted } = (await r.json()) as { v: string; adminStopped?: boolean; restricted?: boolean };
        if (testId && alive && stopped.current === false && adminStopped) {
          try { window.history.scrollRestoration = "manual"; } catch { /* ignore */ }
          window.location.href = `/app/tests/${testId}`; // Edit goes back to the test page; the test page reloads at its top
          return;
        }
        stopped.current = !!adminStopped;
        // (Batch 17 §11) While the bank's check is open inline, the page waits: a refresh could move the piece (and the check) away from under the developer.
        if (refresh && bankCheckOpen()) return;
        // A suspension / hold is routed by SessionWatch (a hard move to the dashboard): refreshing a page the server is about to redirect would race it.
        const was = shown.current ?? last.current;
        if (refresh && !restricted && was !== null && v !== was && alive) {
          router.refresh();
          // Backstop: if the refresh left the main column empty (the server redirected it mid-flight), load the page again.
          setTimeout(() => { if (alive && !document.querySelector("main")?.children.length) window.location.reload(); }, 6000);
          // (Batch 19 section 5) A page with its own fingerprint that still shows the old one: load it again.
          // Once per polled fingerprint, so a page whose own fingerprint can't match never reloads in a loop.
          if (shown.current !== null) setTimeout(() => { if (alive && shown.current !== null && shown.current !== v && !bankCheckOpen() && onceFor(`${query}|${v}`)) window.location.reload(); }, 5000);
        }
        last.current = v;
      } catch {
        // offline: try again next time
      }
    };
    tick();
    const t = setInterval(tick, 20_000);
    // (Batch 19 section 5) Shown again from the browser's back/forward cache: check at once (the page may be older than the last poll it made before it was left).
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      if (shown.current === null && refresh) router.refresh();
      void tick();
    };
    window.addEventListener("pageshow", onShow);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("pageshow", onShow);
    };
  }, [query, router, refresh]);
  return null;
}
