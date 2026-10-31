"use client";
import { useEffect } from "react";
import { hashTargets, jumpTo } from "@/lib/markJump";
import { restorePlace } from "@/lib/keepPlace";

/**
 * (Batch 15 section 42) A link from a bell line or the live box ("…#call-<id>") opens the fold it is in (a tester row's "Calls (N)", the tester's Call history) and marks it,
 * the same highlight as an in-page jump. Runs on load and when the hash changes. (Batch 35 §7) A target that's gone has a fallback: a paid piece's link
 * ("#piece-<id>", no longer in Needs you) goes to that part's line on its tester's row.
 * (Batch 35 §40) A page loaded again by `reloadKeepingPlace` comes back where it was (its "#…" was dropped first, so nothing is jumped to).
 */
export function HashJump() {
  useEffect(() => {
    const go = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id && /^[\w-]+$/.test(id)) setTimeout(() => jumpTo(hashTargets(id).find((t) => document.getElementById(t)) ?? id), 150);
    };
    if (!restorePlace()) go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);
  return null;
}
