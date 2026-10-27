"use client";
import { useEffect, useRef } from "react";
import { setPageUser } from "@/lib/client";
import { usePathname } from "next/navigation";
import { closedForSuspended } from "@/lib/closedPages";

// (Design doc 2; owner, Oct 27) Signed-in pages stay in step with the account: signing out in any tab signs out every tab and window of the browser
// (they all go to the sign-in page); signing in (in any tab) brings the tabs waiting on the login page back to where they were; signing in as a
// DIFFERENT account switches every other open tab to the new account, on the same page the new sign-in landed on (no cover screen); an old tab
// never sends a press as the previous account (every press names the account its page belongs to; the server refuses a mismatch and the tab switches); Back / Forward restore a page and bring it up to date; an account deleted meanwhile (by the team, or by
// the person on another device) sends every open tab to the login page with a red notice; a suspension that starts while a page
// is open routes the person to the dashboard (the closed pages) where the red box explains.

const KEY = "pt-auth";

/** Tell the other tabs: "in" (someone signed in, landing on `to`) or "out" (signed out). */
export function announceAuth(event: "in" | "out", to = "") {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ event, at: Date.now(), to }));
  } catch {
    // storage blocked: the 20-second check still catches it
  }
}

/** The login page: when another tab signs in, go on (to `next`). */
export function useSignedInElsewhere(next = "/app") {
  useEffect(() => {
    const go = () => (window.location.href = next);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY || !e.newValue) return;
      try {
        if ((JSON.parse(e.newValue) as { event: string }).event === "in") go();
      } catch {
        // ignore
      }
    };
    const check = () => fetch("/api/account/status", { cache: "no-store" }).then((r) => r.json()).then((s: { state: string }) => s.state === "ok" && go()).catch(() => null);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", check);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", check);
    };
  }, [next]);
}

/** Where the newest sign-in (in this browser) landed: the page every other tab switches to. */
export function landingOfNewSignIn() {
  try {
    const n = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as { event: string; at: number; to?: string } | null;
    if (n && n.event === "in" && Date.now() - n.at < 10 * 60_000 && n.to && n.to.startsWith("/")) return n.to;
  } catch {
    // nothing stored
  }
  return "/app";
}

export function SessionWatch({ userId, suspended }: { userId: string; name?: string; suspended: boolean }) {
  const path = usePathname();
  const pathRef = useRef(path);
  pathRef.current = path;
  // Every press from this page names its account, so a press racing a switch of accounts is refused (see lib/client.ts).
  useEffect(() => setPageUser(userId), [userId]);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      let s: { state: string; userId?: string; name?: string; suspended?: boolean; developer?: boolean; tester?: boolean };
      try {
        s = await (await fetch("/api/account/status", { cache: "no-store" })).json();
      } catch {
        return; // offline: try again later
      }
      if (!alive) return;
      if (s.state === "deleted") window.location.href = "/login?gone=1";
      else if (s.state === "out") window.location.href = `/login?next=${encodeURIComponent(pathRef.current)}`;
      else if (s.userId && s.userId !== userId) window.location.href = landingOfNewSignIn(); // a different account signed in elsewhere: switch to it
      else if (s.suspended && !suspended) {
        // A suspension began while this page was open: closed pages go to the dashboard, which says what happened.
        if (closedForSuspended(pathRef.current, { isDeveloper: !!s.developer, isTester: !!s.tester })) window.location.href = "/app";
        else window.location.reload();
      }
    };
    const t = setInterval(check, 20_000);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) void check();
    };
    // Back / Forward restore a page from memory: bring it up to date (signed out meanwhile -> login).
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        void check();
        window.location.reload();
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", onShow);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onShow);
    };
  }, [userId, suspended]);

  return null;
}
