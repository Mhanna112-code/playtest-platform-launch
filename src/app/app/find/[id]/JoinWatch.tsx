"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pageBusy, watchTyping } from "@/lib/pageBusy";
import { LIVE_TICK, noteRedrawAsked, onBoxLines, rideLiveClock } from "@/lib/liveSync";

/**
 * (Owner's repro, Oct 29, batch 30 §8) The join page follows the tester's own application or ask to rejoin, starting from the fingerprint the server rendered (`v`):
 * accepted → "You're back in “Harbor Run”: your deadline is …" (or "You're in: “Harbor Run”.") with "Go to your session →", and the page moves there unless something
 * is being typed; declined, closed or withdrawn → the page redraws with its line (the top box names a closing). Polled every 20 s, on the page's live tick and on focus.
 * (Owner, Oct 31, batch 35 §37) The 20 s are the page's one beat (lib/liveSync.ts), shared with the top box; JoinWatch is the join page's redraw driver: a new line
 * in the top box (a listing save, a closing) redraws the page at once.
 */
export function JoinWatch({ testId, v }: { testId: string; v: string }) {
  const router = useRouter();
  const last = useRef(v);
  useEffect(() => {
    last.current = v;
  }, [v]);
  const [back, setBack] = useState<{ line: string; href: string } | null>(null);
  useEffect(() => {
    let alive = true;
    watchTyping();
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch(`/api/pulse?join=${encodeURIComponent(testId)}`, { cache: "no-store" });
        if (!r.ok || !alive) return;
        const j = (await r.json()) as { v: string; back: { line: string; href: string } | null };
        if (j.v === last.current) return;
        last.current = j.v;
        if (j.back) {
          setBack(j.back);
          if (!pageBusy()) window.location.href = j.back.href;
        } else {
          noteRedrawAsked();
          router.refresh();
        }
      } catch {
        // offline: next time
      }
    };
    const leave = rideLiveClock();
    window.addEventListener(LIVE_TICK, check);
    const offLines = onBoxLines(() => {
      if (!alive) return false;
      router.refresh();
      return true;
    });
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      leave();
      window.removeEventListener(LIVE_TICK, check);
      offLines();
      window.removeEventListener("focus", check);
    };
  }, [testId, router]);
  if (!back) return null;
  return (
    <p className="info" role="status" data-join-back="">
      {back.line} <a href={back.href}>Go to your session →</a>
    </p>
  );
}
