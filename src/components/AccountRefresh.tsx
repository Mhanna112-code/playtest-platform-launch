"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * (Owner, Oct 28, batch 16 section 27) Payments, the profile editor and Settings: when the card, subscription, payout account, profile or password changed in
 * another tab or device, the page's data refreshes silently on its poll (no line; boxes being typed in keep what was typed). The first press afterwards
 * stops once, from the page's own load time (the components keep it), listing what changed.
 */
export function AccountRefresh() {
  const router = useRouter();
  const last = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/account/changes", { cache: "no-store" });
        if (!r.ok) return;
        const { latest } = (await r.json()) as { latest: string | null };
        if (alive && last.current !== undefined && latest !== last.current) router.refresh();
        last.current = latest;
      } catch {
        // offline: next time
      }
    };
    void tick();
    const t = setInterval(tick, 20_000);
    const now = () => void tick();
    window.addEventListener("live-tick", now);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("live-tick", now);
    };
  }, [router]);
  return null;
}
