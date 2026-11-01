import fs from "node:fs";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { TesterPaymentTag } from "@/components/TesterPaymentTag";
import { testerPaymentStatus, type TesterPaymentFacts } from "@/lib/testerPaymentStatus";
import { Err } from "@/components/Err";
import { LET_GO_BY_TESTER } from "@/lib/rules";
import { joined, sact, setup } from "./fixtures";

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, adminAway: () => {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/test", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;
const source = (file: string) => fs.readFileSync(path.join(process.cwd(), "src", file), "utf8");
const review = { rejected: false, reason: "" };

describe("batch 35 §97: payment tags replace blue payment-state notices", () => {
  it.each<[TesterPaymentFacts, string]>([
    [{}, "Waiting for review"],
    [{ review }, "Paid"],
    [{ review, delayed: true }, "Payment delayed"],
    [{ delayed: true, closedOn: "Oct 31, 2026" }, "Payment delayed"],
    [{ closedOn: "Oct 31, 2026" }, "Not paid (closed on Oct 31, 2026)"],
    [{ review: { rejected: true, reason: "Not complete" } }, "Rejected"],
    [{ review: { rejected: true, reason: "Not complete" }, paidCents: 1000 }, "Paid"],
    [{ review: { ...review, reason: LET_GO_BY_TESTER } }, "Let go"],
    [{ review: { ...review, teamClosedById: "admin" } }, "Closed by the team"],
    [{ review, developerDeleted: "Nora Lane" }, "Paid"],
  ])("uses the existing state facts for %j", (facts, text) => {
    expect(testerPaymentStatus(facts).text).toBe(text);
    const html = renderToStaticMarkup(createElement(TesterPaymentTag, facts));
    expect(html).toContain('class="badge ');
    expect(html).toContain(text);
    expect(html).not.toContain('class="info"');
  });

  async function fixture() {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Alex Morgan", "they");
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: tester.user.id } });
    return { dev, testId, tester, sessionId, sub };
  }
  async function parts(sessionId: string) {
    const { default: Page } = await import("@/app/app/sessions/[id]/page");
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: sessionId }) }));
    const body = html.match(/<section id="parts"[\s\S]*?<\/section>/)?.[0];
    expect(body).toBeTruthy();
    return body!;
  }

  it("a paid written part shows Paid and no blue delay notice", async () => {
    const f = await fixture();
    await db.review.create({ data: { contractId: f.sessionId, submissionId: f.sub.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID() } });
    await db.payment.create({ data: { kind: "review", contractId: f.sessionId, submissionId: f.sub.id, developerId: f.dev.user.id, testerId: f.tester.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "charged" } });
    const html = await parts(f.sessionId);
    expect(html).toContain('data-part-status="paid">Paid</span>');
    expect(html).not.toContain("Payment may be delayed");
    expect(html).not.toContain('class="info"');
  });

  it("a dispute raise waiting for the bank has a delayed tag; only the settled base counts as paid", async () => {
    const f = await fixture();
    await db.review.create({ data: { contractId: f.sessionId, submissionId: f.sub.id, amountCents: 400, agreedCents: 1000, payKey: randomUUID() } });
    await db.payment.create({ data: { kind: "review", contractId: f.sessionId, submissionId: f.sub.id, developerId: f.dev.user.id, testerId: f.tester.user.id, amountCents: 400, feeCents: 80, testerCents: 320, status: "charged" } });
    const dispute = await db.dispute.create({ data: { contractId: f.sessionId, submissionId: f.sub.id, testerId: f.tester.user.id, reason: "All questions answered", status: "decided", decidedCents: 1000, decidedAt: new Date() } });
    await db.payment.create({ data: { kind: "dispute", disputeId: dispute.id, contractId: f.sessionId, submissionId: f.sub.id, developerId: f.dev.user.id, testerId: f.tester.user.id, amountCents: 600, feeCents: 120, testerCents: 480, status: "needs_confirmation" } });
    const html = await parts(f.sessionId);
    expect(html).toContain('data-part-status="delayed">Payment delayed</span>');
    expect(html).toContain("Paid so far for this part: $4.00");
    expect(html).not.toContain("Payment may be delayed");
    expect(html).not.toContain('class="info"');
  });

  it("recordings and each measured call use the same paid and delayed badges", async () => {
    const f = await fixture();
    const recording = await db.submission.create({ data: { contractId: f.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date() } });
    await db.review.create({ data: { contractId: f.sessionId, submissionId: recording.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID() } });
    await db.payment.create({ data: { kind: "review", contractId: f.sessionId, submissionId: recording.id, developerId: f.dev.user.id, testerId: f.tester.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "deferred" } });
    for (const [i, status] of ["charged", "needs_confirmation"].entries()) {
      const startsAt = new Date(Date.now() - (i + 1) * 86400000);
      const slot = await db.callSlot.create({ data: { testId: f.testId, startsAt, minutes: 30, allowedTesterIds: [], status: "booked" } });
      const call = await db.call.create({ data: { slotId: slot.id, contractId: f.sessionId, startsAt, minutes: 30, rateCents: 3000, measuredMinutes: 30, measuredAt: new Date() } });
      await db.review.create({ data: { contractId: f.sessionId, callId: call.id, amountCents: 1500, agreedCents: 1500, payKey: randomUUID() } });
      await db.payment.create({ data: { kind: "call", contractId: f.sessionId, callId: call.id, developerId: f.dev.user.id, testerId: f.tester.user.id, amountCents: 1500, feeCents: 300, testerCents: 1200, status } });
    }
    const html = await parts(f.sessionId);
    expect(html.match(/data-part-status="delayed">Payment delayed/g)).toHaveLength(2);
    expect(html.match(/data-part-status="paid">Paid/g)).toHaveLength(1);
    expect(html).not.toContain('class="info"');
    expect(html).not.toContain("Payment may be delayed");
  });

  it("closed unpaid work has its dated tag; a refused Charge is blue and a fresh page drops it", async () => {
    const f = await fixture();
    await db.outage.deleteMany();
    const ago = (days: number) => new Date(Date.now() - days * 86400000);
    await db.contract.update({ where: { id: f.sessionId }, data: { joinedAt: ago(45), dueAt: ago(30) } });
    await db.test.update({ where: { id: f.testId }, data: { openUntil: ago(30) } });
    await db.submission.update({ where: { id: f.sub.id }, data: { sentAt: ago(40), payBy: ago(35), choiceOfferedAt: ago(25), choiceBy: ago(16) } });
    const r = await sact(f.sessionId, "choose", f.tester.cookie, { submissionId: f.sub.id, choice: "charge", confirmed: true });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error.code).toBe("charge_closed");
    const reason = r.body.error.message as string;
    expect(renderToStaticMarkup(createElement(Err, { text: reason }))).toContain('class="err"');
    const html = await parts(f.sessionId);
    expect(html).toMatch(/data-part-status="closed">Not paid \(closed on [^<]+\)<\/span>/);
    expect(html).not.toContain(reason);
    expect(html).not.toContain('class="err"');
    expect(source("components/Err.tsx")).toContain("useGoneOnNewVersion");
    expect(source("app/app/sessions/[id]/ChoiceBox.tsx")).toContain("refusalLine(pressed, err)");
  });
});
