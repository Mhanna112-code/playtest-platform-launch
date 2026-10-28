"use client";
import { useEffect } from "react";
import { jumpTo } from "@/lib/markJump";

/**
 * (Batch 15 section 42) A link from a bell line or the live box ("…#call-<id>") opens the fold it is in (a tester row's "Calls (N)", the tester's Call history) and marks it,
 * the same highlight as an in-page jump. Runs on load and when the hash changes.
 */
export function HashJump() {
  useEffect(() => {
    const go = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id && /^[\w-]+$/.test(id)) setTimeout(() => jumpTo(id), 150);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);
  return null;
}
