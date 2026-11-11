/**
 * (Owner, Nov 11, §387 1; recording round c17a case 3) The "forms stay pressable" rule (§380 D2 / D2b, §386 C), pressed for real. The earlier tests read the
 * source text only, so they passed while Send Answers sent NOTHING in a browser: the site-wide field check (FieldChecks' capture-phase submit listener) stopped
 * the submit of a form without data-red-and-blue whenever a field was red (a required answer left empty; or, after a first press, an answer the server had
 * marked too short), before React's onSubmit ran.
 *
 * Here each form is mounted with react-dom/client on the small DOM (tests/mini-dom.ts) next to <FieldChecks /> (the root layout's), pressed with a field red,
 * and the press must reach the server. Then the server marks a field red (as its 400 does) and the form is pressed again: that press must reach it too.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { installMiniDom, miniEvent, textOf, type MiniDocument, type MiniElement } from "./mini-dom";

// The App Router isn't mounted here: the forms that refresh the page after a save get a router that does nothing.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }), usePathname: () => "/app", useSearchParams: () => new URLSearchParams() }));

type React = typeof import("react");
let R: React;
let act: React["act"];
let createRoot: typeof import("react-dom/client").createRoot;
let FieldChecks: typeof import("@/components/FieldChecks").FieldChecks;
let markServerMistakes: typeof import("@/components/FieldChecks").markServerMistakes;
let dom: ReturnType<typeof installMiniDom>;

const SESSION = "s387";
const SEEN = "2026-11-11T09:30:00.000Z";
type Sent = { url: string; body: Record<string, unknown> };
let sent: Sent[] = [];
/** The server's answer to a press (the default: a refusal, so nothing finishes and the form stays). */
let reply: { status: number; data: unknown } = { status: 409, data: { error: { code: "refused", message: "This is refused for the test." } } };
const realFetch = globalThis.fetch;
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

beforeAll(async () => {
  dom = installMiniDom(`/app/sessions/${SESSION}`);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/kept")) return json(200, { data: null });
    if (url.startsWith("/api/")) {
      sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
      return json(reply.status, reply.data);
    }
    return json(404, {});
  }) as typeof fetch;
  R = await import("react");
  (globalThis as unknown as { React: React }).React = R;
  act = R.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ FieldChecks, markServerMistakes } = await import("@/components/FieldChecks"));
});

afterAll(() => {
  globalThis.fetch = realFetch;
  dom.undo();
});

beforeEach(async () => {
  sent = [];
  reply = { status: 409, data: { error: { code: "refused", message: "This is refused for the test." } } };
  (await import("@/lib/pressCarry")).resetCarried();
  (await import("@/lib/pageLock")).releaseAll();
});

/** The form drawn under the root layout's <FieldChecks /> (its submit listener on the document is what stopped the presses). */
async function mount(el: React.ReactElement) {
  const doc = dom.doc as MiniDocument;
  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => root.render(R.createElement(R.Fragment, null, R.createElement(FieldChecks), el)));
  return { container, done: () => act(async () => root.unmount()).then(() => container.remove()) };
}

const buttonNamed = (c: MiniElement, name: RegExp) => {
  const b = c.querySelectorAll("button").find((x) => name.test(textOf(x)));
  if (!b) throw new Error(`no button ${name} in: ${textOf(c)}`);
  return b;
};
/** A press as a browser makes it: a submit button submits its form (the submit event); any other button is clicked. */
async function press(c: MiniElement, name: RegExp) {
  const b = buttonNamed(c, name);
  const form = b.closest("form");
  const isSubmit = form && (b.getAttribute("type") ?? "submit") === "submit";
  await act(async () => { (isSubmit ? form : b).dispatchEvent(miniEvent(isSubmit ? "submit" : "click", isSubmit ? { submitter: b } : {})); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
function type(box: MiniElement, text: string) {
  box.value = text;
  box.dispatchEvent(miniEvent("input"));
}
const presses = (url: RegExp) => sent.filter((s) => url.test(s.url)).length;
/** As the server's 400 does: the field is red with its line (it stays red until its value changes). */
async function serverMarks(c: MiniElement, field: MiniElement, msg = "This needs fixing (the server).") {
  await act(async () => { markServerMistakes(field.closest("[data-mistakes-root], form") as unknown as Element, [msg], () => field as unknown as Element); });
  expect(field.getAttribute("aria-invalid"), "the field is red").toBe("true");
}

type Case = {
  name: string;
  el: () => Promise<React.ReactElement>;
  /** Before the press: open what the button sits in, fill what must be filled for the case. */
  open?: (c: MiniElement) => Promise<void>;
  button: RegExp;
  url: RegExp;
  /** The field the server marks red for the second press (the first field by default). */
  field?: (c: MiniElement) => MiniElement;
  /** (§387 2) No stop-once box of its own under the button (Cancel's menu: the row draws it; Contact us has none). */
  noBox?: boolean;
};

const firstField = (c: MiniElement) => c.querySelectorAll("textarea, input, select").find((x) => x.getAttribute("type") !== "checkbox" && x.getAttribute("type") !== "file" && x.getAttribute("type") !== "hidden")!;

const CASES: Case[] = [
  {
    name: "Send Answers (a Required answer left empty)",
    el: async () => R.createElement((await import("@/app/app/sessions/[id]/SessionActions")).WrittenForm, { sessionId: SESSION, questions: ["* What did you like most?", "What would you change?"], initial: ["", ""], initialNotes: "", update: false, seenAt: SEEN, canSend: true }),
    button: /^Send Answers$/,
    url: /\/written$/,
  },
  {
    name: "Add to this answer",
    el: async () => R.createElement((await import("@/app/app/sessions/[id]/SessionActions")).WrittenAddForm, { sessionId: SESSION, seenAt: SEEN, questionKey: "q1", question: "What did you like most?", made: 1 }),
    open: async (c) => { await act(async () => { buttonNamed(c, /^Add to this answer$/).dispatchEvent(miniEvent("click")); }); },
    button: /^Add to my answer$/,
    url: /\/written-add$/,
  },
  {
    name: "a recording's Send",
    el: async () => R.createElement((await import("@/app/app/sessions/[id]/RecordingUpload")).RecordingUpload, { sessionId: SESSION, recordings: [{ id: "r1", filename: "run.mp4", size: 1000, uploaded: true }], canSend: true, sentBefore: false, seenAt: SEEN }),
    button: /^Send my recording$/,
    url: /\/recording-send$/,
    field: (c) => c.querySelector('input[type="file"]')!,
  },
  {
    name: "a recording's Add",
    el: async () => R.createElement((await import("@/app/app/sessions/[id]/RecordingUpload")).RecordingUpload, { sessionId: SESSION, recordings: [{ id: "r0", filename: "a.mp4", size: 1000, uploaded: true, sent: true }, { id: "r1", filename: "run.mp4", size: 1000, uploaded: true }], canSend: true, sentBefore: true, seenAt: SEEN }),
    button: /^Add my recording$/,
    url: /\/recording-send$/,
    field: (c) => c.querySelector('input[type="file"]')!,
  },
  {
    name: "Dispute (the reason empty)",
    el: async () => R.createElement((await import("@/app/app/sessions/[id]/SessionActions")).DisputeForm, { sessionId: SESSION, kind: "submission", id: "sub1", seenAt: SEEN }),
    button: /^Send the dispute$/,
    url: /\/dispute$/,
  },
  {
    name: "Charge (the amount empty)",
    el: async () => R.createElement((await import("@/app/app/sessions/[id]/ChoiceBox")).ChoiceBox, { sessionId: SESSION, submissionId: "sub1", line: "Nora Lane hasn't reviewed it in 14 days", devName: "Nora Lane", cents: 1000, seenAt: SEEN }),
    open: async (c) => { await act(async () => type(c.querySelector("input[data-money]")!, "")); },
    button: /^Charge Nora Lane/,
    url: /\/choose$/,
  },
  {
    name: "Pay (the note missing under the listing)",
    el: async () => R.createElement((await import("@/app/app/tests/[id]/PayBox")).PayBox, { kind: "submission", id: "sub1", name: "Ruth Okafor", listingCents: 1000, listingText: "$10.00 for the written answers", seenAt: SEEN }),
    open: async (c) => { await act(async () => type(c.querySelector("input[data-amount]")!, "5.00")); },
    button: /^Pay$/,
    url: /\/api\/review$/,
    field: (c) => c.querySelector("textarea")!,
  },
  {
    name: "Pay more",
    el: async () => R.createElement((await import("@/app/app/tests/[id]/PayBox")).PayBox, { kind: "submission", id: "sub1", name: "Ruth Okafor", listingCents: 1000, listingText: "$10.00 for the written answers", seenAt: SEEN, more: { testId: "t1", contractId: "c1" } }),
    button: /^Pay more$/,
    url: /\/pay-extra$/,
    field: (c) => c.querySelector("input[data-amount]")!,
  },
  {
    name: "Send your side (empty)",
    el: async () => R.createElement((await import("@/app/app/tests/[id]/DisputeSide")).DisputeSide, { testId: "t1", disputeId: "d1", seenAt: SEEN }),
    button: /^Send your side$/,
    url: /\/dispute-side$/,
  },
  {
    name: "Cancel a call (the reason required under 24 hours)",
    noBox: true,
    el: async () => {
      const { CancelMenu } = await import("@/components/CancelMenu");
      const { api } = await import("@/lib/client");
      return R.createElement(CancelMenu, { needsReason: true, busy: false, other: "Nora Lane", onCancel: (reason: string) => void api(`/api/sessions/${SESSION}/cancel-call`, { callId: "call1", reason, seenAt: SEEN }).catch(() => {}) });
    },
    button: /^Cancel this call$/,
    url: /\/cancel-call$/,
  },
  {
    name: "Cancel the remaining calls",
    noBox: true,
    el: async () => {
      const { CancelMenu } = await import("@/components/CancelMenu");
      const { api } = await import("@/lib/client");
      return R.createElement(CancelMenu, { needsReason: true, busy: false, other: "Nora Lane", label: "Cancel the remaining calls", onCancel: (reason: string) => void api(`/api/sessions/${SESSION}/cancel-set`, { setId: "set1", reason, seenAt: SEEN }).catch(() => {}) });
    },
    button: /^Cancel the remaining calls$/,
    url: /\/cancel-set$/,
  },
  {
    name: "Ask to show an excerpt",
    el: async () => R.createElement((await import("@/components/Excerpts")).ExcerptPicker, { submissionId: "sub1", choices: [{ index: 0, question: "What did you like?", text: "The harbour level was clear." }], defaultOpen: true }),
    button: /^Ask the developer$/,
    url: /\/api\/excerpts$/,
    field: (c) => c.querySelector("fieldset") ?? firstField(c),
  },
  {
    name: "Rate (the tester's, no stars)",
    el: async () => R.createElement((await import("@/components/RateBox")).RateBox, { path: `/api/sessions/${SESSION}/rate`, seenAt: SEEN, name: "Nora Lane", headline: "", lines: [], working: false }),
    button: /^Rate$/,
    url: /\/rate$/,
  },
  {
    name: "Rate (the developer's, no stars)",
    el: async () => R.createElement((await import("@/components/RateBox")).RateBox, { path: "/api/tests/t1/rate", body: { contractId: "c1" }, seenAt: SEEN, name: "Ruth Okafor", headline: "", lines: [], working: false }),
    button: /^Rate$/,
    url: /\/rate$/,
  },
  {
    name: "Report (the note empty)",
    el: async () => R.createElement((await import("@/components/ReportButton")).ReportButton, { userId: "u1", name: "Nora Lane", reportedOn: null, seenAt: SEEN }),
    open: async (c) => { await act(async () => { buttonNamed(c, /^Report/).dispatchEvent(miniEvent("click")); }); },
    button: /^Send to the team$/,
    url: /\/api\/reports$/,
  },
  {
    name: "Contact us (nothing chosen or typed)",
    noBox: true,
    el: async () => R.createElement((await import("@/app/app/help/ContactForm")).ContactForm, { topics: ["A payment", "Something else"] }),
    button: /Send to the team$/,
    url: /\/api\/help$/,
  },
  {
    name: "Change password (empty)",
    el: async () => R.createElement((await import("@/app/app/profile/PasswordForm")).PasswordForm, { hasPassword: true, seenAt: SEEN }),
    button: /^Save the new password$/,
    url: /\/api\/auth\/password$/,
  },
  {
    name: "Profile (the name empty)",
    el: async () => R.createElement((await import("@/app/app/profile/ProfileForm")).ProfileForm, { init: { name: "", pronoun: "", isDeveloper: false, isTester: true, devices: [], categories: [], languages: [], bio: "" }, seenAt: SEEN }),
    button: /^Save profile$/,
    url: /\/api\/profile$/,
  },
  {
    name: "the email setting",
    el: async () => R.createElement((await import("@/app/app/notifications/AlertSettings")).AlertSettings, { emailPref: "instant", seenAt: SEEN }),
    button: /^Save$/,
    url: /\/api\/account\/notify$/,
  },
  {
    name: "Switch side",
    el: async () => R.createElement((await import("@/app/app/account/SideButton")).SideButton, { side: "developer", seenAt: SEEN, children: "Switch to your developer side" } as never),
    button: /^Switch to your developer side$/,
    url: /\/api\/account\/side$/,
    field: () => null as unknown as MiniElement,
  },
  {
    name: "an admin note button (Suspend, the note empty)",
    el: async () => R.createElement((await import("@/app/admin/AdminButton")).AdminButton, { action: "suspend", id: "u1", label: "Suspend", fields: [{ name: "note", label: "Note" }] }),
    button: /^Suspend$/,
    url: /\/api\/admin\/suspend$/,
  },
];

describe("§387 1: every pressable form reaches the server with a field red (a real press, not the source text)", () => {
  for (const k of CASES) {
    it(k.name, async () => {
      const m = await mount(await k.el());
      try {
        await k.open?.(m.container);
        // The first press: the form's own fields are wrong as they are (empty / missing), and the press still goes.
        await press(m.container, k.button);
        expect(presses(k.url), `${k.name}: the first press reached the server`).toBe(1);
        // The server marked a field red; the next press goes too (the second press of case 3 sent nothing).
        const field = (k.field ?? firstField)(m.container);
        if (field) await serverMarks(m.container, field);
        await press(m.container, k.button);
        expect(presses(k.url), `${k.name}: the press after a field went red reached the server`).toBe(2);
      } finally {
        await m.done();
      }
    });
  }

  it("Send Answers with only a too-short answer: the box shows, then (the test stopped meanwhile) the second press is sent and its refusal shows", async () => {
    const { WrittenForm } = await import("@/app/app/sessions/[id]/SessionActions");
    const m = await mount(R.createElement(WrittenForm, { sessionId: SESSION, questions: ["What did you like most?", "What would you change?"], initial: ["", ""], initialNotes: "", update: false, seenAt: SEEN, canSend: true }));
    try {
      const boxes = m.container.querySelectorAll("textarea");
      await act(async () => type(boxes[0], "Bridge 2, the arrow."));
      reply = { status: 409, data: { error: { code: "stop_once", message: "Since you opened this page", changes: [{ text: "Nora Lane changed the pay", at: SEEN, kind: "info" }], now: SEEN } } };
      await press(m.container, /^Send Answers$/);
      expect(presses(/\/written$/)).toBe(1);
      expect(m.container.querySelector("[data-stop-box]"), "the box").toBeTruthy();
      expect(boxes[0].getAttribute("aria-invalid"), "the too-short answer is red").toBe("true");
      reply = { status: 409, data: { error: { code: "stopped", message: "Nora Lane stopped the test on Nov 11, so your Send Answers didn't go through." } } };
      await press(m.container, /^Send Answers$/);
      expect(presses(/\/written$/), "the second press reached the server").toBe(2);
      expect(textOf(m.container)).toContain("Nora Lane stopped the test on Nov 11, so your Send Answers didn't go through.");
    } finally {
      await m.done();
    }
  });

  it("every <form> with its own onSubmit that is one of these presses carries data-red-and-blue (the site-wide check lets it through)", () => {
    const root = path.resolve(__dirname, "../src");
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".tsx")) files.push(p); } };
    walk(root);
    // Forms that keep the site-wide stop on purpose: sign-in / sign-up (AuthForm, opted in per form), the chat's Send and the Find filters (a plain GET).
    const KEEPS_STOP = ["components/AuthForm.tsx", "components/Chat.tsx", "app/app/find/FindFilters.tsx"];
    const missing: string[] = [];
    for (const f of files) {
      const rel = path.relative(root, f).replace(/\\/g, "/");
      if (KEEPS_STOP.includes(rel)) continue;
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/<form\b[\s\S]*?>/g)) if (/onSubmit=/.test(m[0]) && !/data-red-and-blue/.test(m[0])) missing.push(`${rel}: ${m[0].slice(0, 80)}`);
    }
    expect(missing).toEqual([]);
  });
});

const STOP = { status: 409, data: { error: { code: "stop_once", message: "Since you opened this page", changes: [{ text: "Nora Lane changed the pay", at: SEEN, kind: "info" }], now: SEEN } } };
const REFUSED = { status: 409, data: { error: { code: "refused", message: "This test was stopped, so nothing can go through." } } };
const boxOf = (c: MiniElement) => c.querySelectorAll("[data-stop-box]").find((b) => /Since you opened this page|Changed in another tab|Since this page loaded/.test(textOf(b))) ?? null;

describe("§387 2: the server's answer under the button is one thing; the box names the button as it reads", () => {
  for (const k of CASES.filter((x) => !x.noBox)) {
    it(k.name, async () => {
      const m = await mount(await k.el());
      try {
        await k.open?.(m.container);
        reply = STOP;
        await press(m.container, k.button);
        const box = boxOf(m.container);
        expect(box, `${k.name}: the box`).toBeTruthy();
        // "Press <the button's own words> again to go ahead." (Dispute's said "Press Dispute again" under "Send the dispute").
        const label = textOf(buttonNamed(m.container, k.button));
        expect(textOf(box!.querySelector("[data-press-again]")), k.name).toBe(`Press ${label} again to go ahead.`);
        reply = REFUSED;
        await press(m.container, k.button);
        expect(presses(k.url)).toBe(2);
        expect(textOf(m.container), `${k.name}: the refusal shows`).toContain("This test was stopped, so nothing can go through.");
        expect(boxOf(m.container), `${k.name}: the refusal replaced the box`).toBeNull();
      } finally {
        await m.done();
      }
    });
  }
});
