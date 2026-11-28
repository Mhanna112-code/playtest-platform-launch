/**
 * (Owner, Nov 28) The live notice never loses a line when the session page's main section is drawn again. That section is keyed by the part's status and end,
 * so the redraw that brings the end of her work mounts a new LiveTop. Lines the old one picked up in the same live check (held for that redraw, or a check
 * still on its way) used to go with it, and the new one counted from its own render time: they never showed, and its next check moved the seen marker past
 * them. Now the new box checks at once from what the old one had shown. Mounted with react-dom/client on the small DOM (tests/mini-dom.ts).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installMiniDom, textOf, type MiniDocument } from "./mini-dom";

type React = typeof import("react");
let R: React;
let act: React["act"];
let createRoot: typeof import("react-dom/client").createRoot;
let LiveTop: typeof import("@/components/LiveTop").LiveTop;
let live: typeof import("@/lib/live");
let sync: typeof import("@/lib/liveSync");
let dom: ReturnType<typeof installMiniDom>;

type Line = { text: string; at: string; [k: string]: unknown };
/** What /api/live answers: every line after the check's `since`, and the time it has shown everything up to. */
let server: { lines: Line[]; now: string } = { lines: [], now: "" };
/** Each check's `since`. */
let asks: string[] = [];
/** While set, the live checks wait for it (a check still on its way). */
let hold: Promise<void> | null = null;
const realFetch = globalThis.fetch;
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  dom = installMiniDom("/app/sessions/s-handover");
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/live") {
      const since = url.searchParams.get("since") ?? "";
      asks.push(since);
      if (hold) await hold;
      return json(200, { changes: server.lines.filter((l) => l.at > since), now: server.now });
    }
    return json(200, {});
  }) as typeof fetch;
  R = await import("react");
  (globalThis as unknown as { React: React }).React = R;
  act = R.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ LiveTop } = await import("@/components/LiveTop"));
  live = await import("@/lib/live");
  sync = await import("@/lib/liveSync");
});

afterAll(() => {
  globalThis.fetch = realFetch;
  dom.undo();
});

let redraws = 0;
let offRedraw = () => {};
beforeEach(() => {
  server = { lines: [], now: "" };
  asks = [];
  hold = null;
  redraws = 0;
  // The page's redraw driver (AutoRefresh): a box with new lines asks it to redraw; the test draws the page again itself.
  offRedraw = sync.onBoxLines(() => {
    redraws += 1;
    return true;
  });
});

const roots: ReturnType<typeof createRoot>[] = [];
function mount(doc: MiniDocument) {
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  return { container, root };
}
afterEach(async () => {
  offRedraw();
  for (const r of roots.splice(0)) await act(async () => r.unmount());
});

/** The session page's main section, keyed by the part's status as the real page is (with its end). */
const page = (scope: string, status: string, seenAt: string) => R.createElement("main", null, R.createElement("div", { key: `${scope}:${status}` }, R.createElement(LiveTop, { scope, seenAt })));
/** Lets the checks' answers land. */
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
/** One beat of the page's 20-second clock. */
const beat = async () => {
  await act(async () => { window.dispatchEvent(new Event(sync.LIVE_TICK)); });
  await settle();
};

const T0 = "2026-11-28T10:00:00.000Z"; // the page's first render
const SHOWN = "2026-11-28T10:00:20.000Z"; // the first check: nothing new, everything shown up to here
const T1 = "2026-11-28T10:00:41.000Z"; // the redraw that brings the end of her work
// One live check picks up the end of her work, a call the developer cancelled and his payment, all at once.
const CANCELLED = { text: "Your call with Nora Lane on Tue, Dec 1, 3:00 PM was cancelled", at: "2026-11-28T10:00:30.000Z", link: "call-c1" };
const PAID = { text: "Nora Lane paid $4.00 for your written answers", at: "2026-11-28T10:00:31.000Z", alert: "payments", part: "wr1" };
const ENDED = { text: "Nora Lane ended your work", at: "2026-11-28T10:00:31.500Z", forced: true };
const LINES = [CANCELLED, PAID, ENDED];

describe("the live notice across a redraw that draws the session's main section again (owner, Nov 28)", () => {
  it("lines held for the redraw show in the new box at once; until then a press is stopped for them; the marker moves only once they show", async () => {
    const scope = "session:s-handover-1";
    live.notePageLoaded(T0);
    const { container, root } = mount(dom.doc);
    server = { lines: [], now: SHOWN };
    await act(async () => root.render(page(scope, "working", T0)));
    await beat();
    expect(live.seenNow(T0)).toBe(SHOWN);

    // The check that finds the three lines holds them for the redraw it asks for.
    server = { lines: LINES, now: "2026-11-28T10:00:40.000Z" };
    await beat();
    expect(redraws).toBe(1);
    expect(textOf(container as never)).not.toContain("was cancelled");
    expect(live.seenNow(T0)).toBe(SHOWN);

    // The redraw lands with the part ended: the section is drawn again, so a new LiveTop mounts (its check waits here a moment).
    let go = () => {};
    hold = new Promise<void>((r) => (go = r));
    await act(async () => root.render(page(scope, "ended", T1)));
    // The new box checks at once, from what the old one had shown (not from its own render time).
    expect(asks.at(-1)).toBe(SHOWN);
    // Meanwhile a press sends a marker before the lines: the gate stops it for them (tests/live-handover.test.ts).
    for (const l of LINES) expect(live.seenNow(T1) < l.at, l.text).toBe(true);

    server = { lines: LINES, now: "2026-11-28T10:00:45.000Z" };
    hold = null;
    go();
    await settle();
    const text = textOf(container as never);
    for (const l of LINES) expect(text, l.text).toContain(l.text);
    // They came with the redraw that just landed: no second redraw is asked for them.
    expect(redraws).toBe(1);
    // Shown: the marker moves past them now.
    expect(live.seenNow(T1)).toBe("2026-11-28T10:00:45.000Z");

    // The next beat finds nothing new and loses nothing.
    server = { lines: LINES, now: "2026-11-28T10:01:05.000Z" };
    await beat();
    for (const l of LINES) expect(textOf(container as never), l.text).toContain(l.text);
    expect(redraws).toBe(1);
  });

  it("a check still on its way when the section is drawn again: its lines show in the new box", async () => {
    const scope = "session:s-handover-2";
    live.notePageLoaded(T0);
    const { container, root } = mount(dom.doc);
    server = { lines: [], now: SHOWN };
    await act(async () => root.render(page(scope, "working", T0)));
    await beat();
    // The beat's check is out when the poll's own redraw (same beat) lands with the part ended.
    let go = () => {};
    hold = new Promise<void>((r) => (go = r));
    server = { lines: LINES, now: "2026-11-28T10:00:45.000Z" };
    await act(async () => { window.dispatchEvent(new Event(sync.LIVE_TICK)); });
    await act(async () => root.render(page(scope, "ended", T1)));
    expect(asks.slice(-2)).toEqual([T0, SHOWN]);
    hold = null;
    go();
    await settle();
    const text = textOf(container as never);
    for (const l of LINES) expect(text, l.text).toContain(l.text);
    // Each line once (the old box's answer, landing after it left, shows nothing).
    expect(text.split(CANCELLED.text).length - 1).toBe(1);
    expect(live.seenNow(T1)).toBe("2026-11-28T10:00:45.000Z");
  });

  it("only the box drawn in place of the same scope's: another page's box counts from its own render and checks on the beat as before", async () => {
    const { root } = mount(dom.doc);
    server = { lines: [], now: SHOWN };
    await act(async () => root.render(page("session:s-handover-3", "working", T0)));
    await beat();
    const before = asks.length;
    await act(async () => root.render(page("session:s-handover-4", "working", T1)));
    await settle();
    expect(asks.length).toBe(before);
    await beat();
    expect(asks.at(-1)).toBe(T1);
  });
});
