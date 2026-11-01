import fs from "node:fs";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { currentKept, dropKept, keepRefusal, keptAnchor, keptOnPage, keptShows, notePress, refusalTextOutsideKept, resetKept, type Kept, type RefusalTextNode } from "@/lib/keptRefusal";
import { FormMistakes } from "@/components/FormMistakes";
import { mistakeBullets } from "@/components/FieldChecks";
import { json, req } from "./helpers";
import { joined, sact, seen, setup } from "./fixtures";

(globalThis as unknown as { React: typeof React }).React = React;
const text = (value: string): RefusalTextNode => ({ nodeType: 3, nodeValue: value, childNodes: [] });
const element = (children: RefusalTextNode[], marker = ""): RefusalTextNode => ({ nodeType: 1, nodeValue: null, childNodes: children, matches: (selector) => !!marker && selector.includes(marker) });
const allText = (node: RefusalTextNode): string => node.nodeType === 3 ? node.nodeValue ?? "" : Array.from(node.childNodes, allText).join("");
const flat = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
const reasons = [
  ["Charge", "Charge and Let it go closed on Oct 31, 2026."],
  ["Let it go", "Charge and Let it go closed on Oct 31, 2026."],
  ["Pay", "Pay closed on Oct 31, 2026."],
] as const;
// The real session layout is a <li id="part-written"> containing the kept portal's host.
function part(k: Kept, showing: boolean, other = "") {
  return element([text("Written answers "), ...(other ? [element([text(other)])] : []), ...(showing ? [element([element([text(k.text)], "data-kept-refusal")], "data-kept-host")] : [])]);
}
function checks(k: Kept, read: (node: RefusalTextNode) => string, count = 20) {
  let show = false;
  return Array.from({ length: count }, (_, i) => {
    const elsewhere = flat(read(part(k, show))).includes(flat(k.message));
    show = keptShows(k, k.at + i * 200, elsewhere);
    return show;
  });
}
beforeEach(() => resetKept());
afterEach(() => vi.unstubAllGlobals());

describe("batch 35 §95: one steady refusal after its button disappears", () => {
  it.each(reasons)("reproduces %s flashing with ancestor textContent, then keeps it steady when kept subtrees are excluded", (label, reason) => {
    notePress(null, null, 1000, ["part-written", "parts"]);
    const k = keepRefusal(label, reason, 1100)!;
    // Old shownElsewhere excluded the portal itself with closest(), but counted the parent <li>.
    expect(checks(k, allText, 6)).toEqual([true, false, true, false, true, false]);
    expect(checks(k, refusalTextOutsideKept)).toEqual(Array(20).fill(true));
    expect(refusalTextOutsideKept(part(k, true))).toBe("Written answers ");
    expect(k.text).toMatch(new RegExp(`^Your ${label} didn't go through:`));
  });

  it.each(reasons)("%s stays under a visible button, hands off after redraw, and never duplicates another real line", (label, reason) => {
    const k = keepRefusal(label, reason, 1000)!;
    expect(keptShows(k, 1200, true)).toBe(false); // the button's own Err is still there
    expect(keptShows(k, 1400, false)).toBe(true); // the redraw removed that button
    // Another visible Err in the same ancestor must count, even with the portal beside it.
    const outside = refusalTextOutsideKept(part(k, true, reason));
    expect(flat(outside).includes(flat(reason))).toBe(true);
    expect(keptShows(k, 1600, flat(outside).includes(flat(reason)))).toBe(false);
    expect(keptShows(k, 1800, false)).toBe(true);
  });

  it("ignores nested hosts and the kept paragraph itself, preserving every other text node", () => {
    const tree = element([text("Before "), element([text("kept line")], "data-kept-host"), element([text("real refusal")]), text(" after")]);
    expect(refusalTextOutsideKept(tree)).toBe("Before real refusal after");
    expect(refusalTextOutsideKept(element([text("kept line")], "data-kept-refusal"))).toBe("");
  });

  it("chooses the nearest surviving visible section and falls back to the top only when none remain", () => {
    const inner = { id: "part-written" }, outer = { id: "parts" };
    const visible = new Map([[inner.id, inner], [outer.id, outer]]);
    const lookup = (id: string) => visible.get(id) ?? null;
    expect(keptAnchor([inner.id, outer.id], lookup)).toBe(inner);
    visible.delete(inner.id);
    expect(keptAnchor([inner.id, outer.id], lookup)).toBe(outer);
    visible.clear();
    expect(keptAnchor([inner.id, outer.id], lookup)).toBeNull();
  });

  it("drops the kept line on another page and on the next press, and has no state to restore after reload", () => {
    vi.stubGlobal("location", { pathname: "/app/sessions/s1" });
    const k = keepRefusal("Charge", reasons[0][1])!;
    expect(keptOnPage(k, "/app/sessions/s1")).toBe(true);
    expect(keptOnPage(k, "/app/sessions/s2")).toBe(false);
    if (!keptOnPage(k, "/app/sessions/s2")) dropKept(k.id);
    expect(currentKept()).toBeNull();
    expect(keptOnPage(k, "/app/sessions/s1")).toBe(true);
    expect(currentKept()).toBeNull(); // coming back doesn't restore a dropped line
    keepRefusal("Let it go", reasons[1][1]); notePress(null, null);
    expect(currentKept()).toBeNull();
    keepRefusal("Pay", reasons[2][1]); resetKept(); // a new document starts with module memory empty
    expect(currentKept()).toBeNull();
  });

  it("never shows a blank reason or an empty mistake bullet; an empty portal host stays hidden", () => {
    expect(keepRefusal("Charge", " \n ")).toBeNull();
    const k = keepRefusal("Charge", reasons[0][1])!;
    expect(keptShows({ ...k, text: " \n " }, 1000, false)).toBe(false);
    expect(mistakeBullets([], ["", " ", "\n"])).toEqual({ items: [], extra: [], n: 0 });
    const html = renderToStaticMarkup(createElement(FormMistakes, { text: k.text, press: "Charge" }));
    expect(html.replaceAll("&#x27;", "'")).toContain(k.text);
    expect(html).not.toContain("<li");
    const component = fs.readFileSync(path.resolve("src/components/KeptRefusal.tsx"), "utf8");
    expect(component).toContain('h.className = "empty:hidden"');
    expect(component).toContain('h.style.listStyle = "none"');
    expect(component).toContain("flat(refusalTextOutsideKept(p)).includes(msg)");
    expect(component).toContain("!keptOnPage(kept, location.pathname)");
  });
});

async function closedWork() {
  await db.outage.deleteMany({}); // site-wide outages from another test would move the window
  const s = await setup(); const j = await joined(s.testId, "Ana Silva", "they");
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  const ago = (days: number) => new Date(Date.now() - days * 86400000);
  await db.test.update({ where: { id: s.testId }, data: { openUntil: ago(30) } });
  await db.contract.update({ where: { id: j.sessionId }, data: { joinedAt: ago(45), dueAt: ago(30) } });
  await db.submission.update({ where: { id: sub.id }, data: { sentAt: ago(40), updatedAt: ago(40), payBy: ago(35), choiceOfferedAt: ago(25), choiceBy: ago(16) } });
  return { ...s, ...j, sub };
}

describe("batch 35 §95: actual closed-window refusals use the same stable display decision", () => {
  it.each(["charge", "letgo", "pay"])("%s is refused without a payment and its line stays steady after controls disappear", async (action) => {
    const x = await closedWork();
    const result = action === "pay"
      ? await json(await reviewPOST(req("/api/review", { cookie: x.dev.cookie, body: { payKey: randomUUID(), kind: "submission", id: x.sub.id, amount: "10.00", tickedCents: 1000, seenAt: seen() } })))
      : await sact(x.sessionId, "choose", x.tester.cookie, { submissionId: x.sub.id, choice: action, seenAt: seen() });
    expect(result.status, JSON.stringify(result.body)).toBe(409);
    expect(result.body.error.code).toBe(action === "pay" ? "pay_closed" : "charge_closed");
    expect(result.body.error.message).toMatch(action === "pay" ? /^Pay closed on .+\.$/ : /^Charge and Let it go closed on .+\.$/);
    const k = keepRefusal(action === "charge" ? "Charge" : action === "letgo" ? "Let it go" : "Pay", result.body.error.message)!;
    expect(checks(k, refusalTextOutsideKept)).toEqual(Array(20).fill(true));
    expect(await db.payment.count({ where: { submissionId: x.sub.id } })).toBe(0);
  });
});
