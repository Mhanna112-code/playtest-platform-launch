/**
 * (Owner, Dec 10 2026: claim again when the connection returns and before its next press, like a fresh open) The page side of a copy whose claim failed
 * (offline at open): it claims again when the browser is back online, when the tab is shown again and before its next press; a copy another one took meanwhile
 * leaves (drafts kept, press unsent); its presses always name the page (x-page); offline presses keep their line. OnePage is mounted with react-dom/client on the
 * small DOM (tests/mini-dom.ts) and each claim's answer is held back by the test. The server side: tests/claim-again-380.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniDom, miniEvent, textOf, type MiniDocument } from "./mini-dom";

vi.mock("next/navigation", () => {
  const router = { refresh: () => {}, push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} };
  return { useRouter: () => router, usePathname: () => "/app/tests/t1", useSearchParams: () => new URLSearchParams() };
});

type React = typeof import("react");
let R: React;
let act: React["act"];
let createRoot: typeof import("react-dom/client").createRoot;
let OnePage: typeof import("@/components/OnePage").OnePage;
let client: typeof import("@/lib/client");
let lock: typeof import("@/lib/pageLock");
let PAGE_MOVED_CODE: string;
let PAGE_MOVED_PATH: string;
let dom: ReturnType<typeof installMiniDom>;

const SCOPE = "test:t1";
const OFFLINE_LINE = "You seem to be offline. Check your connection and try again.";
type Sent = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
let sent: Sent[] = [];
let claims: { body: Record<string, unknown>; answer: (r: { status: number; data: unknown } | null) => void }[] = [];
/** Requests other than the claim fail (the browser is offline). */
let offline = false;
let went: string[] = [];
let flushes = 0;
const realFetch = globalThis.fetch;
const realChannel = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  dom = installMiniDom("/app/tests/t1");
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
  (dom.win.location as { replace: (u: string) => void }).replace = (u: string) => void went.push(u);
  dom.win.addEventListener("kept-flush", () => void flushes++);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (url.startsWith("/api/page-claim")) {
      sent.push({ url, body, headers });
      return new Promise<Response>((ok, fail) => claims.push({ body, answer: (r) => (r ? ok(json(r.status, r.data)) : fail(new TypeError("Failed to fetch"))) }));
    }
    if (offline) throw new TypeError("Failed to fetch");
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
  ({ PAGE_MOVED_CODE, PAGE_MOVED_PATH } = await import("@/lib/pageClaim"));
  client = await import("@/lib/client");
  lock = await import("@/lib/pageLock");
});

afterAll(() => {
  globalThis.fetch = realFetch;
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = realChannel;
  dom.undo();
});

beforeEach(() => {
  sent = [];
  claims = [];
  went = [];
  flushes = 0;
  offline = false;
  lock.releaseAll();
  client.setPageScope("");
  client.resetMovedPage();
});

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** A copy whose claim failed (offline at open), with one press on the page (Stop, a real press: lib/client's api). */
async function failedCopy() {
  const doc = dom.doc as MiniDocument;
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const errors: { code: string; message: string }[] = [];
  const stop = () => void client.api("/api/tests/t1/stop", { reason: "We have what we need." }).catch((e: { code: string; message: string }) => void errors.push({ code: e.code, message: e.message }));
  await act(async () => root.render(R.createElement(R.Fragment, null, R.createElement(OnePage, { scope: SCOPE }), R.createElement("button", { type: "button", onClick: stop }, "Stop"))));
  const answer = async (r: { status: number; data: unknown } | null) => {
    const c = claims.shift();
    if (!c) throw new Error("no claim on its way");
    await act(async () => { c.answer(r); });
    await tick();
  };
  await answer(null); // offline at open
  expect(lock.pageLocked()).toBe(false);
  expect(client.pageScope()).toBe("");
  expect(client.pageShown()).toBe(SCOPE);
  sent = [];
  const press = async () => {
    await act(async () => { container.querySelectorAll("button").find((b) => textOf(b) === "Stop")!.dispatchEvent(miniEvent("click")); });
    await tick();
  };
  return { press, answer, errors, done: () => act(async () => root.unmount()).then(() => container.remove()) };
}
const stops = () => sent.filter((s) => /\/stop$/.test(s.url));
const online = () => act(async () => { dom.win.dispatchEvent(new Event("online")); });

describe("(owner, Dec 10 2026) a copy whose claim failed claims again", () => {
  it("back online with nobody else: claims again (saying how long ago it loaded), like a fresh open (locked until the answer), then holds the page", async () => {
    const p = await failedCopy();
    await online();
    expect(claims.length).toBe(1);
    expect(claims[0].body.scope).toBe(SCOPE);
    expect(typeof claims[0].body.loadedAgo).toBe("number");
    expect(claims[0].body.loadedAgo as number).toBeGreaterThanOrEqual(0);
    expect(lock.pageLocked()).toBe(true);
    await online(); // a second event while it is on its way: the same claim
    expect(claims.length).toBe(1);
    await p.answer({ status: 200, data: { claimed: true } });
    expect(client.pageScope()).toBe(SCOPE);
    expect(lock.pageLocked()).toBe(false);
    sent = [];
    // Holding the page: nothing more to claim.
    await online();
    expect(claims.length).toBe(0);
    await p.press();
    expect(stops().length).toBe(1);
    expect(stops()[0].headers["x-page"]).toBe(SCOPE);
    expect(sent.filter((s) => s.url === "/api/page-claim")).toEqual([]);
    await p.done();
  });

  it("shown again (the tab visible again): claims again too", async () => {
    const p = await failedCopy();
    const doc = dom.doc as MiniDocument;
    doc.visibilityState = "hidden";
    await act(async () => { doc.dispatchEvent(miniEvent("visibilitychange")); });
    expect(claims.length).toBe(0);
    doc.visibilityState = "visible";
    await act(async () => { doc.dispatchEvent(miniEvent("visibilitychange")); });
    expect(claims.length).toBe(1);
    expect(typeof claims[0].body.loadedAgo).toBe("number");
    await p.answer({ status: 200, data: { claimed: true } });
    expect(client.pageScope()).toBe(SCOPE);
    await p.done();
  });

  it("its next press claims first and goes out only after (naming the page, a press that marks it busy)", async () => {
    const p = await failedCopy();
    await p.press();
    expect(claims.length).toBe(1);
    expect(typeof claims[0].body.loadedAgo).toBe("number");
    expect(stops()).toEqual([]);
    await p.answer({ status: 200, data: { claimed: true } });
    expect(stops().length).toBe(1);
    expect(stops()[0].headers["x-page"]).toBe(SCOPE);
    expect(stops()[0].headers["x-press"]).toBe("1");
    expect(p.errors).toEqual([]);
    await p.done();
  });

  it("another copy claimed the page after this one loaded: this copy leaves like a moved page (drafts kept, dashboard), its press never sent", async () => {
    const p = await failedCopy();
    await p.press();
    await p.answer({ status: 200, data: { claimed: false, moved: true } });
    expect(stops()).toEqual([]);
    expect(p.errors.map((e) => e.code)).toEqual([PAGE_MOVED_CODE]);
    expect(flushes).toBe(1);
    expect(went).toEqual([PAGE_MOVED_PATH]);
    // Left: nothing claims again.
    await online();
    expect(claims.length).toBe(0);
    await p.done();
    // The same when it learns on coming back online.
    client.resetMovedPage();
    went = [];
    const q = await failedCopy();
    await online();
    await q.answer({ status: 200, data: { claimed: false, moved: true } });
    expect(went).toEqual([PAGE_MOVED_PATH]);
    await q.done();
  });

  it("the claim again fails with a server error: the press still names the page (x-page), so the server checks it", async () => {
    const p = await failedCopy();
    await p.press();
    await p.answer({ status: 500, data: {} });
    expect(stops().length).toBe(1);
    expect(stops()[0].headers["x-page"]).toBe(SCOPE);
    expect(stops()[0].headers["x-press"]).toBeUndefined(); // not the holder: never marks it busy
    expect(stops()[0].headers["x-prev"]).toBeUndefined(); // no earlier load in this tab
    await p.done();
  });

  it("a load after its own press (the same browser tab moving on) whose claims fail: the press names the load before it (x-prev), so the server lets it through", async () => {
    const sameTab = await import("@/lib/sameTab");
    sessionStorage.setItem(sameTab.PREV_TAB_KEY, JSON.stringify({ tab: "load1", at: Date.now() }));
    sameTab.resetSameTab(); // a fresh page
    const p = await failedCopy();
    await p.press();
    expect(claims[0].body.prev).toBe("load1"); // the claim again names it too
    await p.answer({ status: 500, data: {} });
    expect(stops().length).toBe(1);
    expect(stops()[0].headers["x-page"]).toBe(SCOPE);
    expect(stops()[0].headers["x-prev"]).toBe("load1");
    await p.done();
    // A copy that holds its page never sends it.
    lock.releaseAll(); // the last press (gone through: its redraw's grace)
    sent = [];
    const q = await failedCopy();
    await q.press();
    await q.answer({ status: 200, data: { claimed: true } });
    expect(stops().length).toBe(1);
    expect(stops()[0].headers["x-prev"]).toBeUndefined();
    await q.done();
    sessionStorage.removeItem(sameTab.PREV_TAB_KEY);
    sameTab.resetSameTab();
  });

  it("still offline: the press keeps today's line", async () => {
    const p = await failedCopy();
    offline = true;
    await p.press();
    await p.answer(null);
    expect(stops()).toEqual([]);
    expect(p.errors).toEqual([{ code: "offline", message: OFFLINE_LINE }]);
    expect(lock.pageLocked()).toBe(false);
    await p.done();
  });
});
