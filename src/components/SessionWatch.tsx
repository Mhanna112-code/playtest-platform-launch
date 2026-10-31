"use client";
import { useEffect, useRef, useState } from "react";
import { setPageUser } from "@/lib/client";
import { usePathname } from "next/navigation";
import { restrictionKey } from "@/lib/restricted";
import { sideFor } from "@/lib/sides";
import { BELL_REFRESH, publishBell } from "./BellLink";
import { flushKept } from "@/lib/useKept";
import { KEPT_TYPED_LINE, dropStaleTyped, restoreTyped, saveTyped, tabStore, typedKey } from "@/lib/keepTyped";

// (Design doc 2; owner, Oct 27) Signed-in pages stay in step with the account: signing out in any tab signs out every tab and window of the browser
// (they all go to the sign-in page); signing in (in any tab) brings the tabs waiting on the login page back to where they were; signing in as a
// DIFFERENT account switches every other open tab to the new account, on the same page the new sign-in landed on (no cover screen); an old tab
// never sends a press as the previous account (every press names the account its page belongs to; the server refuses a mismatch and the tab switches); Back / Forward restore a page and bring it up to date; an account deleted meanwhile (by the team, or by
// the person on another device) sends every open tab to the login page with a red notice; (Owner, Oct 27) a suspension, a payment hold or a chargeback hold that starts while a
// page is open moves EVERY open page of that account to the TOP of the dashboard (a tab already there scrolls to the top), where the blue box explains; when it lifts, the pages refresh.

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

/**
 * (Owner, Oct 30, batch 35 §6) Before a tab moves because of another tab (the account switched sides; another account signed in), what was typed here is kept:
 * this page's typed fields go into the tab's sessionStorage under THIS account, side and path. On a side switch the forms' drafts are also sent to the server now
 * (still this account). Not on an account change: the browser's cookie is already the other account's, so nothing is sent (each kept request names this page's
 * account, and the server refuses it for another).
 */
async function keepTypedBeforeLeaving(userId: string, side: string | null | undefined, path: string, sameAccount: boolean) {
  try {
    saveTyped(tabStore(), document.querySelector("main"), typedKey(userId, side, path));
  } catch {
    // keeping is a nicety: the tab still moves
  }
  if (sameAccount) await flushKept().catch(() => null);
}

/** (Batch 35 §6) When this account, on this side, shows a path that has a snapshot in this tab: the fields still empty get it back (they may draw a moment later). */
function useRestoreTyped(userId: string, side: string | null | undefined, path: string) {
  const [kept, setKept] = useState(false);
  useEffect(() => {
    const store = tabStore();
    dropStaleTyped(store);
    const key = typedKey(userId, side, path);
    const timers = [0, 400, 1200, 3000, 6000].map((ms) =>
      setTimeout(() => {
        try {
          if (restoreTyped(store, document.querySelector("main"), key, Date.now(), document.activeElement) > 0) setKept(true);
        } catch {
          // keeping is a nicety
        }
      }, ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [userId, side, path]);
  useEffect(() => {
    if (!kept) return;
    const t = setTimeout(() => setKept(false), 10_000);
    return () => clearTimeout(t);
  }, [kept]);
  return { kept, dismiss: () => setKept(false) };
}

export function SessionWatch({ userId, restriction, side }: { userId: string; name?: string; restriction: string; side?: "developer" | "tester" | null }) {
  const path = usePathname();
  const pathRef = useRef(path);
  pathRef.current = path;
  const restored = useRestoreTyped(userId, side, path);
  const restrictionRef = useRef(restriction);
  const sideRef = useRef(side);
  sideRef.current = side;
  // Every press from this page names its account, so a press racing a switch of accounts is refused (see lib/client.ts).
  useEffect(() => setPageUser(userId), [userId]);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      let s: { state: string; bell?: number; userId?: string; name?: string; suspended?: boolean; testerSuspended?: boolean; held?: boolean; holdReason?: string; developer?: boolean; tester?: boolean; side?: string };
      try {
        s = await (await fetch("/api/account/status", { cache: "no-store" })).json();
      } catch {
        return; // offline: try again later
      }
      if (!alive) return;
      // (Owner, Oct 28) Backstop: a signed-in page whose main column came back empty (a redirect that landed in the middle of a refresh) is loaded again from the server.
      if (/^\/app/.test(pathRef.current) && s.state === "ok" && !document.querySelector("main")?.children.length) {
        window.location.reload();
        return;
      }
      // (Batch 29 §28) The bell's number, live on every page.
      if (s.state === "ok" && typeof s.bell === "number") publishBell(s.bell);
      if (s.state === "deleted") window.location.replace("/login?gone=1");
      else if (s.state === "out") window.location.replace(`/login?next=${encodeURIComponent(pathRef.current)}`);
      else if (s.userId && s.userId !== userId) {
        // A different account signed in elsewhere: switch to it. (Batch 35 §6) What was typed here stays in this tab for this account only.
        await keepTypedBeforeLeaving(userId, sideRef.current, pathRef.current, false);
        window.location.replace(landingOfNewSignIn());
      } else {
        if (sideRef.current && sideFor({ isDeveloper: !!s.developer, isTester: !!s.tester, side: s.side }, pathRef.current) !== sideRef.current) {
          // (Batch 35 §6) The account switched sides in another tab: this tab reloads to the new side, keeping what was typed.
          await keepTypedBeforeLeaving(userId, sideRef.current, pathRef.current, true);
          if (alive) window.location.reload();
          return;
        }
        // The restriction on THIS page's side (a payment hold only restricts the developer side).
        const who = { isDeveloper: !!s.developer, isTester: !!s.tester, side: s.side, devSuspendedAt: s.suspended ? "x" : null, testerSuspendedAt: s.testerSuspended ? "x" : null, holdStartedAt: s.held ? "x" : null, holdReason: s.holdReason };
        const now = restrictionKey(who, sideFor(who, pathRef.current));
        if (now !== restrictionRef.current) {
          const before = restrictionRef.current;
          restrictionRef.current = now;
          if (!before && now) {
            // It just began: this page moves to the top of the dashboard (already there: scroll up and refresh so the blue box shows).
            if (/^\/app\/?$/.test(pathRef.current)) {
              try { window.history.scrollRestoration = "manual"; } catch { /* ignore */ }
              window.scrollTo({ top: 0 });
              window.location.reload();
            } else window.location.replace("/app");
          } else window.location.reload();
        }
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
    // (Batch 29 §28) The tab coming back into focus checks at once (the bell's number too); so does a line opened on the Notifications page.
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onBell = () => void check();
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(BELL_REFRESH, onBell);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(BELL_REFRESH, onBell);
    };
  }, [userId]);

  if (!restored.kept) return null;
  return (
    <p role="status" className="fixed bottom-5 left-5 z-40 flex items-center gap-2 rounded-full border border-amber-300/40 bg-slate-900/95 px-4 py-2 text-sm text-amber-200 shadow-xl" data-kept-typed-line="">
      {KEPT_TYPED_LINE}
      <button type="button" className="text-xs text-slate-400 underline" onClick={restored.dismiss}>Dismiss</button>
    </p>
  );
}
