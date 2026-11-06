import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { jumpTo } from "@/lib/markJump";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 6, §301; replaces §282's content panel then pay panel in the Testers list) Each part in a tester's drop-down (written answers, a recording, a call
// in Had) reads: its heading line; its "Payments (N)" drop-down (left out when there are none), ABOVE the content; its content panel (Questions (N), the
// recordings, the call's details); then a SEPARATE "Pay more" drop-down ("Pay" before anything was paid), closed at first, kept per part, opened by a jump into it.
// The closed-unpaid, at-cap, $0 and team-closed lines sit inside it; the bank line ("Confirm with your bank in Needs you ↑", or "waiting for your bank" while the
// box is greyed) on its summary line. The tester panel's "Calls: …" summary line is gone (the Live call part's Had / Cancelled say it).

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/t", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const DAY = 86_400_000;
const testPage = async (testId: string, userId: string) => {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const { default: TestPage } = await import("@/app/app/tests/[id]/page");
  return unescape(renderToStaticMarkup(await TestPage({ params: Promise.resolve({ id: testId }), searchParams: Promise.resolve({}) })));
};
/** The `<details …>` tag that opens the fold with this id. */
const foldTag = (html: string, fold: string) => { const at = html.indexOf(`data-fold="${fold}"`); return at < 0 ? "" : html.slice(html.lastIndexOf("<details", at), html.indexOf(">", at)); };
/** The whole element whose opening tag holds position `at` (its nested same-name tags counted). */
function elementAt(html: string, at: number) {
  if (at < 0) return "";
  const start = html.lastIndexOf("<", at);
  const tag = /^<([a-z0-9]+)/.exec(html.slice(start))![1];
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return html.slice(start);
}

/** A sent written part (and, with `recording`, a recording) for a joined tester. */
async function sent(recording = false) {
  const s = await setup(recording ? { recordingCents: "10.00" } : {});
  const j = await joined(s.testId);
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["the boats", "level two gate"], notes: "", seenAt: seen(), confirmed: true })).status).toBe(200);
  const sub = await db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: j.sessionId, kind: "written" } } });
  let rec = null;
  if (recording) {
    rec = await db.submission.create({ data: { contractId: j.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
    await db.recording.create({ data: { contractId: j.sessionId, submissionId: rec.id, storageKey: "k/clip.mp4", filename: "clip.mp4", sizeBytes: 1000, contentType: "video/mp4", part: "recording", uploadedAt: new Date() } });
  }
  return { ...s, j, sub, rec };
}
/** Paid with a Pay of $5 (a review and its charge), below the $10 cap: Pay more stays open. */
async function paid(s: Awaited<ReturnType<typeof sent>>, at: { submissionId?: string; callId?: string }, status = "charged") {
  await db.review.create({ data: { ...at, contractId: s.j.sessionId, amountCents: 500, agreedCents: 1000, reason: "", payKey: randomUUID() } });
  await db.payment.create({ data: { kind: at.callId ? "call" : "review", amountCents: 500, status, contractId: s.j.sessionId, ...at, developerId: s.dev.user.id, testerId: s.j.tester.user.id, feeCents: 0, testerCents: 0 } });
}

/** A part's three pieces in order: Payments (N) right under the heading, then the content panel, then the separate Pay drop-down. */
function partOrder(part: string, id: string, label: "Pay more" | "Pay") {
  const pays = elementAt(part, part.indexOf(`data-part-payments="${id}"`));
  expect(pays).not.toBe("");
  expect(pays).toContain(`data-part-pays-count="1">Payments (1)</span>`);
  expect(pays).toContain(`data-part-pay="`);
  expect(pays).not.toContain(">Payments for this part</p>"); // the plain label is gone
  expect(foldTag(part, `row-pays-${id}`)).toMatch(/^<details /);
  expect(foldTag(part, `row-pays-${id}`)).not.toMatch(/ open="/);
  const contentAt = part.indexOf('data-part-panel="content"');
  const content = elementAt(part, contentAt);
  expect(part.indexOf(pays) + pays.length).toBeLessThanOrEqual(part.lastIndexOf("<", contentAt)); // Payments above the content, outside it
  expect(content).not.toContain("data-part-payments");
  const payAt = part.indexOf(`data-fold="row-pay-${id}"`);
  expect(payAt).toBeGreaterThan(part.indexOf(content) + content.length - 1); // separate: under the content, not inside it
  const pay = elementAt(part, payAt);
  const tag = foldTag(part, `row-pay-${id}`);
  expect(tag).toContain('data-part-panel="pay"');
  expect(tag).not.toMatch(/ open="/); // closed at first
  expect(tag).toContain('data-jump-open=""'); // a link to the part opens it (§139)
  expect(pay).toContain(`<span data-pay-fold-label="">${label}</span>`);
  expect(pay).not.toContain("data-part-payments");
  return { content, pay };
}

describe("§301 the Testers list: Payments (N) under the heading, the content, then a separate Pay more drop-down", () => {
  it("written answers and a recording: Payments (1), the content panel (Questions / recordings), then the closed Pay more drop-down holding the Pay more box", async () => {
    const s = await sent(true);
    await paid(s, { submissionId: s.sub.id });
    await paid(s, { submissionId: s.rec!.id });
    const page = await testPage(s.testId, s.dev.user.id);
    for (const [sub, kind] of [[s.sub, "written"], [s.rec!, "recording"]] as const) {
      const part = elementAt(page, page.indexOf(`id="part-${sub.id}"`));
      const { content, pay } = partOrder(part, sub.id, "Pay more");
      expect(content).toContain(`data-sent-work="${kind}"`);
      if (kind === "written") expect(content).toContain(`data-fold="row-${sub.id}-questions"`);
      else expect(content).toContain(`data-panel="row-${sub.id}"`);
      expect(pay).toContain('data-part-pay-more=""');
      expect(pay).toContain(`data-pay-more="${sub.id}"`); // the Pay more box itself, inside the drop-down
      expect(pay).not.toContain('<p class="text-sm font-medium text-white">Pay more</p>'); // the plain heading is now the drop-down's summary
      expect(pay).not.toContain("data-pay-fold-waits");
    }
  });

  it("a call in Had: Payments (1), its details panel, then the closed Pay more drop-down; the 'Calls: …' summary line is gone", async () => {
    const s = await sent();
    const at = new Date(Date.now() - 2 * DAY);
    const slot = await db.callSlot.create({ data: { testId: s.testId, startsAt: at, minutes: 30, allowedTesterIds: [], status: "booked" } });
    const call = await db.call.create({ data: { slotId: slot.id, contractId: s.j.sessionId, startsAt: at, minutes: 30, rateCents: 3100, actualMinutes: 30, measuredAt: new Date() } });
    const gone = new Date(Date.now() - 3 * DAY);
    const slot2 = await db.callSlot.create({ data: { testId: s.testId, startsAt: gone, minutes: 30, allowedTesterIds: [], status: "booked" } });
    await db.call.create({ data: { slotId: slot2.id, contractId: s.j.sessionId, startsAt: gone, minutes: 30, rateCents: 3100, status: "cancelled", cancelledBy: "tester", cancelledAt: new Date(Date.now() - 4 * DAY), cancelNote: "Sick" } });
    await paid(s, { callId: call.id });
    const page = await testPage(s.testId, s.dev.user.id);
    const row = elementAt(page, page.indexOf(`data-over-call="${call.id}"`));
    const { content, pay } = partOrder(row, call.id, "Pay more");
    expect(content).toContain('data-call-length=""');
    expect(pay).toContain('data-call-pay-more=""');
    expect(pay).toContain(`data-pay-more="${call.id}"`);
    // (§301) No "Calls: 1 done, 1 cancelled" line under Chat: Had (1) and Cancelled (1) already say it.
    expect(page).toContain('data-calls-had="1"');
    expect(page).toContain('data-calls-cancelled="1"');
    expect(page).not.toContain("data-tester-calls");
    expect(page).not.toMatch(/>Calls: \d/);
  });

  it("no payments: no Payments drop-down; nothing to pay or note either: no Pay drop-down, the content panel alone", async () => {
    const s = await sent(true);
    const page = await testPage(s.testId, s.dev.user.id);
    for (const sub of [s.sub, s.rec!]) {
      const part = elementAt(page, page.indexOf(`id="part-${sub.id}"`));
      expect(part).toContain('data-part-panel="content"');
      expect(part).not.toContain("data-part-payments");
      expect(part).not.toContain(`row-pays-${sub.id}`);
      expect(part).not.toContain(`data-fold="row-pay-${sub.id}"`); // unpaid, still in Needs you: nothing to show under the content
    }
  });

  it("a Pay more greyed for a check waiting for the bank says so on the closed drop-down's summary line", async () => {
    const s = await sent();
    await paid(s, { submissionId: s.sub.id });
    await db.payment.create({ data: { kind: "extra", amountCents: 200, status: "needs_action", contractId: s.j.sessionId, submissionId: s.sub.id, developerId: s.dev.user.id, testerId: s.j.tester.user.id, feeCents: 0, testerCents: 0 } });
    await settle();
    const page = await testPage(s.testId, s.dev.user.id);
    const part = elementAt(page, page.indexOf(`id="part-${s.sub.id}"`));
    const pay = elementAt(part, part.indexOf(`data-fold="row-pay-${s.sub.id}"`));
    expect(foldTag(part, `row-pay-${s.sub.id}`)).not.toMatch(/ open="/);
    const summary = elementAt(pay, pay.indexOf("<summary"));
    expect(summary).toContain('data-pay-fold-waits="">· waiting for your bank</span>');
    expect(pay).toContain('data-pay-greyed=""');
  });

  it("a jump to the Pay more box (or anything in it) opens the drop-down, the part and the tester fold around it", () => {
    class Details { open = false; dataset: Record<string, string> = {}; constructor(public parentElement: unknown = null) {} }
    class El {
      dataset: Record<string, string> = {}; attrs: Record<string, string> = {}; scrolled = false;
      constructor(public id: string, public parentElement: unknown) {}
      querySelectorAll() { return []; }
      scrollIntoView() { this.scrolled = true; }
      setAttribute(k: string, v: string) { this.attrs[k] = v; }
      removeAttribute(k: string) { delete this.attrs[k]; }
    }
    vi.stubGlobal("HTMLDetailsElement", Details);
    const tester = new Details();
    const part = new Details(tester);
    const payMore = new Details(part); // the closed "Pay more" drop-down
    const box = new El("amt-s1", { dataset: {}, parentElement: payMore });
    vi.stubGlobal("document", { getElementById: (id: string) => (id === "amt-s1" ? box : null) });
    jumpTo("amt-s1");
    expect(payMore.open).toBe(true);
    expect(part.open).toBe(true);
    expect(tester.open).toBe(true);
    expect(box.scrolled).toBe(true);
    vi.unstubAllGlobals();
  });

  it("the sources: Needs you keeps content first, then its Pay drop-down, and no payments list (§225)", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page.match(/<PartPayments /g)).toHaveLength(2); // the Testers list's part and call rows only
    for (const at of ["const partNode = ", "const updateNode = "]) {
      const node = page.slice(page.indexOf(at), page.indexOf("\n  const ", page.indexOf(at) + 1));
      expect(node).not.toContain("PartPayments");
      expect(node.indexOf('data-part-panel="content"')).toBeGreaterThan(0);
      expect(node.indexOf('"data-part-panel": "pay"')).toBeGreaterThan(node.indexOf('data-part-panel="content"'));
    }
    expect(src("components/PartPayments.tsx")).toContain("<Fold id={`row-pays-${id}`} defaultOpen={false} jumpOpen={false}");
  });
});
