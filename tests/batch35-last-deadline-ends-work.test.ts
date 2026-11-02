import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { finishWorkIfDue, closeWorkAfterDeadlines, assertWorkOpen } from "@/lib/server/workWindow";
import { unpauseTest } from "@/lib/server/restrictions";
import { runDaily } from "@/lib/server/holds";
import { closeOutOf, pieceCloseOut } from "@/lib/server/closeOut";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, req } from "./helpers";
import { act, joined, sact, seen, setup } from "./fixtures";

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, requireOpenPage: async () => auth.user, adminAway() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/demo", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;
const DAY = 86400000;
const at = (date: string) => vi.setSystemTime(new Date(date));
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-11-01T12:00:00Z");
  await db.outage.deleteMany();
});
afterEach(() => vi.useRealTimers());

async function fixture(two = true) {
  at("2026-11-01T12:00:00Z");
  const f = await setup({ openUntil: "2026-11-06", timeZone: "UTC", recordingCents: "10.00" });
  await db.user.update({ where: { id: f.dev.user.id }, data: { timeZone: "UTC" } });
  const early = await joined(f.testId, "Early", "they");
  at("2026-11-03T12:00:00Z");
  const late = two ? await joined(f.testId, "Later", "they") : early;
  const last = await db.contract.findUniqueOrThrow({ where: { id: late.sessionId } });
  return { ...f, early, late, deadline: last.dueAt };
}
async function sent(f: Awaited<ReturnType<typeof fixture>>) {
  at("2026-11-05T12:00:00Z");
  expect((await sact(f.early.sessionId, "written", f.early.tester.cookie, { answers: ["First observations", "Further observations"], seenAt: seen(), confirmed: true })).status).toBe(200);
  return db.submission.findFirstOrThrow({ where: { contractId: f.early.sessionId, kind: "written" } });
}

describe("work ends at the last tester deadline, with financial windows continuing", () => {
  it("Open until and an earlier tester deadline do not end the whole test while another tester has time", async () => {
    const f = await fixture();
    at("2026-11-07T12:00:00Z");
    expect(await finishWorkIfDue(f.testId)).toBe(false);
    const send = await sact(f.early.sessionId, "written", f.early.tester.cookie, { answers: ["Still within the test work window", "Late for my own Charge eligibility"], seenAt: seen(), confirmed: true });
    expect(send.status, JSON.stringify(send.body)).toBe(200);
    expect((await db.submission.findFirstOrThrow({ where: { contractId: f.early.sessionId } })).late).toBe(true);
    const call = await sact(f.early.sessionId, "request-time", f.early.tester.cookie, { startsAt: "2026-11-08T15:00:00Z", seenAt: seen(), confirmed: true });
    expect(call.status, JSON.stringify(call.body)).toBe(200);
  });

  it("ends all working sessions once, at the last deadline rather than the next job's time", async () => {
    const f = await fixture(); const sub = await sent(f);
    vi.setSystemTime(new Date(f.deadline.getTime() - 1));
    expect(await finishWorkIfDue(f.testId)).toBe(false);
    vi.setSystemTime(new Date(f.deadline.getTime() + 1));
    expect(await finishWorkIfDue(f.testId)).toBe(true);
    const t = await db.test.findUniqueOrThrow({ where: { id: f.testId } });
    expect(t).toMatchObject({ status: "closed", workEndedAt: f.deadline, stoppedAt: null, adminStoppedAt: null });
    for (const c of await db.contract.findMany({ where: { testId: f.testId } })) expect(c).toMatchObject({ status: "ended", endKind: "closed", endedAt: f.deadline });
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).payBy).toEqual(sub.payBy);
    expect(await finishWorkIfDue(f.testId)).toBe(false);
    expect(await db.testEvent.count({ where: { testId: f.testId, text: "The test was closed" } })).toBe(1);
  });

  it("a stale Send or call request ends the test and refuses without waiting for a daily job", async () => {
    const f = await fixture(); await sent(f);
    vi.setSystemTime(new Date(f.deadline.getTime() + 1000));
    const send = await sact(f.early.sessionId, "written", f.early.tester.cookie, { answers: ["After the final deadline", "Must not replace the work"], seenAt: seen(), confirmed: true });
    expect(send.status).toBe(409);
    const tester = await sact(f.late.sessionId, "request-time", f.late.tester.cookie, { startsAt: "2026-11-12T15:00:00Z", seenAt: seen(), confirmed: true });
    expect(tester.status).toBe(409);
    const developer = await act(f.testId, "request-time", f.dev.cookie, { contractIds: [f.late.sessionId], startsAt: "2026-11-12T15:00:00Z", seenAt: seen(), confirmed: true });
    expect(developer.status).toBe(409);
    const leave = await sact(f.early.sessionId, "leave", f.early.tester.cookie, { seenAt: seen(), confirmed: true });
    expect(leave.status).toBe(409);
    expect((await db.contract.findUniqueOrThrow({ where: { id: f.early.sessionId } })).status).toBe("ended");
    expect(await db.callRequest.count({ where: { testId: f.testId } })).toBe(0);
  });

  it("closes pending requests and future calls, retaining completed calls and their pay", async () => {
    const f = await fixture();
    const future = new Date(f.deadline.getTime() + DAY);
    const slot = await db.callSlot.create({ data: { testId: f.testId, startsAt: future, minutes: 30, allowedTesterIds: [], status: "booked" } });
    const call = await db.call.create({ data: { slotId: slot.id, contractId: f.early.sessionId, startsAt: future, minutes: 30, rateCents: 3000 } });
    const request = await db.callRequest.create({ data: { testId: f.testId, contractId: f.late.sessionId, fromSide: "tester", startsAt: future, minutes: 30 } });
    const past = await db.call.create({ data: { slotId: slot.id, contractId: f.early.sessionId, startsAt: new Date(f.deadline.getTime() - DAY), minutes: 10, rateCents: 3000, measuredMinutes: 10, measuredAt: new Date(f.deadline.getTime() - DAY), payBy: new Date(f.deadline.getTime() + 6 * DAY) } });
    vi.setSystemTime(new Date(f.deadline.getTime() + 1000));
    expect(await finishWorkIfDue(f.testId)).toBe(true);
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).status).toBe("cancelled");
    expect((await db.callRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("closed");
    expect(await db.call.findUniqueOrThrow({ where: { id: past.id } })).toMatchObject({ status: "booked", measuredMinutes: 10, payBy: past.payBy });
    expect(await db.review.count({ where: { callId: past.id } })).toBe(0);
  });

  it("clips an ongoing call's logged time to the deadline, not a late poll", async () => {
    const f = await fixture();
    const start = new Date(f.deadline.getTime() - 5 * 60000), end = new Date(f.deadline.getTime() + 5 * 60000);
    const slot = await db.callSlot.create({ data: { testId: f.testId, startsAt: start, minutes: 30, allowedTesterIds: [], status: "booked" } });
    const call = await db.call.create({ data: { slotId: slot.id, contractId: f.early.sessionId, startsAt: start, minutes: 30, rateCents: 3000 } });
    for (const side of ["tester", "developer"]) await db.callPresence.create({ data: { callId: call.id, userId: side === "developer" ? f.dev.user.id : f.early.tester.user.id, side, startAt: start, endAt: end } });
    vi.setSystemTime(end);
    await finishWorkIfDue(f.testId);
    expect(await db.call.findUniqueOrThrow({ where: { id: call.id } })).toMatchObject({ endedAt: f.deadline, endReason: "ended", measuredMinutes: 5, payBy: new Date(f.deadline.getTime() + 7 * DAY) });
  });

  it("an eight-day extended pause preserves the remaining work time", async () => {
    const f = await fixture(false);
    const start = new Date("2026-11-05T12:00:00Z");
    await db.test.update({ where: { id: f.testId }, data: { adminPausedAt: start, pausedSince: start, pauseCloseAt: new Date("2026-11-20T12:00:00Z"), pauseCloseSetAt: start } });
    at("2026-11-13T12:00:00Z");
    expect(await finishWorkIfDue(f.testId)).toBe(false);
    await unpauseTest(f.testId);
    expect((await db.contract.findUniqueOrThrow({ where: { id: f.early.sessionId } })).dueAt).toEqual(new Date(f.deadline.getTime() + 8 * DAY));
    expect(await finishWorkIfDue(f.testId)).toBe(false);
  });

  it("the background check closes a due test, and a later pause does not revive ended work", async () => {
    const f = await fixture(); const sub = await sent(f);
    vi.setSystemTime(new Date(f.deadline.getTime() + 1000));
    expect(await closeWorkAfterDeadlines(new Date(), f.dev.user.id)).toBe(1);
    expect(await closeWorkAfterDeadlines(new Date(), f.dev.user.id)).toBe(0);
    const before = await db.test.findUniqueOrThrow({ where: { id: f.testId } });
    const contractBefore = await db.contract.findUniqueOrThrow({ where: { id: f.early.sessionId } });
    const start = new Date("2026-11-10T12:00:00Z");
    await db.test.update({ where: { id: f.testId }, data: { adminPausedAt: start, pausedSince: start, pauseCloseAt: new Date("2026-11-25T12:00:00Z"), pauseCloseSetAt: start } });
    await db.testEvent.create({ data: { testId: f.testId, kind: "paused", text: "The team paused this test", createdAt: start } });
    at("2026-11-18T12:00:00Z");
    await unpauseTest(f.testId);
    // Prisma uses the database clock for default event times; keep this fixture on its controlled clock.
    await db.testEvent.updateMany({ where: { testId: f.testId, kind: "resumed" }, data: { createdAt: new Date() } });
    const after = await db.test.findUniqueOrThrow({ where: { id: f.testId } });
    expect(after.openUntil).toEqual(before.openUntil);
    expect(after.workEndedAt).toEqual(f.deadline);
    expect((await db.contract.findUniqueOrThrow({ where: { id: f.early.sessionId } })).dueAt).toEqual(contractBefore.dueAt);
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).payBy).toEqual(new Date(sub.payBy!.getTime() + 8 * DAY));
    expect(await closeOutOf(f.testId)).toEqual(new Date(f.deadline.getTime() + 22 * DAY));
  });

  it("Pay and the later Charge window remain available after work ends; Rate keeps its own close-out", async () => {
    const f = await fixture(); const sub = await sent(f);
    vi.setSystemTime(new Date(f.deadline.getTime() + 1000));
    await finishWorkIfDue(f.testId);
    const pay = await json(await reviewPOST(req("/api/review", { cookie: f.dev.cookie, body: { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, payKey: randomUUID(), seenAt: seen(), confirmed: true } })));
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    expect(await closeOutOf(f.testId)).toEqual(new Date(f.deadline.getTime() + 14 * DAY));
    expect(await pieceCloseOut({ submissionId: sub.id }, "tester")).toEqual(new Date(sub.payBy!.getTime() + 14 * DAY));
    const g = await fixture(); const unpaid = await sent(g);
    vi.setSystemTime(new Date(unpaid.payBy!.getTime() + 1000));
    await runDaily(new Date());
    expect((await db.submission.findUniqueOrThrow({ where: { id: unpaid.id } })).choiceOfferedAt).not.toBeNull();
    expect((await db.contract.findUniqueOrThrow({ where: { id: g.early.sessionId } })).status).toBe("ended");
  }, 120000);

  it("page loads show ended work and the server's final check refuses a deadline crossed during a press", async () => {
    const f = await fixture();
    vi.setSystemTime(new Date(f.deadline.getTime() + 1000));
    await expect(assertWorkOpen(db, f.testId)).rejects.toMatchObject({ status: 409 });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: f.early.tester.user.id } });
    const { default: Page } = await import("@/app/app/sessions/[id]/page");
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: f.early.sessionId }) }));
    expect(html).toContain('data-stopped-line=""');
    expect(html).not.toContain('data-written-send=""');
    expect(html).not.toContain("Request a time");
    expect(html).not.toContain("Leave this test");
  });
});
