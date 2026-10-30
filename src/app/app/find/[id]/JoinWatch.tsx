"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pageBusy, watchTyping } from "@/lib/pageBusy";

/**
 * (Owner's repro, Oct 29, batch 30 §8) The join page follows the tester's own application or ask to rejoin, starting from the fingerprint the server rendered (`v`):
 * accepted → "You're back in “Harbor Run”: your deadline is …" (or "You're in: “Harbor Run”.") with "Go to your session →", and the page moves there unless something
 * is being typed; declined, closed or withdrawn → the page redraws with its line (the top box names a closing). Polled every 20 s, on the page's live tick and on focus.
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
        } else router.refresh();
      } catch {
        // offline: next time
      }
    };
    const t = setInterval(check, 20_000);
    window.addEventListener("live-tick", check);
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("live-tick", check);
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
