/**
 * (Owner, Nov 28) The page side of Leave's second press: while its stop box is open, Leave sends the box's latest time (boxAt) like every other button
 * (lib/usePress.ts): the stop's own time, moved on by each line that joins the open box live under the box's rule (§373). Mounted with react-dom/client on the
 * small DOM (tests/mini-dom.ts); live lines are announced the way LiveTop announces them (lib/live.ts announce).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installMiniDom, miniEvent, type MiniDocument } from "./mini-dom";

type React = typeof import("react");
let R: React;
let act: React["act"];
let createRoot: typeof import("react-dom/client").createRoot;
let LeaveButton: typeof import("@/app/app/sessions/[id]/SessionActions").LeaveButton;
let announce: typeof import("@/lib/live").announce;
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
    if (url.startsWith("/api/sessions/")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return new Promise<Response>((resolve) => pending.push({ url, body, answer: (status, data) => resolve(json(status, data)) }));
    }
    return json(200, {});
  }) as typeof fetch;
  R = await import("react");
  (globalThis as unknown as { React: React }).React = R;
  act = R.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ LeaveButton } = await import("@/app/app/sessions/[id]/SessionActions"));
  ({ announce } = await import("@/lib/live"));
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

const BOX_NOW = "2026-11-28T10:00:05.000Z";
const BOX_LINES = [{ text: "Nora Lane paid $5.00 for your recording", at: "2026-11-28T10:00:01.000Z" }];
const stop = (now: string, changes: unknown[], liveRule?: unknown) => ({ error: { code: "stop_once", message: "Press again to go ahead.", changes, now, tail: "Press again to go ahead.", ...(liveRule ? { alertsOff: true, liveRule } : {}) } });
const PAID = { text: "Nora Lane paid you $2.00 more for your written answers", at: "2026-11-28T10:00:07.000Z", alert: "payments", part: "wr1" };
const FORCED = { text: "You requested a call with Nora Lane in another tab", at: "2026-11-28T10:00:09.000Z", forced: true };

async function leave() {
  const { container, root } = mount(dom.doc);
  await act(async () => root.render(R.createElement(LeaveButton, { sessionId: "s428", seenAt: "2026-11-28T09:59:00.000Z", title: "Harbor Run" })));
  // The small DOM has no dialog methods: the confirm dialog just closes.
  const dialog = container.querySelector("dialog") as unknown as { close?: () => void; showModal?: () => void };
  dialog.close = () => {};
  dialog.showModal = () => {};
  /** One press of "Leave this test" (the dialog's confirm): the body it sent. */
  const press = async () => {
    const before = pending.length;
    await act(async () => { container.querySelector("[data-confirm]")!.dispatchEvent(miniEvent("click")); });
    expect(pending.length).toBe(before + 1);
    return pending[pending.length - 1];
  };
  const answer = async (p: Pending, status: number, data: unknown) => act(async () => {
    p.answer(status, data);
    await new Promise((r) => setTimeout(r, 0));
  });
  const live = async (lines: unknown[]) => act(async () => { announce(lines as never); });
  return { press, answer, live };
}

describe("Leave's second press sends the box's time (owner, Nov 28)", () => {
  it("the first press sends no box time; with the box open the next press is the second: confirmed, with the stop's time", async () => {
    const l = await leave();
    const first = await l.press();
    expect(first.url).toBe("/api/sessions/s428/leave");
    expect(first.body.confirmed).toBe(false);
    expect(first.body.boxAt).toBeUndefined();
    await l.answer(first, 409, stop(BOX_NOW, BOX_LINES));
    const second = await l.press();
    expect(second.body).toMatchObject({ confirmed: true, boxAt: BOX_NOW });
  });

  it("Alerts On: a line that joins the open box moves its time; a second stop gives the box its own new time", async () => {
    const l = await leave();
    const first = await l.press();
    await l.answer(first, 409, stop(BOX_NOW, BOX_LINES));
    await l.live([PAID]);
    const second = await l.press();
    expect(second.body).toMatchObject({ confirmed: true, boxAt: PAID.at });
    const again = "2026-11-28T10:00:20.000Z";
    await l.answer(second, 409, stop(again, [{ text: "Nora Lane edited the listing", at: "2026-11-28T10:00:15.000Z" }]));
    const third = await l.press();
    expect(third.body).toMatchObject({ confirmed: true, boxAt: again });
  });

  it("Alerts Off: a payment the box's rule leaves out never moves its time; a line that always stops does", async () => {
    const l = await leave();
    const first = await l.press();
    await l.answer(first, 409, stop(BOX_NOW, [FORCED], { off: true }));
    await l.live([PAID]);
    expect((await l.press()).body).toMatchObject({ confirmed: true, boxAt: BOX_NOW });
  });

  it("the source: the box's time is sent only while the box is open", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const s = fs.readFileSync(path.resolve(__dirname, "../src/app/app/sessions/[id]/SessionActions.tsx"), "utf8");
    const leaveSrc = s.split("export function LeaveButton")[1].split("export function DisputeForm")[0];
    expect(leaveSrc).not.toContain("setConfirmed");
    expect(leaveSrc).toContain("confirmed: again, ...(again && boxAt ? { boxAt } : {})");
    expect(fs.readFileSync(path.resolve(__dirname, "../src/lib/usePress.ts"), "utf8")).not.toMatch(/still stop just once|opts\.once/);
    expect(fs.readFileSync(path.resolve(__dirname, "../src/lib/server/testerGate.ts"), "utf8")).not.toContain("send no boxAt");
  });
});
