/**
 * (Owner, Nov 28) An open stop box applies the Alerts as they are NOW, not the setting it was built with: the tester's Alerts switched On (or "Turn off alerts")
 * while her box is open, the developer's "Don't stop me for …" ticked or unticked while theirs is. Lines that arrived live while the box was open and were left
 * out join once the new setting keeps them (and move boxAt); lines already in the box stay. Rate and Leave (`ordinaryTerms`): an offer never joins their box
 * with Alerts Off. Mounted with react-dom/client on the small DOM (tests/mini-dom.ts); live lines are announced the way LiveTop announces them, Alerts changes
 * are published the way the Alerts button, a box's chip or the page's poll publishes them (lib/testerAlerts.ts).
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
let LeaveButton: typeof import("@/app/app/sessions/[id]/SessionActions").LeaveButton;
let ApiError: typeof import("@/lib/client").ApiError;
let live: typeof import("@/lib/live");
let alerts: typeof import("@/lib/testerAlerts");
let carry: typeof import("@/lib/pressCarry");
let dom: ReturnType<typeof installMiniDom>;

type Pending = { url: string; body: Record<string, unknown>; answer: (status: number, data: unknown) => void };
let pending: Pending[] = [];
const realFetch = globalThis.fetch;
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  dom = installMiniDom("/app/sessions/s428");
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
  ({ LeaveButton } = await import("@/app/app/sessions/[id]/SessionActions"));
  ({ ApiError } = await import("@/lib/client"));
  live = await import("@/lib/live");
  alerts = await import("@/lib/testerAlerts");
  carry = await import("@/lib/pressCarry");
});

afterAll(() => {
  globalThis.fetch = realFetch;
  dom.undo();
});

beforeEach(async () => {
  pending = [];
  carry.resetCarried();
  (await import("@/lib/pageLock")).releaseAll();
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
  for (const r of roots.splice(0)) await act(async () => r.unmount());
});

const SEEN = "2026-11-28T09:59:00.000Z";
const BOX_NOW = "2026-11-28T10:00:05.000Z";
const BOX_LINES = [{ text: "You sent your written answers in another tab", at: "2026-11-28T10:00:01.000Z", forced: true }];
/** An ordinary line (Alerts On only): a developer payment on another part. */
const OTHER_PART = { text: "Nora Lane paid $10.00 for your recording", at: "2026-11-28T10:00:07.000Z", alert: "payments", part: "rec1" };
const ANOTHER = { text: "Nora Lane paid you $1.00 more for your recording", at: "2026-11-28T10:00:09.000Z", alert: "payments", part: "rec1" };
/** The tester's offer line as the live feed sends it (it opens the offer box; it stops a press whatever the Alerts, except Rate and Leave). */
const OFFER = { text: "Nora Lane offered you new terms: Switch or Keep them", at: "2026-11-28T10:00:08.000Z", link: "terms-offer", forced: true };
const stop = (rule: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  error: { code: "stop_once", message: "Press again to go ahead.", changes: BOX_LINES, now: BOX_NOW, tail: "Press again to go ahead.", ...extra, liveRule: rule },
});

/** The tester's Alerts changed (the Alerts button's save, a box's "Turn off alerts", another tab, the page's poll). */
const testerAlerts = (off: boolean) => act(async () => { alerts.publishTesterAlertsOff(off); });
const announce = (lines: unknown[]) => act(async () => { live.announce(lines as never); });

function Panel() {
  const h = R.createElement;
  const p = usePress(SEEN, undefined, { carry: "written-add:s428" });
  return h("div", null,
    h("button", { onClick: () => void p.press("/api/sessions/s428/written-add", { text: "More." }) }, "Add"),
    p.changes ? h("ul", { "data-stop-box": "" }, p.changes.map((c) => h("li", { key: c.text }, c.text))) : null);
}

/** A usePress box stopped with `rule` (and the Alerts the server read, `alertsOff`, which the page hears as every stop box tells it). */
async function pressed(rule: Record<string, unknown>, alertsOff?: boolean) {
  const { container, root } = mount(dom.doc);
  await act(async () => root.render(R.createElement(Panel)));
  await act(async () => { container.querySelector("button")!.dispatchEvent(miniEvent("click")); });
  await act(async () => {
    pending[0].answer(409, stop(rule, alertsOff === undefined ? {} : { alertsOff }));
    await new Promise((r) => setTimeout(r, 0));
  });
  const shown = () => textOf(container.querySelector("[data-stop-box]"));
  /** The second press: the boxAt it sends. */
  const second = async () => {
    await act(async () => { container.querySelector("button")!.dispatchEvent(miniEvent("click")); });
    const p = pending[pending.length - 1];
    expect(p.body.confirmed).toBe(true);
    return p.body.boxAt;
  };
  return { shown, second };
}

describe("the tester's open box follows her Alerts as they are now", () => {
  it("built with Alerts Off: an ordinary line is left out; Alerts switched On: that line joins and boxAt moves to it", async () => {
    const b = await pressed({ off: true, part: "wr1" }, true);
    await announce([OTHER_PART]);
    expect(b.shown()).not.toContain(OTHER_PART.text);
    await testerAlerts(false);
    expect(b.shown()).toContain(OTHER_PART.text);
    expect(b.shown()).toContain(BOX_LINES[0].text); // already in the box: stays
    expect(await b.second()).toBe(OTHER_PART.at);
  });

  it("built with Alerts Off and switched On: the next ordinary line joins too", async () => {
    const b = await pressed({ off: true, part: "wr1" }, true);
    await testerAlerts(false);
    await announce([ANOTHER]);
    expect(b.shown()).toContain(ANOTHER.text);
    expect(await b.second()).toBe(ANOTHER.at);
  });

  it("built with Alerts On: Turn off alerts → the next ordinary line doesn't join and doesn't move boxAt; a line that always stops still does", async () => {
    const b = await pressed({ off: false, part: "wr1" }, false);
    await announce([OTHER_PART]);
    expect(b.shown()).toContain(OTHER_PART.text); // Alerts On: it joins
    await testerAlerts(true);
    expect(b.shown()).toContain(OTHER_PART.text); // already in the box: stays
    await announce([ANOTHER]);
    expect(b.shown()).not.toContain(ANOTHER.text);
    expect(await b.second()).toBe(OTHER_PART.at);
  });

  it("a left-out line joins only once: Alerts On, Off and On again adds nothing twice", async () => {
    const b = await pressed({ off: true, part: "wr1" }, true);
    await announce([OTHER_PART]);
    await testerAlerts(false);
    await testerAlerts(true);
    await testerAlerts(false);
    expect(b.shown().split(OTHER_PART.text).length - 1).toBe(1);
  });

  it("useStopBox (Send Answers' box): the same", async () => {
    function SendPanel() {
      const h = R.createElement;
      const [box, setBox] = useStopBox("written-form:s428");
      return h("div", null,
        h("button", { onClick: () => setBox(stopBox(new ApiError(409, "stop_once", "Press again to go ahead.", stop({ off: true, part: "wr1" }).error))) }, "Send Answers"),
        box ? h("ul", { "data-stop-box": "" }, box.changes.map((c) => h("li", { key: c.text }, c.text))) : null);
    }
    await testerAlerts(true);
    const { container, root } = mount(dom.doc);
    await act(async () => root.render(R.createElement(SendPanel)));
    await act(async () => { container.querySelector("button")!.dispatchEvent(miniEvent("click")); });
    await announce([OTHER_PART]);
    expect(textOf(container.querySelector("[data-stop-box]"))).not.toContain(OTHER_PART.text);
    await testerAlerts(false);
    expect(textOf(container.querySelector("[data-stop-box]"))).toContain(OTHER_PART.text);
  });
});

describe("the developer's open box follows the test's Alerts as they are now", () => {
  const DEV_RULE = { ignored: ["payments"], press: { acts: ["end-early"], keys: [] }, testId: "t428" };
  const PAID = { text: "Ana Silva's payment went through", at: "2026-11-28T10:00:07.000Z", alert: "payments", facts: { kind: "paid", contractId: "ana" } };
  const PAID2 = { text: "Ben Ito's payment went through", at: "2026-11-28T10:00:09.000Z", alert: "payments", facts: { kind: "paid", contractId: "ben" } };

  it("a type ticked off: its line is left out; the chip unticked: that line joins (boxAt moves), and the next one too", async () => {
    alerts.publishIgnoredAlerts("t428", ["payments"], false);
    const b = await pressed(DEV_RULE);
    await announce([PAID]);
    expect(b.shown()).not.toContain(PAID.text);
    // Unticked in the Alerts menu (its save starts here: the type shows unticked at once).
    let end: (saved?: { ignored: string[]; v?: number }) => void = () => {};
    await act(async () => { end = alerts.startIgnoredAlertsSave("t428", ["payments"], false); });
    expect(b.shown()).toContain(PAID.text);
    await act(async () => end({ ignored: [] }));
    await announce([PAID2]);
    expect(b.shown()).toContain(PAID2.text);
    expect(await b.second()).toBe(PAID2.at);
  });

  it("nothing ticked off when the box opened: \"Don't stop me for: Payments\" ticked while it is open → the next payment doesn't join", async () => {
    alerts.publishIgnoredAlerts("t428", [], false);
    const b = await pressed({ ...DEV_RULE, ignored: [] });
    await announce([PAID]);
    expect(b.shown()).toContain(PAID.text);
    await act(async () => { alerts.startIgnoredAlertsSave("t428", ["payments"], true)({ ignored: ["payments"] }); });
    await announce([PAID2]);
    expect(b.shown()).not.toContain(PAID2.text);
    expect(await b.second()).toBe(PAID.at);
  });

  it("another test's ticks never reach this box", async () => {
    alerts.publishIgnoredAlerts("t428", ["payments"], false);
    const b = await pressed(DEV_RULE);
    await announce([PAID]);
    await act(async () => { alerts.publishIgnoredAlerts("t999", [], false); });
    expect(b.shown()).not.toContain(PAID.text);
  });
});

// The session page's live feed leaves offers out today (api/live: they have their own box); these announce one directly, as a feed carrying it would.
describe("Rate and Leave (ordinaryTerms): an offer is an ordinary change", () => {
  async function leave() {
    const { container, root } = mount(dom.doc);
    await act(async () => root.render(R.createElement(LeaveButton, { sessionId: "s428", seenAt: SEEN, title: "Harbor Run" })));
    const dialog = container.querySelector("dialog") as unknown as { close?: () => void; showModal?: () => void };
    dialog.close = () => {};
    dialog.showModal = () => {};
    const press = async () => {
      await act(async () => { container.querySelector("[data-confirm]")!.dispatchEvent(miniEvent("click")); });
      return pending[pending.length - 1];
    };
    const answer = async (p: Pending, data: unknown) => act(async () => {
      p.answer(409, data);
      await new Promise((r) => setTimeout(r, 0));
    });
    return { press, answer, container };
  }

  it("Leave, Alerts Off: a live offer line doesn't join (boxAt stays); Alerts switched On: it joins", async () => {
    const l = await leave();
    await l.answer(await l.press(), stop({ off: true, ordinaryTerms: true }, { alertsOff: true }));
    await announce([OFFER]);
    expect(textOf(l.container)).not.toContain(OFFER.text);
    const second = await l.press();
    expect(second.body).toMatchObject({ confirmed: true, boxAt: BOX_NOW });
    await l.answer(second, stop({ off: true, ordinaryTerms: true }, { alertsOff: true }));
    await testerAlerts(false);
    expect(textOf(l.container)).toContain(OFFER.text);
    expect((await l.press()).body).toMatchObject({ confirmed: true, boxAt: OFFER.at });
  });

  it("Leave, Alerts On: a live offer line joins", async () => {
    const l = await leave();
    await l.answer(await l.press(), stop({ off: false, ordinaryTerms: true }, { alertsOff: false }));
    await announce([OFFER]);
    expect(textOf(l.container)).toContain(OFFER.text);
    expect((await l.press()).body).toMatchObject({ confirmed: true, boxAt: OFFER.at });
  });

  it("Rate (a usePress box), Alerts Off: an offer doesn't join; Alerts On: it does", async () => {
    const b = await pressed({ off: true, ordinaryTerms: true }, true);
    await announce([OFFER]);
    expect(b.shown()).not.toContain(OFFER.text);
    await testerAlerts(false);
    expect(b.shown()).toContain(OFFER.text);
  });

  it("any other press, Alerts Off: an offer still joins (it stops it whatever the Alerts)", async () => {
    const b = await pressed({ off: true, part: "wr1" }, true);
    await announce([OFFER]);
    expect(b.shown()).toContain(OFFER.text);
  });

  it("boxKeeps: the offer is left out only for an ordinaryTerms box with Alerts Off", () => {
    expect(live.boxKeeps(OFFER as never, { off: true, ordinaryTerms: true })).toBe(false);
    expect(live.boxKeeps(OFFER as never, { off: false, ordinaryTerms: true })).toBe(true);
    expect(live.boxKeeps(OFFER as never, { off: true })).toBe(true);
    expect(live.boxKeeps({ ...OFFER, link: undefined, kind: "terms" } as never, { off: true, ordinaryTerms: true })).toBe(false);
  });
});
