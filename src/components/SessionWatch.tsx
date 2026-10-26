"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { closedForSuspended } from "@/lib/closedPages";

// (Design doc 2) Signed-in pages stay in step with the account: signing out in one tab sends the other open tabs to the login page;
// signing in (in any tab) brings the tabs waiting on the login page back to where they were; signing in as a DIFFERENT account hides
// the old account's pages; Back / Forward restore a page and bring it up to date; an account deleted meanwhile (by the team, or by
// the person on another device) sends every open tab to the login page with a red notice; a suspension that starts while a page
// is open routes the person to the dashboard (the closed pages) where the red box explains.

const KEY = "pt-auth";

/** Tell the other tabs: "in" (someone signed in) or "out" (signed out). */
export function announceAuth(event: "in" | "out") {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ event, at: Date.now() }));
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

export function SessionWatch({ userId, name, suspended }: { userId: string; name: string; suspended: boolean }) {
  const path = usePathname();
  const [other, setOther] = useState<string | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

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
      else if (s.userId && s.userId !== userId) setOther(s.name ?? "another account");
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

  if (!other) return null;
  // A different account signed in in another tab: this page belongs to the old account, so it is hidden.
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950 p-6" role="alertdialog" aria-label="Signed in as someone else" data-wrong-account="">
      <div className="card max-w-md space-y-3 text-center">
        <h2 className="text-lg font-semibold text-white">You&apos;re signed in as {other} in another tab</h2>
        <p className="text-sm text-slate-300">This page belongs to {name}, so it is hidden. Go on as {other}, or sign in as {name} again.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn" onClick={() => window.location.reload()}>Go on as {other}</button>
          <a className="btn-secondary no-underline hover:no-underline" href="/login">Sign in again</a>
        </div>
      </div>
    </div>
  );
}
