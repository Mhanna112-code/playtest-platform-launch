/**
 * (Owner, Nov 12, §380 J) The new copy is locked from its first draw until its claim answers. Before the claim lands, a press here would name no page (x-page)
 * and so skip the server's one-page check, possibly while the old copy's press is still on its way. OnePage is mounted with react-dom/client on the small DOM
 * (tests/mini-dom.ts) and the claim's answer is held back by the test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniDom, miniEvent, textOf, type MiniDocument } from "./mini-dom";

let refreshed = 0;
// The App Router isn't mounted here. Its router is one object for the page's life (OnePage's effect depends on it), so the mock's is too.
vi.mock("next/navigation", () => {
  const router = { refresh: () => void refreshed++, push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} };
  return { useRouter: () => router, usePathname: () => "/app/tests/t1", useSearchParams: () => new URLSearchParams() };
});

type React = typeof import("react");
let R: React;
let act: React["act"];
let createRoot: typeof import("react-dom/client").createRoot;
let OnePage: typeof import("@/components/OnePage").OnePage;
let client: typeof import("@/lib/client");
let lock: typeof import("@/lib/pageLock");
let sameTab: typeof import("@/lib/sameTab");
let HANDOVER_LINE: string;
let dom: ReturnType<typeof installMiniDom>;

const SCOPE = "test:t1";
type Sent = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
let sent: Sent[] = [];
/** Each page claim waits here until the test answers it (a reply, or `null`: the request fails, as offline). */
let claims: { body: Record<string, unknown>; answer: (r: { status: number; data: unknown } | null) => void }[] = [];
const realFetch = globalThis.fetch;
const realChannel = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  dom = installMiniDom("/app/tests/t1");
  // No real channel between the test's copies (Node has one): the other tabs in a browser learn on their poll too.
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (url.startsWith("/api/page-claim")) {
      sent.push({ url, body, headers });
      return new Promise<Response>((ok, fail) => claims.push({ body, answer: (r) => (r ? ok(json(r.status, r.data)) : fail(new TypeError("Failed to fetch"))) }));
    }
    if (url.startsWith("/api/page-handover")) {
      sent.push({ url, body, headers });
      return json(200, {});
    }
    if (url.startsWith("/api/kept")) return json(200, {});
    if (url.startsWith("/api/")) {
      sent.push({ url, body, headers });
      return json(200, { ok: true });
    }
    return json(404, {});
  }) as typeof fetch;
  R = await import("react");
  (globalThis as unknown as { React: React }).React = R;
  act = R.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ OnePage } = await import("@/components/OnePage"));
  ({ HANDOVER_LINE } = await import("@/lib/pageClaim"));
  client = await import("@/lib/client");
  lock = await import("@/lib/pageLock");
  sameTab = await import("@/lib/sameTab");
});

afterAll(() => {
  globalThis.fetch = realFetch;
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = realChannel;
  dom.undo();
});

beforeEach(() => {
  sent = [];
  claims = [];
  refreshed = 0;
  lock.releaseAll();
  client.setPageScope("");
  client.resetMovedPage();
});

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** The new copy: OnePage and one press on the page (Stop, as a real press: lib/client's api). */
async function mount() {
  const doc = dom.doc as MiniDocument;
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const stop = () => void client.api("/api/tests/t1/stop", { reason: "We have what we need." }).catch(() => null);
  await act(async () => root.render(R.createElement(R.Fragment, null, R.createElement(OnePage, { scope: SCOPE }), R.createElement("button", { type: "button", onClick: stop }, "Stop"))));
  const button = (name: RegExp) => container.querySelectorAll("button").find((b) => name.test(textOf(b)))!;
  const press = async (name = /^Stop$/) => {
    await act(async () => { button(name).dispatchEvent(miniEvent("click")); });
    await tick();
  };
  /** Answer the newest claim on its way. */
  const answer = async (r: { status: number; data: unknown } | null) => {
    const c = claims.shift();
    if (!c) throw new Error("no claim on its way");
    await act(async () => { c.answer(r); });
    await tick();
  };
  return { container, press, answer, done: () => act(async () => root.unmount()).then(() => container.remove()) };
}
const stops = () => sent.filter((s) => /\/stop$/.test(s.url));
const locked = () => lock.pageLocked() && (dom.doc as MiniDocument).body.getAttribute("data-page-locked") === "";

describe("§380 J: the new copy is locked from its first draw until its claim answers", () => {
  it("(1) before the claim answers: every button locked, a press is not sent (it would carry no x-page); the claim itself is no press", async () => {
    const p = await mount();
    expect(claims.length).toBe(1);
    expect(locked()).toBe(true);
    expect(lock.pressInFlight()).toBe(false); // not a press on its way: no busy mark, nobody waits for it
    await p.press();
    expect(stops()).toEqual([]);
    const claim = sent.find((s) => s.url === "/api/page-claim")!;
    expect(claim.headers["x-press"]).toBeUndefined();
    await p.answer({ status: 200, data: { claimed: true } });
    await p.done();
  });

  it("(2) claimed: unlocked, the page named (x-page on the next press), no redraw (nothing was waited for)", async () => {
    const p = await mount();
    await p.answer({ status: 200, data: { claimed: true } });
    expect(locked()).toBe(false);
    expect(client.pageScope()).toBe(SCOPE);
    expect(refreshed).toBe(0);
    await p.press();
    expect(stops().length).toBe(1);
    expect(stops()[0].headers["x-page"]).toBe(SCOPE);
    expect(stops()[0].headers["x-press"]).toBe("1");
    await p.done();
  });

  it("(3) waiting: stays locked with the wait line; Open now stays pressable; once claimed, unlocked and redrawn", async () => {
    const p = await mount();
    await p.answer({ status: 200, data: { claimed: false, waiting: true } });
    expect(locked()).toBe(true);
    expect(textOf(p.container)).toContain(HANDOVER_LINE);
    await p.press();
    expect(stops()).toEqual([]);
    // Open now (data-press-free) goes through the lock: the next claim asks with `now`.
    await p.press(/^Open now$/);
    expect(claims.length).toBe(1);
    expect(claims[0].body).toEqual({ scope: SCOPE, now: true });
    expect(locked()).toBe(true);
    await p.answer({ status: 200, data: { claimed: true } });
    expect(locked()).toBe(false);
    expect(textOf(p.container)).not.toContain(HANDOVER_LINE);
    expect(refreshed).toBe(1);
    await p.done();
  });

  it("(4) the claim fails (server error, a refusal, offline): unlocked, the page stays usable", async () => {
    for (const r of [{ status: 500, data: {} }, { status: 400, data: { error: { code: "bad", message: "No." } } }, null]) {
      sent = [];
      lock.releaseAll(); // the last round's press (gone through: its redraw's grace)
      const p = await mount();
      expect(locked()).toBe(true);
      await p.answer(r);
      expect(locked(), JSON.stringify(r)).toBe(false);
      // (Owner, Dec 10 2026) Its next press claims again first (tests/claim-again-page-380.test.ts), then goes out naming the page.
      await p.press();
      expect(stops(), JSON.stringify(r)).toEqual([]);
      await p.answer({ status: 200, data: { claimed: true } });
      expect(stops().length, JSON.stringify(r)).toBe(1);
      expect(stops()[0].headers["x-page"]).toBe(SCOPE);
      await p.done();
    }
    // A wait that ends with neither answer: unlocked too, the wait line gone.
    lock.releaseAll();
    const p = await mount();
    await p.answer({ status: 200, data: { claimed: false, waiting: true } });
    await p.press(/^Open now$/);
    await p.answer(null);
    expect(locked()).toBe(false);
    expect(textOf(p.container)).not.toContain(HANDOVER_LINE);
    await p.done();
  });

  it("Back to this copy from the browser's memory (pageshow persisted) re-claims with the same lock until the answer; closing the copy lets go at once", async () => {
    const p = await mount();
    await p.answer({ status: 200, data: { claimed: true } });
    expect(locked()).toBe(false);
    const back = Object.assign(new Event("pageshow"), { persisted: true });
    await act(async () => { (dom.win as EventTarget).dispatchEvent(back); });
    expect(claims.length).toBe(1);
    expect(locked()).toBe(true);
    await p.press();
    expect(stops()).toEqual([]);
    await p.answer({ status: 200, data: { claimed: true } });
    expect(locked()).toBe(false);
    // A copy closed (or left by the App Router) before its claim answered: never leaves the next page locked.
    const q = await mount();
    expect(locked()).toBe(true);
    await q.done();
    expect(locked()).toBe(false);
    await p.done();
  });

  it("(5) a real press lock is unaffected: the claim's answer never releases a Stop / Block lock or a press on its way, and the claim lock never counts as a press", async () => {
    // A press on its way (§380 E) and a Block (§380 A) when the claim starts.
    let idle = 0;
    const off = lock.onPressIdle(() => idle++);
    lock.pressStarted();
    lock.lockPage();
    const p = await mount();
    await p.answer({ status: 200, data: { claimed: true } });
    expect(locked()).toBe(true); // still the press's and the Block's lock
    expect(lock.pressInFlight()).toBe(true);
    lock.pressAnswered(false);
    expect(idle).toBe(1);
    expect(locked()).toBe(true); // the Block's lock until its redraw
    lock.unlockPage();
    expect(locked()).toBe(false);
    // The other way round: a press lock taken while the claim is on its way outlasts the claim's answer; the claim's lock alone never says "idle".
    idle = 0;
    lock.releaseAll();
    const q = await mount();
    expect(idle).toBe(0);
    lock.pressStarted();
    await q.answer({ status: 200, data: { claimed: true } });
    expect(locked()).toBe(true);
    expect(lock.pressInFlight()).toBe(true);
    lock.pressAnswered(false);
    expect(locked()).toBe(false);
    off();
    await q.done();
    await p.done();
  });

  it("the lock's own release: once, and only its own", () => {
    lock.releaseAll();
    const a = lock.lockForClaim();
    const b = lock.lockForClaim();
    a();
    expect(lock.pageLocked()).toBe(true);
    a();
    expect(lock.pageLocked()).toBe(true);
    b();
    expect(lock.pageLocked()).toBe(false);
    expect(lock.pressInFlight()).toBe(false);
  });
});

// The old copy's own handover (onPressIdle, pressInFlight) and the claim's server side: tests/page-handover-380.test.ts.

describe("(owner, Nov 28) the same tab never waits for itself after a press that loads the page again", () => {
  const note = () => sessionStorage.getItem(sameTab.PREV_TAB_KEY);
  const hide = () => act(async () => { (dom.win as EventTarget).dispatchEvent(Object.assign(new Event("pagehide"), { persisted: false })); });
  const releases = () => sent.filter((s) => s.url === "/api/page-handover" && s.body.release === true);

  it("the next load in this tab names the load it showed before in its claim (read once): the server lets it take the page at once", async () => {
    sessionStorage.setItem(sameTab.PREV_TAB_KEY, JSON.stringify({ tab: "load1", at: Date.now() }));
    sameTab.resetSameTab(); // a fresh page
    const p = await mount();
    expect(claims[0].body).toEqual({ scope: SCOPE, prev: "load1" });
    expect(note()).toBeNull();
    await p.answer({ status: 200, data: { claimed: true } });
    expect(locked()).toBe(false);
    await p.done();
    // A load with no note (another tab, a first visit) names nothing: the §380 J wait applies.
    sameTab.resetSameTab();
    const q = await mount();
    expect(claims[0].body).toEqual({ scope: SCOPE });
    await q.answer({ status: 200, data: { claimed: true } });
    await q.done();
  });

  it("going away after its press answered (Edit's Save loading the page again): names itself in the tab and lets go of the busy mark; a press still on its way keeps it", async () => {
    const p = await mount();
    await p.answer({ status: 200, data: { claimed: true } });
    await p.press(); // answered: only its redraw left
    expect(lock.pressInFlight()).toBe(true);
    await hide();
    expect(JSON.parse(note()!).tab).toBe(client.TAB);
    expect(releases().map((s) => [s.body.scope, s.headers["x-tab"]])).toEqual([[SCOPE, client.TAB]]);
    // A press still waiting for the server's answer: the busy mark stays (a copy elsewhere waits for it, at most the cap).
    sent = [];
    lock.pressStarted();
    await hide();
    expect(releases()).toEqual([]);
    expect(JSON.parse(note()!).tab).toBe(client.TAB); // the same tab's next load still takes the page at once
    lock.releaseAll();
    await p.done();
    sessionStorage.removeItem(sameTab.PREV_TAB_KEY);
    sameTab.resetSameTab();
  });
});
