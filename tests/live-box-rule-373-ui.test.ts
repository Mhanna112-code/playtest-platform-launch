/**
 * (Owner, Nov 10, §373; recording race-371 2) The page side: an open stop box (usePress, useStopBox) takes in a line the live feed picked up only by the rule
 * the server built it under (`liveRule`), and a line it leaves out never moves the box's time (the next press's boxAt). Mounted with react-dom/client on the
 * small DOM (tests/mini-dom.ts); the live feed's lines are announced the way LiveTop announces them (lib/live.ts announce).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installMiniDom, miniEvent, textOf, type MiniDocument } from "./mini-dom";

type React = typeof import("react");
let R: React;
let act: React["act"];
let createRoot: typeof import("react-dom/client").createRoot;
let usePress: typeof import("@/lib/usePress").usePress;
let useStopBox: typeof import("@/lib/topStop").useStopBox;
let stopBox: typeof import("@/lib/topStop").stopBox;
let ApiError: typeof import("@/lib/client").ApiError;
let announce: typeof import("@/lib/live").announce;
let carry: typeof import("@/lib/pressCarry");
let dom: ReturnType<typeof installMiniDom>;

type Pending = { url: string; body: Record<string, unknown>; answer: (status: number, data: unknown) => void };
let pending: Pending[] = [];
const realFetch = globalThis.fetch;
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  dom = installMiniDom("/app/sessions/s373");
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/kept")) return json(200, { data: null });
    if (url.startsWith("/api/")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return new Promise<Response>((resolve) => pending.push({ url, body, answer: (status, data) => resolve(json(status, data)) }));
    }
    return json(404, {});
  }) as typeof fetch;
  R = await import("react");
  (globalThis as unknown as { React: React }).React = R;
  act = R.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ usePress } = await import("@/lib/usePress"));
  ({ useStopBox, stopBox } = await import("@/lib/topStop"));
  ({ ApiError } = await import("@/lib/client"));
  ({ announce } = await import("@/lib/live"));
  carry = await import("@/lib/pressCarry");
});

afterAll(() => {
  globalThis.fetch = realFetch;
  dom.undo();
});

beforeEach(() => {
  pending = [];
  carry.resetCarried();
});

const roots: ReturnType<typeof createRoot>[] = [];
function mount(doc: MiniDocument) {
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  roots.push(root);
  return { container, root };
}
// Each test's panels leave with it (a panel still mounted would keep taking in the next test's live lines).
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
});

// Recording race-371 2: the server's box (Alerts Off) held only the always-stop lines; then the live feed brought Nora's payment on Ana's RECORDING.
const BOX_LINES = [
  { text: "You sent your written answers in another tab", at: "2026-11-10T06:13:21.282Z", kind: "yours", forced: true },
  { text: "Nora Lane removed the question “What would you change first?”", at: "2026-11-10T06:13:26.582Z", forced: true },
];
const BOX_NOW = "2026-11-10T06:13:34.900Z";
const OTHER_PART = { text: "Nora Lane paid $10.00 for your recording", at: "2026-11-10T06:13:35.770Z", alert: "payments", part: "rec1" };
const SAME_PART = { text: "Nora Lane paid you $2.00 more for your written answers", at: "2026-11-10T06:13:36.100Z", alert: "payments", part: "wr1" };
const FORCED = { text: "You added to your written answers in another tab", at: "2026-11-10T06:13:37.000Z", forced: true };
const stop = (liveRule?: unknown) => ({ error: { code: "stop_once", message: "Press again to go ahead.", changes: BOX_LINES, now: BOX_NOW, alertsOff: !!liveRule, ...(liveRule ? { liveRule } : {}) } });

function Panel() {
  const h = R.createElement;
  const p = usePress("2026-11-10T06:13:00.000Z", undefined, { carry: "written-add:s373" });
  return h("div", null,
    h("button", { onClick: () => void p.press("/api/sessions/s373/written-add", { text: "More." }) }, "Add"),
    p.changes ? h("ul", { "data-stop-box": "" }, p.changes.map((c) => h("li", { key: c.text }, c.text))) : null);
}

async function pressedAndStopped(liveRule?: unknown) {
  const { container, root } = mount(dom.doc);
  await act(async () => root.render(R.createElement(Panel)));
  await act(async () => { container.querySelector("button")!.dispatchEvent(miniEvent("click")); });
  await act(async () => {
    pending[0].answer(409, stop(liveRule));
    await new Promise((r) => setTimeout(r, 0));
  });
  const shown = () => textOf(container.querySelector("[data-stop-box]"));
  const live = async (lines: unknown[]) => act(async () => { announce(lines as never); });
  /** The second press: the boxAt it sends. */
  const second = async () => {
    await act(async () => { container.querySelector("button")!.dispatchEvent(miniEvent("click")); });
    const p = pending[pending.length - 1];
    expect(p.body.confirmed).toBe(true);
    return p.body.boxAt;
  };
  return { root, shown, live, second };
}

describe("§373 usePress: a live line joins the open box only by the box's rule", () => {
  it("Alerts Off (recording race-371 2): another part's payment is not added and doesn't move boxAt; the press's own part and a forced line are", async () => {
    const b = await pressedAndStopped({ off: true, part: "wr1" });
    expect(b.shown()).toContain("You sent your written answers in another tab");
    await b.live([OTHER_PART]);
    expect(b.shown()).not.toContain("paid $10.00 for your recording");
    expect(await b.second()).toBe(BOX_NOW); // the box's own time: the left-out line moved nothing
  });

  it("Alerts Off: a payment on the press's own part and an always-stop line join (and move boxAt to the newest)", async () => {
    const b = await pressedAndStopped({ off: true, part: "wr1" });
    await b.live([OTHER_PART, SAME_PART]);
    expect(b.shown()).toContain("Nora Lane paid you $2.00 more for your written answers");
    expect(b.shown()).not.toContain("paid $10.00 for your recording");
    await b.live([FORCED]);
    expect(b.shown()).toContain("You added to your written answers in another tab");
    expect(await b.second()).toBe(FORCED.at);
  });

  it("Alerts On (no rule): every line joins, as before", async () => {
    const b = await pressedAndStopped();
    await b.live([OTHER_PART]);
    expect(b.shown()).toContain("Nora Lane paid $10.00 for your recording");
    expect(await b.second()).toBe(OTHER_PART.at);
  });

  it("the developer's box: a type ticked off joins only when it always stops this press (a dispute about its tester)", async () => {
    const b = await pressedAndStopped({ ignored: ["disputes", "payments"], press: { acts: ["end-early"], keys: ["c:ana"] } });
    await b.live([
      { text: "Ben Ito disputed your rejection of the written answers", at: "2026-11-10T06:13:35.000Z", alert: "disputes", facts: { kind: "dispute", contractId: "ben" } },
      { text: "Ana Silva paid", at: "2026-11-10T06:13:35.500Z", alert: "payments", facts: { kind: "paid", contractId: "ben" } },
    ]);
    expect(b.shown()).not.toContain("Ben Ito disputed");
    expect(await b.second()).toBe(BOX_NOW);
    await b.live([{ text: "Ana Silva disputed your rejection of the written answers", at: "2026-11-10T06:13:36.000Z", alert: "disputes", facts: { kind: "dispute", contractId: "ana" } }]);
    expect(b.shown()).toContain("Ana Silva disputed");
    await b.live([{ text: "Cleo Park joined", at: "2026-11-10T06:13:37.000Z", alert: "joins", facts: { kind: "joined" } }]);
    expect(b.shown()).toContain("Cleo Park joined"); // not ticked off
  });
});

describe("§373 useStopBox: the same rule (Send Answers' box)", () => {
  function SendPanel({ liveRule }: { liveRule?: unknown }) {
    const h = R.createElement;
    const [box, setBox] = useStopBox("written-form:s373");
    return h("div", null,
      h("button", { onClick: () => setBox(stopBox(new ApiError(409, "stop_once", "Press again to go ahead.", stop(liveRule).error))) }, "Send Answers"),
      box ? h("ul", { "data-stop-box": "" }, box.changes.map((c) => h("li", { key: c.text }, c.text))) : null);
  }
  it.each([[true], [false]])("Alerts Off=%s", async (off) => {
    const { container, root } = mount(dom.doc);
    await act(async () => root.render(R.createElement(SendPanel, { liveRule: off ? { off: true } : undefined })));
    await act(async () => { container.querySelector("button")!.dispatchEvent(miniEvent("click")); });
    await act(async () => { announce([OTHER_PART, FORCED] as never); });
    const shown = textOf(container.querySelector("[data-stop-box]"));
    expect(shown).toContain(FORCED.text);
    if (off) expect(shown).not.toContain(OTHER_PART.text);
    else expect(shown).toContain(OTHER_PART.text);
  });
});
