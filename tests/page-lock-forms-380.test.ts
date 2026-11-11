import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { lockPage, pageLocked, unlockPage } from "@/lib/pageLock";

// (Owner, Nov 11, §380 A, B, D) The page lock while Stop, End early or Block is on its way; Confirm with your bank only on the test page (the dashboard and
// Payments link there, Confirm all only on the dashboard); forms whose submit stays disabled until their requirements are met.

(globalThis as { React?: typeof React }).React = React;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");

/** A tiny document: enough for the lock's cover, its body marks and its capture listeners. */
function fakeDoc() {
  const listeners = new Map<string, ((e: Event) => void)[]>();
  const attrs = new Map<string, string>();
  const kids: unknown[] = [];
  const el = () => {
    const a = new Map<string, string>();
    const node = { style: { cssText: "" }, id: "", textContent: "", setAttribute: (k: string, v: string) => a.set(k, v), remove: () => kids.splice(kids.indexOf(node), 1) };
    return node;
  };
  const doc = {
    body: { appendChild: (n: unknown) => kids.push(n), setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k) },
    head: { appendChild: () => undefined },
    getElementById: () => null,
    createElement: el,
    addEventListener: (t: string, f: (e: Event) => void) => listeners.set(t, [...(listeners.get(t) ?? []), f]),
    removeEventListener: (t: string, f: (e: Event) => void) => listeners.set(t, (listeners.get(t) ?? []).filter((x) => x !== f)),
  };
  const fire = (t: string) => {
    let stopped = false, prevented = false;
    for (const f of listeners.get(t) ?? []) f({ preventDefault: () => (prevented = true), stopPropagation: () => (stopped = true) } as unknown as Event);
    return { stopped, prevented };
  };
  return { doc: doc as unknown as Document, attrs, kids, fire };
}

describe("§380 A: every button waits while Stop, End early or Block is on its way", () => {
  it("lockPage covers the page and swallows every click and key until unlockPage", () => {
    const d = fakeDoc();
    lockPage(20_000, d.doc);
    expect(pageLocked()).toBe(true);
    expect(d.kids).toHaveLength(1); // the cover
    expect(d.attrs.has("data-page-locked")).toBe(true);
    expect(d.fire("click")).toEqual({ stopped: true, prevented: true });
    expect(d.fire("keydown")).toEqual({ stopped: true, prevented: true });
    unlockPage(d.doc);
    expect(pageLocked()).toBe(false);
    expect(d.kids).toHaveLength(0);
    expect(d.attrs.has("data-page-locked")).toBe(false);
    expect(d.fire("click")).toEqual({ stopped: false, prevented: false });
  });

  it("Stop and End early (test page) and Block (any page) lock the whole page; other presses don't", () => {
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
