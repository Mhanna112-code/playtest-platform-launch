import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FREE, holdForRedraw, lockBlocks, lockPage, pageLocked, pressAnswered, pressInFlight, pressStarted, redrawLanded, releaseAll, unlockPage } from "@/lib/pageLock";
import { notAPress } from "@/lib/client";

// (Owner, Nov 11, §380 A, B, D) The page lock while Stop, End early or Block is on its way; Confirm with your bank only on the test page (the dashboard and
// Payments link there, Confirm all only on the dashboard); forms whose submit stays disabled until their requirements are met.

(globalThis as { React?: typeof React }).React = React;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");

/** A tiny document: enough for the lock's body marks and its capture listeners. */
function fakeDoc() {
  const listeners = new Map<string, ((e: Event) => void)[]>();
  const attrs = new Map<string, string>();
  const doc = {
    body: { setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k) },
    head: { appendChild: () => undefined },
    getElementById: () => null,
    createElement: () => ({ id: "", textContent: "" }),
    addEventListener: (t: string, f: (e: Event) => void) => listeners.set(t, [...(listeners.get(t) ?? []), f]),
    removeEventListener: (t: string, f: (e: Event) => void) => listeners.set(t, (listeners.get(t) ?? []).filter((x) => x !== f)),
  };
  const button = { closest: (s: string) => (s.includes("button") ? {} : null) }, field = { closest: () => null };
  const fire = (t: string, target: unknown = button, key = "") => {
    let stopped = false, prevented = false;
    for (const f of listeners.get(t) ?? []) f({ type: t, key, target, preventDefault: () => (prevented = true), stopPropagation: () => (stopped = true) } as unknown as Event);
    return { stopped, prevented };
  };
  return { doc: doc as unknown as Document, attrs, fire, button, field };
}

describe("§380 A: every button waits while Stop, End early or Block is on its way", () => {
  it("lockPage disables every button (clicks, Enter / Space, submit) until unlockPage; typing in a field goes through", () => {
    releaseAll();
    const d = fakeDoc();
    lockPage(20_000, d.doc);
    expect(pageLocked()).toBe(true);
    expect(d.attrs.has("data-page-locked")).toBe(true);
    expect(d.fire("click")).toEqual({ stopped: true, prevented: true });
    expect(d.fire("keydown", d.button, "Enter")).toEqual({ stopped: true, prevented: true });
    expect(d.fire("submit")).toEqual({ stopped: true, prevented: true });
    // (§380 E) Typing stays allowed: keys in a field, and other keys anywhere.
    expect(d.fire("keydown", d.field, "a")).toEqual({ stopped: false, prevented: false });
    expect(d.fire("click", d.field)).toEqual({ stopped: false, prevented: false });
    expect(d.fire("keydown", d.button, "Tab")).toEqual({ stopped: false, prevented: false });
    unlockPage(d.doc);
    expect(pageLocked()).toBe(false);
    expect(d.attrs.has("data-page-locked")).toBe(false);
    expect(d.fire("click")).toEqual({ stopped: false, prevented: false });
    expect(lockBlocks({ type: "keydown", key: " ", target: d.button })).toBe(true);
  });

  it("Stop and End early (test page) and Block (any page) lock the whole page until the redraw (§380 E: every other press locks it too, lib/client.ts)", () => {
    const top = src("app/app/tests/[id]/TopPanel.tsx");
    expect(top).toMatch(/const whole = action === "stop" \|\| action === "end-early";\s+if \(whole\) lockPage\(\);/);
    expect(top).toContain("unlockPage(); /* (§380 A) the redraw landed */");
    const block = src("components/BlockButton.tsx");
    expect(block).toContain("lockPage(); // (§380 A)");
    expect(block.match(/unlockPage\(\)/g)?.length).toBe(2); // the redraw landed; the press refused
  });
});

describe("§380 B: Confirm with your bank only on the test page", () => {
  it("the dashboard's rows are links to the test page's spot; Confirm all stays there, and is gone from Payments", async () => {
    const { BankToConfirmBox } = await import("@/app/app/BankToConfirm");
    const html = renderToStaticMarkup(React.createElement(BankToConfirmBox, { rows: [{ id: "p1", lead: "$10.00 for Ana Silva's written answers", full: "", by: "confirm by Nov 14", soon: false, href: "/app/tests/t1#bank-p1", at: 0 }] }));
    expect(html).toContain('href="/app/tests/t1#bank-p1"');
    expect(html).toContain("data-bank-link");
    expect(html).not.toContain("data-bank-waiting"); // no inline Confirm with your bank here
    const list = src("app/app/payments/ConfirmList.tsx");
    expect(list).not.toContain("ConfirmAll");
    expect(src("app/app/payments/page.tsx")).not.toContain("confirmAllState");
    expect(src("app/app/BankToConfirm.tsx")).toContain("<ConfirmAll");
    expect(src("app/app/BankToConfirm.tsx")).not.toContain("<BankWaiting");
  });
});

describe("§380 D: a form's submit stays disabled until it meets its requirements", () => {
  it("Send Answers, Add to this answer, Dispute, Charge, Pay / Pay more and Send your side", () => {
    const s = src("app/app/sessions/[id]/SessionActions.tsx");
    expect(s).toContain("const live0 = canSend ? answersMissing(questions, answers) : null;");
    expect(s).toContain("disabled={busy || notReady || unchanged}");
    expect(s).toContain("data-field-need={i}");
    expect(s).toContain("answerChars(text) < ANSWER_MIN_CHARS} title={empty ? NOTHING_TO_ADD");
    expect(s).toContain("disabled={busy || !!disabledNote || reason.trim().length < 10 || reason.length > 2000}");
    const c = src("app/app/sessions/[id]/ChoiceBox.tsx");
    expect(c).toContain("disabled={busy || typed == null || !!amountNeed || (over && !ticked)}");
    expect(c).toContain('data-field-need="charge"');
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain("(cents > 0 && cents < 50) || !tickOk");
    expect(src("app/app/tests/[id]/DisputeSide.tsx")).toContain("disabled={text.trim().length < 10 || text.length > LIMITS.devSide}");
  });
});

describe("§380 E: every press on every page waits for its answer (and its redraw)", () => {
  it("locked from the press to the answer; refused: released at once; gone through: held for the redraw; a bank check: released at once", async () => {
    releaseAll();
    const d = fakeDoc();
    pressStarted(d.doc);
    expect(pageLocked()).toBe(true);
    expect(pressInFlight()).toBe(true);
    pressAnswered(false); // refused or stopped once
    expect(pageLocked()).toBe(false);
    expect(pressInFlight()).toBe(false);
    pressStarted(d.doc);
    pressAnswered(true); // went through: a moment for its redraw to start
    expect(pageLocked()).toBe(true);
    holdForRedraw();
    await new Promise((r) => setTimeout(r, 900));
    expect(pageLocked()).toBe(true); // still waiting for the redraw
    redrawLanded();
    expect(pageLocked()).toBe(false);
    pressStarted(d.doc);
    pressAnswered(true, true); // a payment now waiting on the bank's inline check
    expect(pageLocked()).toBe(false);
    // Gone through with no redraw: let go after the moment.
    pressStarted(d.doc);
    pressAnswered(true);
    await new Promise((r) => setTimeout(r, 900));
    expect(pageLocked()).toBe(false);
    // A free press's redraw (no locking press just answered) never locks the page.
    holdForRedraw();
    expect(pageLocked()).toBe(false);
  });

  it("while locked: fold toggles, drop-downs, copy, an open bank check and a live call's controls stay usable", () => {
    releaseAll();
    const d = fakeDoc();
    pressStarted(d.doc);
    const free = { closest: (s: string) => (s === FREE || s.includes("button") ? {} : null) };
    expect(d.fire("click", free)).toEqual({ stopped: false, prevented: false });
    expect(d.fire("submit", free)).toEqual({ stopped: false, prevented: false });
    expect(d.fire("click")).toEqual({ stopped: true, prevented: true });
    expect(FREE).toBe("[aria-expanded], [data-press-free], [data-bank-check]");
    pressAnswered(false);
    for (const [f, mark] of [["components/FieldNote.tsx", 'data-copy-typed="" data-press-free=""'], ["components/Cut.tsx", 'data-cut-copy="" data-press-free=""'], ["components/WholeLine.tsx", 'data-name-toggle="" data-press-free=""'],
      ["components/OwedBox.tsx", 'data-owed-toggle="" data-press-free=""'], ["app/app/calls/[id]/CallRoom.tsx", 'data-call-room="" data-press-free=""'], ["components/ReportProblem.tsx", '<details className="w-full text-sm" data-press-free=""'],
      ["components/BankCheck.tsx", "await freePress(() => finish(simulate, cancel))"]] as const) expect(src(f)).toContain(mark);
    for (const f of ["components/ClampText.tsx", "components/LongList.tsx", "components/LongText.tsx", "components/PlusMore.tsx", "components/NavMenu.tsx"]) expect(src(f)).toContain("aria-expanded=");
  });

  it("every press on every page locks it (api), never a read, a heartbeat, a draft, the page claim, an upload or a call problem; useFinished holds it for the redraw", () => {
    const client = src("lib/client.ts");
    expect(client).toContain("const locks = body !== undefined && typeof window !== \"undefined\" && !FREE && !notAPress(path, body);");
    expect(client).toContain("if (locks) pressAnswered(true, bankWaits(r));");
    expect(client).toContain("if (locks) pressAnswered(false);");
    for (const p of ["/api/tests/t1/my-gaps", "/api/kept", "/api/page-claim", "/api/notifications/read", "/api/account/timezone", "/api/sessions/s1/recording-start", "/api/sessions/s1/recording-done", "/api/sessions/s1/recording-alive", "/api/sessions/s1/no-show", "/api/tests/t1/no-show", "/api/sessions/s1/terms-pill"])
      expect(notAPress(p, {}), p).toBe(true);
    expect(notAPress("/api/sessions/s1/recording-remove", { recordingId: "r", written: true })).toBe(true); // the × on a file in an answer being typed
    for (const p of ["/api/sessions/s1/recording-remove", "/api/tests/t1/pay", "/api/blocks", "/api/profile", "/api/reports", "/api/chat/c1", "/api/auth/logout", "/api/payments/confirm", "/api/sessions/s1/written"])
      expect(notAPress(p, {}), p).toBe(false);
    const press = src("lib/usePress.ts");
    expect(press).toMatch(/holdForRedraw\(\);\s+if \(how\.reload\) \{/);
    expect(press).toContain("redrawLanded(); // (§380 E)");
    expect(press).not.toContain("pageScope()");
  });
});
