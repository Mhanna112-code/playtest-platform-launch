/**
 * (Owner, Nov 10, §371; recordings race-369 1 and 2) Tab B pressed Send Answers; while the request was on its way the page's live redraw switched the written
 * form from the first form to "Questions you haven't answered yet" (the page keys WrittenForm "first" / "open"), so the form that pressed unmounted and the
 * server's stop-once box never showed. The press's state is now kept by the written part (lib/pressCarry.ts): the form shown after the redraw is "Sending…", the
 * box lands under ITS Send Answers with the server's lines, and what was typed comes along by the questions' words (§269).
 *
 * The form is mounted with react-dom/client on a small DOM (tests/mini-dom.ts), wrapped the way the session page draws it, and the redraw is fired while the
 * press's fetch is still pending.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { installMiniDom, miniEvent, textOf, type MiniDocument, type MiniElement } from "./mini-dom";

type React = typeof import("react");
let R: React;
let act: React["act"];
let createRoot: typeof import("react-dom/client").createRoot;
let WrittenForm: typeof import("@/app/app/sessions/[id]/SessionActions").WrittenForm;
let ChoiceBox: typeof import("@/app/app/sessions/[id]/ChoiceBox").ChoiceBox;
let usePress: typeof import("@/lib/usePress").usePress;
let carry: typeof import("@/lib/pressCarry");
let SEND_ANSWERS: string;
let dom: ReturnType<typeof installMiniDom>;

const SESSION = "s371";
const Q1 = "What did you like most about the first level?";
const Q2 = "Where did you get stuck, and for how long?";
const Q3 = "What would you change first?";
const Q4 = "How did the boat controls feel?";
const Q2NEW = "Where exactly did you get stuck, and what did you try there?";
// Answers as long as the real minimum (50 characters).
const B1 = "Tab B: the harbour level was clear and the boats handled well.";
const B2 = "Tab B: I got stuck at the second bridge for about five minutes.";
const B3 = "Tab B: the tutorial, because the wind rule comes far too late.";
const B4 = "Tab B: the boat turned slowly but felt steady overall, mostly.";
const B2NEW = "Tab B, after the box: at the lighthouse stairs; I tried jumping twice.";

/** One request the test answers by hand (the press's Send); everything else (drafts) answers at once. */
type Pending = { url: string; body: Record<string, unknown>; answer: (status: number, data: unknown) => void };
let pending: Pending[] = [];
const realFetch = globalThis.fetch;

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

beforeAll(async () => {
  dom = installMiniDom(`/app/sessions/${SESSION}`);
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
  (globalThis as unknown as { React: React }).React = R; // the components' JSX (the tests' classic transform)
  act = R.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ WrittenForm } = await import("@/app/app/sessions/[id]/SessionActions"));
  ({ ChoiceBox } = await import("@/app/app/sessions/[id]/ChoiceBox"));
  ({ usePress } = await import("@/lib/usePress"));
  carry = await import("@/lib/pressCarry");
  ({ SEND_ANSWERS } = await import("@/lib/pressLabels"));
});

afterAll(() => {
  globalThis.fetch = realFetch;
  dom.undo();
});

beforeEach(() => {
  pending = [];
  carry.resetCarried();
});

/** The written part as the session page draws it (page.tsx): the form keyed "first" before anything is sent, "open" after. */
function WrittenPart({ written, questions }: { written: boolean; questions: string[] }) {
  const h = R.createElement;
  return h("div", { "data-answer-form": written ? "open" : "first" },
    written && questions.length > 0 ? h("p", { "data-open-questions-title": "" }, "Questions you haven't answered yet") : null,
    h(WrittenForm, { key: written ? "open" : "first", only: written, needOne: !written, canSend: true, lines: [], seenAt: "2026-11-10T09:30:00.000Z", sessionId: SESSION, questions, newQs: [], initial: questions.map(() => ""), initialNotes: "", update: false, initialAttachments: [] }));
}

function mount(doc: MiniDocument) {
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  return { container, root };
}

/** Types into an answer box the way a browser does: the value changes, then an input event bubbles up to React's root listener. */
function type(box: MiniElement, text: string) {
  box.value = text;
  box.dispatchEvent(miniEvent("input"));
}

const sendButton = (form: MiniElement) => form.querySelectorAll("button").find((b) => /Send Answers|Sending…/.test(textOf(b)))!;
const after = (a: MiniElement, b: MiniElement) => {
  // b comes after a in document order
  const all = (a.ownerDocument as MiniDocument).documentElement.querySelectorAll("*");
  return all.indexOf(b) > all.indexOf(a);
};

const STOP_LINES = [
  { text: "You sent your written answers in another tab", at: "2026-11-10T09:31:21.282Z", kind: "yours" },
  { text: `Nora Lane removed the question “${Q2}”`, at: "2026-11-10T09:31:26.582Z", kind: "info" },
  { text: `Nora Lane added the question “${Q2NEW}”`, at: "2026-11-10T09:31:26.582Z", kind: "info" },
];

describe("§371: a redraw that swaps the written form mid-press keeps the press's box", () => {
  it("the stop-once box shows under Send Answers in the form drawn after the redraw, with the server's lines; typed text kept by words", async () => {
    const { container, root } = mount(dom.doc);
    await act(async () => root.render(R.createElement(WrittenPart, { written: false, questions: [Q1, Q2, Q3, Q4] })));
    const first = container.querySelector('[data-answer-form="first"] form')!;
    expect(first).toBeTruthy();
    const boxes = first.querySelectorAll("textarea");
    expect(boxes.length).toBe(5); // 4 answers + Anything else
    await act(async () => {
      type(boxes[1], B2);
      type(boxes[2], B3);
      type(boxes[3], B4);
    });
    expect(boxes[3].value).toBe(B4);

    // B presses Send Answers: the request waits (the race hold).
    await act(async () => { first.dispatchEvent(miniEvent("submit")); });
    expect(pending.map((p) => p.url)).toEqual([`/api/sessions/${SESSION}/written`]);
    expect(pending[0].body.for).toEqual([Q1, Q2, Q3, Q4]);
    expect(textOf(sendButton(first))).toBe("Sending…");

    // While it waits, the live redraw: tab A sent (Q1 answered), Nora reworded Q2. The page swaps the first form for "Questions you haven't answered yet".
    const openQs = [Q2NEW, Q3, Q4];
    await act(async () => root.render(R.createElement(WrittenPart, { written: true, questions: openQs })));
    expect(container.querySelector('[data-answer-form="first"]')).toBeNull();
    expect(first.isConnected).toBe(false); // the form that pressed is gone
    const open = container.querySelector('[data-answer-form="open"] form')!;
    expect(open).toBeTruthy();
    expect(open).not.toBe(first);
    // The new form is the press's: "Sending…", the boxes read-only, the typed text there by the questions' words (a reworded question starts empty).
    expect(textOf(sendButton(open))).toBe("Sending…");
    expect(sendButton(open).hasAttribute("disabled")).toBe(true);
    const openBoxes = open.querySelectorAll("textarea");
    expect(openBoxes.map((b) => b.value)).toEqual(["", B3, B4]);

    // The server's answer: ONE stop-once box (own-tab line + question changes).
    await act(async () => {
      pending[0].answer(409, { error: { code: "stop_once", message: "Press again to go ahead.", changes: STOP_LINES, questions: true, now: "2026-11-10T09:31:35.000Z" } });
      await new Promise((r) => setTimeout(r, 0));
    });
    const box = open.querySelector("[data-stop-box]")!;
    expect(box).toBeTruthy();
    expect(box.closest("form")).toBe(open);
    expect(after(sendButton(open), box)).toBe(true); // under the button
    const text = textOf(box);
    expect(text).toContain(`Your ${SEND_ANSWERS} didn't go through.`);
    for (const l of STOP_LINES) expect(text).toContain(l.text);
    expect(text).toContain(`Press ${SEND_ANSWERS} again to go ahead.`);
    expect(textOf(sendButton(open))).toBe(SEND_ANSWERS);
    expect(sendButton(open).hasAttribute("disabled")).toBe(false);
    expect(openBoxes.map((b) => b.value)).toEqual(["", B3, B4]);

    // The next press from the form shown is the confirmed one (it carries the box's time) for the questions shown.
    await act(async () => { type(openBoxes[0], B2NEW); });
    await act(async () => { open.dispatchEvent(miniEvent("submit")); });
    expect(pending).toHaveLength(2);
    expect(pending[1].body).toMatchObject({ confirmed: true, boxAt: "2026-11-10T09:31:35.000Z", for: openQs, answers: [B2NEW, B3, B4] });
    await act(async () => {
      pending[1].answer(200, { ok: true });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(open.querySelector("[data-stop-box]")).toBeNull();
    await act(async () => root.unmount());
  });

  it("a plain refusal (not a stop) shows under the Send Answers of the form drawn after the redraw", async () => {
    const { container, root } = mount(dom.doc);
    await act(async () => root.render(R.createElement(WrittenPart, { written: false, questions: [Q1, Q2] })));
    const first = container.querySelector('[data-answer-form="first"] form')!;
    await act(async () => { type(first.querySelectorAll("textarea")[1], B2); });
    await act(async () => { first.dispatchEvent(miniEvent("submit")); });
    await act(async () => root.render(R.createElement(WrittenPart, { written: true, questions: [Q2] })));
    const open = container.querySelector('[data-answer-form="open"] form')!;
    expect(textOf(sendButton(open))).toBe("Sending…");
    await act(async () => {
      pending[0].answer(400, { error: { code: "server", message: "Something went wrong. Try again in a moment." } });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(textOf(open)).toContain("Something went wrong. Try again in a moment.");
    expect(textOf(sendButton(open))).toBe(SEND_ANSWERS);
    await act(async () => root.unmount());
  });

  it("a Send that goes through after the swap ends in the form shown: its done line, the press state cleared", async () => {
    const { container, root } = mount(dom.doc);
    await act(async () => root.render(R.createElement(WrittenPart, { written: false, questions: [Q1, Q2] })));
    const first = container.querySelector('[data-answer-form="first"] form')!;
    await act(async () => { type(first.querySelectorAll("textarea")[0], B1); });
    await act(async () => { first.dispatchEvent(miniEvent("submit")); });
    await act(async () => root.render(R.createElement(WrittenPart, { written: true, questions: [Q2] })));
    const open = container.querySelector('[data-answer-form="open"] form')!;
    await act(async () => {
      pending[0].answer(200, { ok: true });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(textOf(open)).toContain("Sent your answers.");
    expect(carry.peekCarried(`written-form:${SESSION}`, "sending")).toBe(false);
    await act(async () => root.unmount());
  });

  it("Charge / Let it go: a box drawn anew mid-press (the page keyed by its status) shows the stop box under its buttons", async () => {
    const { container, root } = mount(dom.doc);
    const h = R.createElement;
    const box = (status: string) => h("div", { key: status }, h(ChoiceBox, { sessionId: SESSION, submissionId: "sub1", line: "You can charge Nora Lane", devName: "Nora Lane", cents: 1000, seenAt: "2026-11-10T09:30:00.000Z" }));
    await act(async () => root.render(box("working")));
    const charge = container.querySelectorAll("button").find((b) => textOf(b).startsWith("Charge"))!;
    await act(async () => { charge.dispatchEvent(miniEvent("click")); });
    expect(pending.map((p) => p.url)).toEqual([`/api/sessions/${SESSION}/choose`]);
    await act(async () => root.render(box("ended")));
    expect(charge.isConnected).toBe(false);
    await act(async () => {
      pending[0].answer(409, { error: { code: "stop_once", message: "Press again to go ahead.", changes: [{ text: "Nora Lane ended your work", at: "2026-11-10T09:31:00.000Z", kind: "info" }], now: "2026-11-10T09:31:01.000Z" } });
      await new Promise((r) => setTimeout(r, 0));
    });
    const stop = container.querySelector("[data-stop-box]")!;
    expect(textOf(stop)).toContain("Your Charge didn't go through.");
    expect(textOf(stop)).toContain("Nora Lane ended your work");
    await act(async () => root.unmount());
  });

  it("usePress with `carry`: a panel keyed anew mid-press (Needs you's Pay keyed by the call's length) shows the press's box", async () => {
    const { container, root } = mount(dom.doc);
    const h = R.createElement;
    function Panel() {
      const p = usePress("2026-11-10T09:30:00.000Z", undefined, { carry: "pay:needs:pay:call:c1" });
      return h("div", { "data-panel": "" },
        h("button", { onClick: () => void p.press("/api/review", { kind: "call", id: "c1" }, "pay") }, p.busy ? "Paying…" : "Pay"),
        p.changes ? h("ul", { "data-stop-box": "" }, p.changes.map((c) => h("li", { key: c.text }, c.text))) : null,
        p.error ? h("p", { "data-refusal": "" }, p.error) : null);
    }
    await act(async () => root.render(h(Panel, { key: "30" })));
    const pay = container.querySelector("button")!;
    await act(async () => { pay.dispatchEvent(miniEvent("click")); });
    await act(async () => root.render(h(Panel, { key: "45" })));
    expect(pay.isConnected).toBe(false);
    expect(textOf(container.querySelector("button"))).toBe("Paying…");
    await act(async () => {
      pending[0].answer(409, { error: { code: "stop_once", message: "Press again to go ahead.", changes: [{ text: "Ana Silva reported the call's length: 45 min", at: "2026-11-10T09:31:00.000Z" }], now: "2026-11-10T09:31:01.000Z" } });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(textOf(container.querySelector("[data-stop-box]"))).toContain("Ana Silva reported the call's length: 45 min");
    expect(textOf(container.querySelector("button"))).toBe("Pay");
    await act(async () => root.unmount());
  });

  it("a scope's state goes a moment after its last component leaves (a page opened again later starts clean)", async () => {
    const scope = "test:drop";
    carry.setCarried(scope, "err", "Refused.", "");
    expect(carry.peekCarried(scope, "err")).toBe("Refused.");
    await new Promise((r) => setTimeout(r, carry.CARRY_GRACE_MS + 50));
    expect(carry.peekCarried(scope, "err")).toBeUndefined();
  });
});

describe("§371: every place the page can swap a pressing component carries its press", () => {
  const src = (p: string) => readFileSync(path.join(__dirname, "..", "src", p), "utf8");
  it("the keyed and moving components name their part", () => {
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain("const carry = `written-form:${sessionId}`;");
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain("const carry = `dispute:${kind}:${id}`;");
    expect(src("app/app/sessions/[id]/ChoiceBox.tsx")).toContain("const carry = `choice:${submissionId ?? callId}`;");
    expect(src("components/NdaNotice.tsx")).toContain('useCarried(`nda:${sessionId}`, "err", "")');
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain('carry: `pay:${p.fromNeeds ? "needs" : p.awayInNeeds ? "away" : "list"}:${more ? "more" : "pay"}:${p.kind}:${p.id}`');
    expect(src("components/RateBox.tsx")).toContain("carry: `rate:${p.path}:");
  });
});
