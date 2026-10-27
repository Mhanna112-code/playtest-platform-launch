"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

// (Owner, Oct 28) A signed-in page can lose its whole app shell (header, main and SessionWatch) when the server redirects it in the middle of a
// refresh, e.g. a hold or a deletion landing while the page refreshes: the tab shows only the footer and nothing inside it can recover.
// This lives in the root layout, outside the app shell, so it survives that: on an /app page with no shell for two checks in a row, it loads
// the page again from the server, which then redirects it properly (to the dashboard top, or the login page).
export function ShellWatch() {
  const path = usePathname();
  useEffect(() => {
    if (!/^\/app(\/|$)/.test(path)) return;
    let misses = 0;
    const t = setInterval(() => {
      misses = document.querySelector("[data-app-shell]") ? 0 : misses + 1;
      if (misses >= 2) {
        clearInterval(t);
        // At most 3 reloads a minute, so a page that really renders without the shell never loops.
        let recent: number[] = [];
        try {
          recent = (JSON.parse(sessionStorage.getItem("pt-shell-reloads") ?? "[]") as number[]).filter((at) => Date.now() - at < 60_000);
          sessionStorage.setItem("pt-shell-reloads", JSON.stringify([...recent, Date.now()]));
        } catch {
          // storage blocked: reload anyway
        }
        if (recent.length < 3) window.location.reload();
      }
    }, 1500);
    return () => clearInterval(t);
  }, [path]);
  return null;
}
