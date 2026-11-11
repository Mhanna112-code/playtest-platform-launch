"use client";
import { useEffect } from "react";
import { TAB, leaveMovedPage, pageScope, pageUser, setPageScope } from "@/lib/client";

/** (Owner, Nov 11, §380) The same browser's other tabs hear a new claim at once (other browsers and devices hear it on their next poll: pulse's `moved`). */
const CHANNEL = "pt-page-claim";

/**
 * (Owner, Nov 11, §380) One page at a time, across devices: opening a test page (or its Edit: the same page) or a session page claims it for this tab; the
 * newest copy always wins. From then every press here names the page (x-page), and any older copy disables its buttons and goes to the dashboard. Shown again
 * from the browser's memory (Back / Forward), the page claims it again: that is opening it.
 */
export function OnePage({ scope }: { scope: string }) {
  useEffect(() => {
    let alive = true;
    let channel: BroadcastChannel | null = null;
    try {
      channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    } catch {
      channel = null;
    }
    const claim = async () => {
      const r = await fetch("/api/page-claim", { method: "POST", headers: { "content-type": "application/json", "x-tab": TAB, ...(pageUser() ? { "x-uid": pageUser() } : {}) }, body: JSON.stringify({ scope }) }).catch(() => null);
      // Only a claim that landed names the page: a press or poll before it never reads as an older copy's.
      if (!alive || !r?.ok) return;
      setPageScope(scope);
      try {
        channel?.postMessage({ uid: pageUser(), scope, tab: TAB });
      } catch {
        // the other tabs still learn on their next poll
      }
    };
    void claim();
    const onMessage = (e: MessageEvent<{ uid?: string; scope?: string; tab?: string }>) => {
      const m = e.data;
      if (m && m.scope === scope && pageScope() === scope && m.tab !== TAB && (!m.uid || !pageUser() || m.uid === pageUser())) leaveMovedPage();
    };
    channel?.addEventListener("message", onMessage);
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) void claim();
    };
    window.addEventListener("pageshow", onShow);
    return () => {
      alive = false;
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      window.removeEventListener("pageshow", onShow);
      if (pageScope() === scope) setPageScope("");
    };
  }, [scope]);
  return null;
}
