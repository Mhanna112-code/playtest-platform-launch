"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { hashTargets, jumpTo } from "@/lib/markJump";
import { restorePlace } from "@/lib/keepPlace";

/**
 * (Batch 15 section 42) A link from a bell line or the live box ("…#call-<id>") opens the fold it is in (a tester row's "Had (N)" / "Cancelled (N)", the tester's Live session's, §209) and marks it,
 * the same highlight as an in-page jump. Runs on load and when the hash changes. (Batch 35 §7) A target that's gone has a fallback: a paid piece's link
 * ("#piece-<id>", no longer in Needs you) goes to that part's line on its tester's row.
 * (Batch 35 §40) A page loaded again by `reloadKeepingPlace` comes back where it was (its "#…" was dropped first, so nothing is jumped to).
 */
function go() {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (id && /^[\w-]+$/.test(id)) setTimeout(() => jumpTo(hashTargets(id).find((t) => document.getElementById(t)) ?? id), 150);
}

export function HashJump() {
  useEffect(() => {
    if (!restorePlace()) go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);
  // (Owner, Nov 5, §209) This sits in the layout, so a Link from another page of the app (the dashboard's upcoming call "…#call-<id>", its waiting call) didn't
  // mount it again and fired no "hashchange": the page opened at the top, the call's drop-down closed. A new page with a "#…" now jumps the same way.
  const pathname = usePathname();
  const shown = useRef(pathname);
  useEffect(() => {
    if (shown.current === pathname) return;
    shown.current = pathname;
    go();
  }, [pathname]);
  return null;
}
