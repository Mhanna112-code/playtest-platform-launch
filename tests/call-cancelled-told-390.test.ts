import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { devChanges } from "@/lib/server/live";
import { testerChanges } from "@/lib/server/testerGate";
import { adminStopTest, pauseTest } from "@/lib/server/restrictions";
import { blockUser } from "@/lib/server/blocks";
import { recordOutage } from "@/lib/server/outages";
import { sweepNobodyJoined } from "@/lib/server/calls";
import { fmtIn, renderTimes } from "@/lib/tz";
import { fmtDateTime } from "@/lib/server/dateFormat";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 11, §390 a) Every cancelled call is told to whoever didn't cancel it: a bell line naming the call (its date and time in their zone) and the test,
// merged into the line they already get when there is one, and the live line in their open pages (a stop-once reason, except a cancellation a stop, a closure
// or an early end made: batch 16 §24, whose own stopped / ended line stops instead). The one whose own press caused it gets no bell line.

const MIN = 60_000;
const when = (d: Date) => fmtIn("UTC", d); // the readers here have no zone: UTC
/** The tester's live lines are written like her page's times (no zone name). */
const pageWhen = (d: Date) => fmtDateTime(d);
const bells = async (userId: string) => (await db.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } })).map((n) => n.text);
const live = (lines: { text: string }[]) => lines.map((l) => renderTimes(l.text, "UTC"));
const devLive = async (w: { dev: { user: { id: string } }; testId: string }, since: Date) => live(await devChanges(w.dev.user.id, w.testId, since, "", db, { all: true }));
const testerLive = async (w: { tester: { user: { id: string } }; sessionId: string; testId: string }, since: Date) => live(await testerChanges(w.tester.user.id, w.sessionId, w.testId, since));
async function admin() {
  const a = await makeUser({ email: `admin-390a-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
/** A working tester (Ana Silva) with a call booked `hours` ahead with the developer (Nora Lane). */
async function booked(hours = 48) {
  const s = await setup({ liveRateCents: "30.00" });
  const j = await joined(s.testId);
  const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, hours);
  await settle();
  return { ...s, ...j, call, since: new Date() };
}

describe("§390 a: a cancelled call is told to the side that didn't cancel it", () => {
  it("a tester leaving: the developer's bell and live line name the call (merged into the leave line); the tester gets no bell", async () => {
    const w = await booked();
    const before = (await bells(w.tester.user.id)).length;
    expect((await sact(w.sessionId, "leave", w.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await bells(w.dev.user.id)).toContain(`Ana Silva left “Harbor Run”; your call on ${when(w.call.startsAt)} was cancelled`);
    expect(await devLive(w, w.since)).toContain(`Ana Silva left the test; your call on ${when(w.call.startsAt)} was cancelled`);
    expect((await bells(w.tester.user.id)).length).toBe(before);
  });

  it("a tester rating (her part ends): the developer's bell and live line", async () => {
    const s = await setup({ liveRateCents: "30.00" });
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["The harbour level was clear.", "Nowhere."], seenAt: seen(), confirmed: true });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    expect((await json(await reviewPOST(req("/api/review", { cookie: s.dev.cookie, body: { payKey: randomUUID(), kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true } })))).status).toBe(200);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
    await settle();
    const since = new Date();
    const r = await sact(j.sessionId, "rate", j.tester.cookie, { stars: 4, seenAt: seen(), confirmed: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await bells(s.dev.user.id)).toContain(`Your call with Ana Silva on “Harbor Run” on ${when(call.startsAt)} was cancelled because Ana Silva finished her part`);
    expect(await devLive({ ...s }, since)).toContain(`Ana Silva finished her part (rated you); your call on ${when(call.startsAt)} was cancelled`);
  });

  it("the other side's Cancel call: the tester's bell and her live line (a stop-once line)", async () => {
    const w = await booked();
    expect((await act(w.testId, "cancel-call", w.dev.cookie, { callId: w.call.id, reason: "", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await bells(w.tester.user.id)).toContain(`Nora Lane cancelled the call on “Harbor Run” on ${fmtIn("UTC", w.call.startsAt, "dayTime")}.`);
    expect(await testerLive(w, w.since)).toContain(`Your call with Nora Lane on ${pageWhen(w.call.startsAt)} was cancelled`);
  });

  it("the team's pause (a call within 3 days): both bells; both live lines say why", async () => {
    const w = await booked(30);
    const a = await admin();
    await pauseTest(a.user.id, w.testId, "Checking a report about this test.");
    expect(await bells(w.tester.user.id)).toContain(`Your call on “Harbor Run” on ${fmtIn("UTC", w.call.startsAt, "dayTime")} was cancelled because the test is paused.`);
    expect(await bells(w.dev.user.id)).toContain(`Your call with Ana Silva on “Harbor Run” on ${fmtIn("UTC", w.call.startsAt, "dayTime")} was cancelled because the test is paused.`);
    expect(await devLive(w, w.since)).toContain(`Your call with Ana Silva on ${when(w.call.startsAt)} was cancelled because the test is paused`);
    expect(await testerLive(w, w.since)).toContain(`Your call with Nora Lane on ${pageWhen(w.call.startsAt)} was cancelled because the test is paused`);
  });

  it("a block (the tester blocks the developer): the developer's neutral line names the call; their live line", async () => {
    const w = await booked();
    const me = await db.user.findUniqueOrThrow({ where: { id: w.tester.user.id } });
    await blockUser(me, w.dev.user.id);
    expect(await bells(w.dev.user.id)).toContain(`Ana Silva's session on Harbor Run ended; your call on ${when(w.call.startsAt)} was cancelled.`);
    expect(await devLive(w, w.since)).toContain(`Your call with Ana Silva on ${when(w.call.startsAt)} was cancelled`);
    expect((await bells(w.dev.user.id)).join(" ")).not.toMatch(/block/i);
  });

  it("the team's stop: the developer's line names the call; the tester's bell says why; neither live line is a stop reason by itself (batch 16 §24)", async () => {
    const w = await booked();
    const a = await admin();
    await adminStopTest(w.testId, "Closing this test.", a.user.id);
    expect(await bells(w.dev.user.id)).toContain(`The team stopped “Harbor Run”; your call with Ana Silva on ${when(w.call.startsAt)} was cancelled`);
    expect(await bells(w.tester.user.id)).toContain(`Your call on “Harbor Run” on ${fmtIn("UTC", w.call.startsAt, "dayTime")} was cancelled because the test was stopped.`);
    expect((await testerLive(w, w.since)).some((t) => t.startsWith("Your call with"))).toBe(false);
  });

  it("an outage: both bells; both live lines say the site was down", async () => {
    await db.outage.deleteMany({});
    const w = await booked(48);
    await db.call.update({ where: { id: w.call.id }, data: { startsAt: new Date(Date.now() - 20 * MIN) } });
    const at = (await db.call.findUniqueOrThrow({ where: { id: w.call.id } })).startsAt;
    try {
      await recordOutage(new Date(Date.now() - 30 * MIN), new Date(Date.now() - 5 * MIN));
      const line = `Your call on ${when(at)} was missed because the site was down. Nothing is charged; you can request a new time.`;
      expect(await bells(w.tester.user.id)).toContain(line);
      expect(await bells(w.dev.user.id)).toContain(line.replace("Your call", "Your call with Ana Silva"));
      expect(await devLive(w, w.since)).toContain(`Your call with Ana Silva on ${when(at)} was cancelled because the site was down`);
      expect(await testerLive(w, w.since)).toContain(`Your call with Nora Lane on ${pageWhen(at)} was cancelled because the site was down`);
    } finally {
      await db.outage.deleteMany({});
    }
  });

  it("nobody joined: both bells; both live lines", async () => {
    const w = await booked(48);
    await db.call.update({ where: { id: w.call.id }, data: { startsAt: new Date(Date.now() - 120 * MIN) } });
    const at = (await db.call.findUniqueOrThrow({ where: { id: w.call.id } })).startsAt;
    await sweepNobodyJoined(new Date());
    expect((await db.call.findUniqueOrThrow({ where: { id: w.call.id } })).status).toBe("cancelled");
    expect((await bells(w.tester.user.id)).some((t) => t.startsWith(`Your call on ${when(at)}`))).toBe(true);
    expect((await bells(w.dev.user.id)).some((t) => t.startsWith(`Your call with Ana Silva on ${when(at)}`))).toBe(true);
    expect(await devLive(w, w.since)).toContain(`Your call with Ana Silva on ${when(at)} was cancelled because nobody joined`);
    expect(await testerLive(w, w.since)).toContain(`Your call with Nora Lane on ${pageWhen(at)} was cancelled because nobody joined`);
  });
});
