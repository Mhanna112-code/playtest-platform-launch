"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TAB, leaveMovedPage, leftMovedPage, pageScope, pageShown, pageUser, resetMovedPage, setPageScope, setPageShown } from "@/lib/client";
import { lockForClaim, onPressIdle, pressInFlight, pressOnItsWay, releaseAll } from "@/lib/pageLock";
import { prevTab, watchPageLeft } from "@/lib/sameTab";
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
 * (Owner, Nov 12: the new copy is locked from its first draw until its claim answers) Until then a press would go out before the claim, possibly while the old
 * copy's press is still on its way. Claimed: unlocked. Waiting: stays locked, with the wait line. The claim failed (an error, offline): unlocked, the page stays
 * usable. Back (`pageshow` persisted) re-claims the same way. This lock is not a press (lib/pageLock.ts lockForClaim): nobody waits for it.
 * (Owner, Dec 10 2026: claim again when the connection returns and before its next press, like a fresh open) A copy whose claim failed names its page on every
 * press from its first draw (lib/client.ts setPageShown: the server refuses it while another tab holds the page) and claims again when the browser is back
 * online, when the tab is shown again, and before its next press (that press goes out only after the claim). Like a fresh open (the same lock, the same wait for
 * a busy holder), except the copy opened later wins: when another copy claimed the page after this one loaded (the server compares, `loadedAgo`), this copy
 * leaves like a moved page, its unsent drafts kept.
 * (Owner, Nov 28) The same browser tab never waits for itself: a press that ends with a full page load (Edit's Save, ...) gets a new tab id on the next load, so
 * the claim names the load this tab showed before (`prev`, lib/sameTab.ts) and takes the page at once. And a copy going away (pagehide) whose press already
 * answered lets go of its busy mark (a copy waiting elsewhere takes the page at once); a press still on its way keeps it (the server may yet change the page).
 */
export function OnePage({ scope, poll = false }: { scope: string; /** (§380 K) a page with no poll of its own (AutoRefresh) asks on the live beat whether it was opened somewhere else */ poll?: boolean }) {
  const router = useRouter();
  const [waiting, setWaiting] = useState(false);
  const [openNow, setOpenNow] = useState<(() => void) | null>(null);
  useEffect(() => {
    let alive = true;
    let run = 0;
    watchPageLeft();
    /** The newest claim's lock: let go at once when this copy goes away (its claim stops asking). */
    let freeClaim: (() => void) | null = null;
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
        router.refresh(); // what the old copy's press changed
      }
    };
    /** (Owner, Dec 10 2026) When this copy loaded (or was opened again from the browser's memory), by the steady clock: a claim again says how long ago. */
    let loadedAt = performance.now();
    /** The claim on its way, if any: a claim again joins it rather than sending another. */
    let claiming: Promise<void> | null = null;
    /** Open (or re-open) the page: claim it, waiting for the old copy's press when it has one on its way. Every button locked until the claim answers. */
    const claim = (again = false) => {
      const mine = ++run;
      const unlock = lockForClaim();
      freeClaim = unlock;
      const p: Promise<void> = claimLoop(mine, again).finally(() => {
        unlock(); // claimed, failed, or this copy closed / re-claimed (a newer claim keeps its own lock)
        if (claiming === p) claiming = null;
      });
      claiming = p;
      return p;
    };
    /** (Owner, Dec 10 2026) Claim again after a claim that failed (back online, shown again, before the next press). Nothing to do while it holds the page. */
    const claimAgain = (): Promise<void> => {
      if (!alive || pageScope() === scope || leftMovedPage()) return Promise.resolve();
      return claiming ?? claim(true);
    };
    setPageShown(scope, claimAgain, () => prevTab());
    const claimLoop = async (mine: number, again: boolean) => {
      let now = false;
      let waited = false;
      for (;;) {
        const prev = prevTab();
        const r = await post("/api/page-claim", { scope, ...(prev ? { prev } : {}), ...(now ? { now: true } : {}), ...(again ? { loadedAgo: Math.max(0, Math.round(performance.now() - loadedAt)) } : {}) });
        if (!alive || mine !== run) return;
        // Only a claim that landed names the page: a poll before it never reads as an older copy's.
        if (r?.claimed === true) return hold(waited);
        // (Owner, Dec 10 2026) Claiming again: another copy claimed the page after this one loaded. It keeps it; this copy leaves (drafts kept).
        if (r?.moved === true) {
          if (waited) setWaiting(false);
          leaveMovedPage();
          return;
        }
        if (r?.waiting !== true) {
          if (waited) setWaiting(false);
          return;
        }
        if (!waited) {
          waited = true;
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
      loadedAt = performance.now();
      void claim().then(() => {
        if (alive && pageScope() === scope) router.refresh();
      });
    };
    window.addEventListener("pageshow", onShow);
    // Going away (a full navigation after a press, a reload, closing): a press that already answered is no longer waited for. Not while handing over (it does).
    const onHide = () => {
      if (pageScope() !== scope || handing || pressOnItsWay()) return;
      void post("/api/page-handover", { scope, release: true });
    };
    window.addEventListener("pagehide", onHide);
    // (Owner, Dec 10 2026) A copy whose claim failed claims again when the browser is back online and when the tab is shown again.
    const onOnline = () => void claimAgain();
    const onVisible = () => {
      if (document.visibilityState === "visible") void claimAgain();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
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
      freeClaim?.();
      offClock?.();
      if (poll) window.removeEventListener(LIVE_TICK, ask);
      offIdle();
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      if (pageScope() === scope) setPageScope("");
      if (pageShown() === scope) setPageShown("");
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
