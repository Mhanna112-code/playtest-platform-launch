"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Keeps an open page current: polls a fingerprint every 20 s and refreshes the page's data when it changes. */
export function AutoRefresh({ query }: { query: string }) {
  const router = useRouter();
  const last = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      window.dispatchEvent(new Event("live-tick")); // the live top notice checks at the same moment
      try {
        const r = await fetch(`/api/pulse?${query}`, { cache: "no-store" });
        if (!r.ok) return;
        const { v } = (await r.json()) as { v: string };
        if (last.current !== null && v !== last.current && alive) router.refresh();
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
  }, [query, router]);
  return null;
}
