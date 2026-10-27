"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps an open page current: polls a fingerprint every 20 s and refreshes the page's data when it changes (`refresh={false}`: only watches, e.g. on Edit, which must keep what was typed).
 * (Owner, Oct 28) When the TEAM stops the test while a developer's test page or Edit is open, the page moves to the top of the test page at once (where the banner stays), not after a refused press.
 */
export function AutoRefresh({ query, refresh = true }: { query: string; refresh?: boolean }) {
  const router = useRouter();
  const last = useRef<string | null>(null);
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
        // A suspension / hold is routed by SessionWatch (a hard move to the dashboard): refreshing a page the server is about to redirect would race it.
        if (refresh && !restricted && last.current !== null && v !== last.current && alive) {
          router.refresh();
          // Backstop: if the refresh left the main column empty (the server redirected it mid-flight), load the page again.
          setTimeout(() => { if (alive && !document.querySelector("main")?.children.length) window.location.reload(); }, 6000);
        }
        last.current = v;
      } catch {
        // offline: try again next time
      }
    };
    tick();
    const t = setInterval(tick, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [query, router, refresh]);
  return null;
}
