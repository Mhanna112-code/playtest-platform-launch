"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TAB, leaveMovedPage, pageScope, pageUser, resetMovedPage, setPageScope } from "@/lib/client";
import { lockPage, onPressIdle, pressInFlight, releaseAll, unlockPage } from "@/lib/pageLock";
import { flushKept } from "@/lib/useKept";
import { HANDOVER_LINE, HANDOVER_OPEN_NOW } from "@/lib/pageClaim";
import { LIVE_TICK, rideLiveClock } from "@/lib/liveSync";

/** (Owner, Nov 11, §380) The same browser's other tabs hear a new claim at once (other browsers and devices hear it on their next poll: pulse's `moved`). */
const CHANNEL = "pt-page-claim";
/** (§380 J) How often a waiting copy asks again whether the old one has handed over. */
const ASK_MS = 500;

type Msg = { kind?: "claimed" | "want"; uid?: string; scope?: string; tab?: string };
const post = (path: string, body: Record<string, unknown>) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-tab": TAB, ...(pageUser() ? { "x-uid": pageUser() } : {}) }, body: JSON.stringify(body), keepalive: true })
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, unknown>>) : null))
    .catch(() => null);

/**
 * (Owner, Nov 11, §380) One page at a time, across devices: opening a one-at-a-time page (lib/pageClaim.ts) claims it for this tab. From then every press here names
 * the page (x-page), and any older copy disables its buttons and goes to the dashboard.
 * (Owner, Nov 11, §380 J) The handover: the new copy asks whether the old one has a press on its way. If so, it shows "Saving changes in other tab…" with "Open now"
 * and waits (every button locked; at most ~10 s, the server's cap) while the old copy finishes its press (answer and redraw), keeps its unsent drafts and hands
 * over; then it redraws with what that press changed. The old copy, once its press is over, keeps its drafts, hands over and goes to the dashboard ("This page
 * was opened somewhere else."). A bank check left open isn't a press on its way (the page was freed when it showed), so it is never waited for.
 * Going BACK to an older copy (the browser's memory, `pageshow` persisted) is opening it again: the same claim and handover, and the other copy leaves.
 */
export function OnePage({ scope, poll = false }: { scope: string; /** (§380 K) a page with no poll of its own (AutoRefresh) asks on the live beat whether it was opened somewhere else */ poll?: boolean }) {
  const router = useRouter();
  const [waiting, setWaiting] = useState(false);
  const [openNow, setOpenNow] = useState<(() => void) | null>(null);
  useEffect(() => {
    let alive = true;
    let run = 0;
    let channel: BroadcastChannel | null = null;
    try {
      channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    } catch {
      channel = null;
    }
    const say = (kind: Msg["kind"]) => {
      try {
        channel?.postMessage({ kind, uid: pageUser(), scope, tab: TAB } satisfies Msg);
      } catch {
        // the other tabs still learn on their next poll
      }
    };
    const hold = (afterWait: boolean) => {
      setPageScope(scope);
      say("claimed");
      if (afterWait) {
        setWaiting(false);
        setOpenNow(null);
        unlockPage();
        router.refresh(); // what the old copy's press changed
      }
    };
    /** Open (or re-open) the page: claim it, waiting for the old copy's press when it has one on its way. */
    const claim = async () => {
      const mine = ++run;
      let now = false;
      let waited = false;
      for (;;) {
        const r = await post("/api/page-claim", { scope, ...(now ? { now: true } : {}) });
        if (!alive || mine !== run) return;
        // Only a claim that landed names the page: a press or poll before it never reads as an older copy's.
        if (r?.claimed === true) return hold(waited);
        if (r?.waiting !== true) {
          if (waited) {
            setWaiting(false);
            unlockPage();
          }
          return;
        }
        if (!waited) {
          waited = true;
          lockPage();
          setWaiting(true);
          say("want");
        }
        await new Promise<void>((done) => {
          const t = setTimeout(done, ASK_MS);
          setOpenNow(() => () => {
            clearTimeout(t);
            now = true;
            done();
          });
        });
        if (!alive || mine !== run) return;
      }
    };
    void claim();

    // The copy holding the page: hand it over to a newer copy waiting (drafts kept first), then leave.
    let handing = false;
    const handOver = async () => {
      if (handing || pageScope() !== scope) return;
      handing = true;
      await flushKept().catch(() => null);
      await post("/api/page-handover", { scope, release: true });
      leaveMovedPage();
    };
    // Its press is over (answered, redraw landed): no longer busy; a newer copy may be waiting for it.
    const offIdle = onPressIdle(() => {
      if (pageScope() !== scope || handing) return;
      void post("/api/page-handover", { scope }).then((r) => {
        if (!alive) return;
        if (r?.wanted === true) void handOver();
        else if (r?.moved === true) leaveMovedPage();
      });
    });
    const onMessage = (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (!m || m.scope !== scope || m.tab === TAB || (m.uid && pageUser() && m.uid !== pageUser())) return;
      if (pageScope() !== scope) return;
      // A newer copy in this browser took the page: leave (drafts kept).
      if (m.kind !== "want") return void leaveMovedPage();
      // A newer copy in this browser waits: with no press on its way here, hand over now (else when it's over: onPressIdle).
      if (!pressInFlight()) void handOver();
    };
    channel?.addEventListener("message", onMessage);
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      // Back to this copy from the browser's memory: opened again. Nothing it held before counts (its lock, its "moved").
      releaseAll();
      resetMovedPage();
      handing = false;
      setPageScope("");
      void claim().then(() => {
        if (alive && pageScope() === scope) router.refresh();
      });
    };
    window.addEventListener("pageshow", onShow);
    // (§380 K) A page with no poll of its own: another browser or device opening it is learned on the live beat.
    const ask = async () => {
      if (pageScope() !== scope || document.visibilityState === "hidden") return;
      const r = await fetch(`/api/page-claim?scope=${encodeURIComponent(scope)}`, { cache: "no-store", headers: { "x-tab": TAB } }).then((x) => (x.ok ? (x.json() as Promise<{ moved?: boolean }>) : null)).catch(() => null);
      if (alive && r?.moved === true && pageScope() === scope) leaveMovedPage();
    };
    const offClock = poll ? rideLiveClock() : null;
    if (poll) window.addEventListener(LIVE_TICK, ask);
    return () => {
      alive = false;
      offClock?.();
      if (poll) window.removeEventListener(LIVE_TICK, ask);
      offIdle();
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      window.removeEventListener("pageshow", onShow);
      if (pageScope() === scope) setPageScope("");
    };
  }, [scope, poll, router]);
  if (!waiting) return null;
  return (
    <div className="info fixed inset-x-0 top-16 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] flex-wrap items-center gap-3" role="status" data-handover="" data-press-free="">
      <span>{HANDOVER_LINE}</span>
      <button type="button" className="btn-secondary px-3 py-1 text-sm" data-handover-now="" onClick={() => openNow?.()}>{HANDOVER_OPEN_NOW}</button>
    </div>
  );
}
