import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { ALREADY_DISPUTED, RATED_NO_DISPUTE, RATE_CLOSES_DISPUTES, canDispute, disputeClosedLine, paidMeanwhileLine, payUnderLine } from "@/lib/rules";
import { disputesClosed, pieceCloseOut } from "@/lib/server/closeOut";
import { decideDispute } from "@/lib/server/payments";
import { makeUser } from "./helpers";
import { act, sact, seen, settle } from "./fixtures";
import { DAY, pay, sentWork } from "./b15";

// (Owner, Nov 6, §288) A tester's disputes close: (1) when they rate the test (rating ends their part), on every part of theirs on it, a payment the developer
// makes after the rating included (no exception): "You rated this test, so its disputes are closed."; (2) at the part's closing date (pieceCloseOut, when its
// Charge, Let it go and Pay end): "This part closed on <date>, so it can't be disputed any more." A dispute already open stays open until the team decides it
// (the developer's side and the decision still work). The refusal is decided first: never a stop-once whose second press could only be refused (§159).

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/s", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const ago = (days: number) => new Date(Date.now() - days * DAY);
beforeEach(async () => {
  await db.outage.deleteMany({}); // site-wide: an earlier file's outage would move the closing dates
});

type W = Awaited<ReturnType<typeof sentWork>>;
const dispute = (w: W, extra: Record<string, unknown> = {}) => sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.sub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true, ...extra });
const rate = (w: W) => sact(w.sessionId, "rate", w.tester.cookie, { stars: 4, seenAt: seen(), confirmed: true });
/** Every deadline (and Open until) `daysAgo` days ago, and the piece's review date too: its closing date is 14 days after that. */
async function closesFrom(w: W, daysAgo: number) {
  await db.test.update({ where: { id: w.testId }, data: { openUntil: ago(daysAgo) } });
  await db.contract.updateMany({ where: { testId: w.testId }, data: { dueAt: ago(daysAgo) } });
  await db.submission.update({ where: { id: w.sub.id }, data: { payBy: ago(daysAgo) } });
}
const admin = async () => db.user.update({ where: { id: (await makeUser({ name: "Team Admin" })).user.id }, data: { isAdmin: true } });
const sessionPage = async (w: W) => {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: w.tester.user.id } });
  const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
  return unescape(renderToStaticMarkup(await SessionPage({ params: Promise.resolve({ id: w.sessionId }) })));
};
const testPage = async (w: W) => {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: w.dev.user.id } });
  const { default: TestPage } = await import("@/app/app/tests/[id]/page");
  return unescape(renderToStaticMarkup(await TestPage({ params: Promise.resolve({ id: w.testId }), searchParams: Promise.resolve({}) })));
};
const DISPUTE_FORM = ">Dispute the pay</summary>";

describe("§288 the rules", () => {
  it("the lines; closed comes after the tester's own choice and an existing dispute, before what's left to award", () => {
    expect(RATED_NO_DISPUTE).toBe("You rated this test, so its disputes are closed.");
    expect(disputeClosedLine("Nov 20, 2026")).toBe("This part closed on Nov 20, 2026, so it can't be disputed any more.");
    expect(canDispute(500, 1000, false, false, 0, RATED_NO_DISPUTE)).toEqual({ ok: false, message: RATED_NO_DISPUTE });
    expect(canDispute(500, 1000, true, false, 500, RATED_NO_DISPUTE)).toEqual({ ok: false, message: ALREADY_DISPUTED });
    expect(canDispute(500, 1000, false, false, 500, null).ok).toBe(true);
    // The tester's lines once their disputes are closed say nothing about disputing.
    expect(paidMeanwhileLine("Nora Lane", 600, 0, false)).toBe("Nora Lane paid $6.00 for this meanwhile.");
    expect(paidMeanwhileLine("Nora Lane", 600)).toBe("Nora Lane paid $6.00 for this meanwhile: you can dispute it if you think it should be more.");
    // The developer's line under Pay too.
    expect(payUnderLine("Ana Silva", true, false)).toBe("");
    expect(payUnderLine("Ana Silva", false, false)).toBe("This part isn't listed: pay any amount, $0 included.");
    expect(payUnderLine("Ana Silva", true)).toBe("Ana Silva can dispute the amount once.");
  });
});

describe("§288 (1) when the tester rates", () => {
  it("a part paid before the rating: Dispute is refused with the line, nothing made", async () => {
    const w = await sentWork();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "Partly useful" })).status).toBe(200);
    expect((await rate(w)).status).toBe(200);
    const r = await dispute(w);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "no_dispute", message: RATED_NO_DISPUTE });
    expect(await db.dispute.count({ where: { contractId: w.sessionId } })).toBe(0);
  });

  it("a payment the developer makes AFTER the rating: refused too, also from an older page (one refusal, never a stop-once first)", async () => {
    const w = await sentWork(null); // unlisted: past its review date the tester can rate before it's paid
    await db.contract.update({ where: { id: w.sessionId }, data: { dueAt: new Date(Date.now() - 60_000) } });
    await db.submission.update({ where: { id: w.sub.id }, data: { payBy: new Date(Date.now() - 60_000) } });
    expect((await rate(w)).status).toBe(200);
    const pageAt = seen();
    await settle();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "4.00", tickedCents: 400, reason: "Short" })).status).toBe(200);
    // The page loaded before the payment: a payment since then would stop a Dispute once; closed, it's the one refusal at once.
    const r = await dispute(w, { seenAt: pageAt, pageSeenAt: pageAt, confirmed: false });
    expect(r.body.error).toMatchObject({ code: "no_dispute", message: RATED_NO_DISPUTE });
    expect((await dispute(w)).body.error.message).toBe(RATED_NO_DISPUTE);
    expect(await db.dispute.count({ where: { contractId: w.sessionId } })).toBe(0);
    expect((await disputesClosed(w.sessionId, [{ submissionId: w.sub.id }])).get(w.sub.id)).toBe(RATED_NO_DISPUTE);
  });
});

describe("§288 (2) at the part's closing date", () => {
  it("before it a Dispute goes through; after it, refused with the date (from an older page too, never a stop-once)", async () => {
    const open = await sentWork();
    expect((await pay(open.dev.cookie, { kind: "submission", id: open.sub.id, amount: "5.00", tickedCents: 500, reason: "Partly useful" })).status).toBe(200);
    await closesFrom(open, 3); // closes in 11 days
    expect((await dispute(open)).status).toBe(200);

    const w = await sentWork();
    const pageAt = seen();
    await settle();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "Partly useful" })).status).toBe(200);
    await closesFrom(w, 20); // closed 6 days ago
    const at = await pieceCloseOut({ submissionId: w.sub.id }, "tester");
    expect(at!.getTime()).toBeLessThan(Date.now());
    const line = disputeClosedLine(fmtDate(at!));
    expect(line).toMatch(/^This part closed on [A-Z][a-z]{2} \d{1,2}, \d{4}, so it can't be disputed any more\.$/);
    const r = await dispute(w, { seenAt: pageAt, pageSeenAt: pageAt, confirmed: false });
    expect(r.body.error).toMatchObject({ code: "no_dispute", message: line });
    expect(await db.dispute.count({ where: { contractId: w.sessionId } })).toBe(0);
  });
});

describe("§288 (3) a dispute already open stays open", () => {
  it("after the closing date: the developer can still add their side and the team can still decide; a second Dispute reads the old line", async () => {
    const w = await sentWork();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "Partly useful" })).status).toBe(200);
    expect((await dispute(w)).status).toBe(200);
    await closesFrom(w, 20); // closed 6 days ago
    expect((await dispute(w)).body.error.message).toBe(ALREADY_DISPUTED);
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: w.sub.id } });
    expect((await act(w.testId, "dispute-side", w.dev.cookie, { disputeId: d.id, text: "Two answers were one word long.", seenAt: seen() })).status).toBe(200);
    expect((await db.dispute.findUniqueOrThrow({ where: { id: d.id } })).devSide).toBe("Two answers were one word long.");
    expect(await decideDispute(await admin(), d.id, { total: "10.00", tickCents: 500 })).toEqual({ extraCents: 500, line: "Done: raised the pay to $10.00 ($5.00 more charged)." });
    expect((await db.dispute.findUniqueOrThrow({ where: { id: d.id } })).status).not.toBe("open");
  });
});

describe("§288 on the pages", () => {
  it("the session page: Dispute's form before; after the rating the button greyed with the line (and nothing left saying a dispute still works)", async () => {
    const w = await sentWork();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "Partly useful" })).status).toBe(200);
    let page = await sessionPage(w);
    expect(page).toContain(DISPUTE_FORM);
    expect(page).not.toContain("data-dispute-closed");
    expect((await rate(w)).status).toBe(200);
    page = await sessionPage(w);
    expect(page).not.toContain(DISPUTE_FORM);
    const box = page.slice(page.indexOf('data-dispute-closed=""'));
    expect(page.indexOf('data-dispute-closed=""')).toBeGreaterThan(0);
    expect(box).toMatch(/^data-dispute-closed=""><button type="button" class="btn-ghost text-sm" disabled="">Dispute the pay<\/button><p class="note">You rated this test, so its disputes are closed\.<\/p>/);
    // The Rate pop-up says it before the tester rates.
    expect(RATE_CLOSES_DISPUTES).toBe("Rating also closes your disputes on this test: you won't be able to dispute any payment on it, one made after you rate included.");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("lines={[...rateWarn.lines, RATE_CLOSES_DISPUTES]}");
  });

  it("the session page after the part's closing date: the button greyed with the date", async () => {
    const w = await sentWork();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "Partly useful" })).status).toBe(200);
    await closesFrom(w, 20);
    const page = await sessionPage(w);
    expect(page).not.toContain(DISPUTE_FORM);
    const line = disputeClosedLine(fmtDate((await pieceCloseOut({ submissionId: w.sub.id }, "tester"))!));
    expect(page).toContain(`<p class="note">${line}</p>`);
  });

  it("the developer's Pay box: once the tester rated, its line says nothing about disputing", async () => {
    const w = await sentWork(null);
    let page = await testPage(w);
    expect(page).toContain("This part isn't listed: pay any amount, $0 included. Ana Silva can dispute the amount once.");
    await db.contract.update({ where: { id: w.sessionId }, data: { dueAt: new Date(Date.now() - 60_000) } });
    await db.submission.update({ where: { id: w.sub.id }, data: { payBy: new Date(Date.now() - 60_000) } });
    expect((await rate(w)).status).toBe(200);
    page = await testPage(w);
    expect(page).toContain('data-pay-under="">This part isn\'t listed: pay any amount, $0 included.</p>');
    expect(page).not.toContain("can dispute the amount once");
  });
});
