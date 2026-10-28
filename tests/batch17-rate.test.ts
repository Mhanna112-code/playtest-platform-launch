import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";
import { devRateStates, ratingsToGive, testerRateState } from "@/lib/server/ratings";
import { windowEnd } from "@/lib/server/closeOut";
import { adminStopTest, pauseTest, suspendAccount } from "@/lib/server/restrictions";
import { closePausedTest } from "@/lib/server/pauseClosure";
import { decideDispute } from "@/lib/server/payments";
import { startHold } from "@/lib/server/holds";
import { fmtDate } from "@/lib/format";
import { CALL_CANCELLED_BY_STOP, LIMITED_CHOICE_REFUSAL, LIMITED_VIEW_LINE, RATE_CHARGE_FIRST, RATE_INACTIVE, RATE_MY_DISPUTE, reviewDateOf } from "@/lib/rules";

// (Owner, Oct 28) Batch 17 sections 1, 2, 10, 12, 14, 16, 17 and the rating half of 19.

const DAY = 86_400_000;
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const AT = /at \d{1,2}:\d{2}\W(AM|PM)\.$/;
async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  return db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
}
/** Ana sent her written answers; their review date passed and Charge / Let it go is offered. */
async function chargeOpen(testId: string, sessionId: string) {
  await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 60_000) } });
  await db.contract.update({ where: { id: sessionId }, data: { dueAt: new Date(Date.now() - 60_000) } });
  await db.submission.updateMany({ where: { contractId: sessionId }, data: { payBy: new Date(Date.now() - 60_000), choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
  return db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
}
async function sent() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}
/** Sent, paid, and rated by the tester: the developer's Rate is open (section 16). */
async function bothCanRate() {
  const x = await sent();
  expect((await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  expect((await sact(x.sessionId, "rate", x.tester.cookie, { stars: 4 })).status).toBe(200);
  return x;
}

describe("section 1: Rate is disabled while something is open, with one line (tester)", () => {
  it("review window, then Charge first, then the dispute; the server refuses with the same lines", async () => {
    const x = await sent();
    const c = await db.contract.findUniqueOrThrow({ where: { id: x.sessionId } });
    const date = fmtDate(reviewDateOf(x.sub.payBy!, c.dueAt));
    const s1 = await testerRateState(x.sessionId);
    expect(s1).toMatchObject({ kind: "disabled", line: `Rating opens on ${date}, or sooner if Nora Lane reviews everything you sent.` });
    expect((await sact(x.sessionId, "rate", x.tester.cookie, { stars: 5 })).body.error.message).toBe(s1.line);
    await chargeOpen(x.testId, x.sessionId);
    expect(await testerRateState(x.sessionId)).toMatchObject({ kind: "disabled", line: RATE_CHARGE_FIRST });
    expect((await sact(x.sessionId, "rate", x.tester.cookie, { stars: 5 })).body.error.message).toBe(RATE_CHARGE_FIRST);
    // The developer pays under the listing; the tester disputes: Rate waits for the team.
    expect((await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "4.00", tickedCents: 400, reason: "Short" })).status).toBe(200);
    expect((await sact(x.sessionId, "dispute", x.tester.cookie, { kind: "submission", id: x.sub.id, reason: "I answered all", confirmed: true })).status).toBe(200);
    expect(await testerRateState(x.sessionId)).toMatchObject({ kind: "disabled", line: RATE_MY_DISPUTE });
    expect((await sact(x.sessionId, "rate", x.tester.cookie, { stars: 5 })).body.error.message).toBe(RATE_MY_DISPUTE);
    // Decided while the page is open: Rate stops once for the decision (about their work), then goes.
    const pageAt = seen();
    await settle();
    const d = await db.dispute.findFirstOrThrow({ where: { contractId: x.sessionId } });
    await decideDispute(await admin(), d.id, { total: "" });
    const r = await sact(x.sessionId, "rate", x.tester.cookie, { stars: 5, seenAt: pageAt, pageSeenAt: pageAt });
    expect(r.body.error.code).toBe("stop_once");
    expect(r.body.error.changes[0].text).toMatch(/^The team decided your dispute/);
    await settle();
    expect((await sact(x.sessionId, "rate", x.tester.cookie, { stars: 5, seenAt: pageAt, pageSeenAt: pageAt, confirmed: true, boxAt: seen() })).status).toBe(200);
  });
});

describe("section 16: the developer rates only after the tester rated and everything is settled", () => {
  it("hidden (refused) until then; the 14 days and the bell start when the last piece settles; a dispute disables it, its decision stops once", async () => {
    const x = await sent();
    expect((await act(x.testId, "rate", x.dev.cookie, { contractId: x.sessionId, stars: 5 })).body.error.message).toBe("You can rate Ana Silva once they've rated you and everything they sent is settled.");
    // An unlisted part past its review date: the tester can rate, the developer still waits for it to be settled.
    await db.submission.update({ where: { id: x.sub.id }, data: { agreedCents: null } });
    await db.contract.update({ where: { id: x.sessionId }, data: { dueAt: new Date(Date.now() - 60_000) } });
    await db.submission.update({ where: { id: x.sub.id }, data: { payBy: new Date(Date.now() - 60_000) } });
    expect((await sact(x.sessionId, "rate", x.tester.cookie, { stars: 2 })).status).toBe(200);
    expect((await devRateStates([x.sessionId])).get(x.sessionId)).toMatchObject({ kind: "hidden", line: "You can rate Ana Silva once they've rated you and everything they sent is settled." });
    expect(await db.notification.count({ where: { userId: x.dev.user.id, text: { contains: "You can rate her for 14 days" } } })).toBe(0);
    expect((await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "4.00", tickedCents: 400, reason: "Short" })).status).toBe(200);
    const s = (await devRateStates([x.sessionId])).get(x.sessionId)!;
    expect(s.kind).toBe("open");
    expect(Math.round((s.endsAt!.getTime() - s.opensAt!.getTime()) / DAY)).toBe(14);
    expect(await db.notification.count({ where: { userId: x.dev.user.id, text: "Ana Silva finished Harbor Run. You can rate her for 14 days." } })).toBe(1);
    // A dispute opened after the tester rated: disabled with its line, refused with it.
    await sact(x.sessionId, "dispute", x.tester.cookie, { kind: "submission", id: x.sub.id, reason: "More please", confirmed: true });
    expect((await devRateStates([x.sessionId])).get(x.sessionId)).toMatchObject({ kind: "disabled", line: "Rating opens once the team decides Ana Silva's dispute." });
    expect((await act(x.testId, "rate", x.dev.cookie, { contractId: x.sessionId, stars: 5 })).body.error.message).toBe("Rating opens once the team decides Ana Silva's dispute.");
    const pageAt = seen();
    await settle();
    await decideDispute(await admin(), (await db.dispute.findFirstOrThrow({ where: { contractId: x.sessionId } })).id, { total: "" });
    const r = await act(x.testId, "rate", x.dev.cookie, { contractId: x.sessionId, stars: 5, seenAt: pageAt, pageSeenAt: pageAt });
    expect(r.body.error.code).toBe("stop_once");
    expect(r.body.error.changes[0].text).toMatch(/^The team decided Ana Silva's dispute/);
    await settle();
    expect((await act(x.testId, "rate", x.dev.cookie, { contractId: x.sessionId, stars: 5, seenAt: pageAt, pageSeenAt: pageAt, confirmed: true, boxAt: seen() })).status).toBe(200);
  });
});

describe("section 2: no rating during a suspension; the developer's window pauses", () => {
  it("the window pauses while the developer can't rate", () => {
    const opens = new Date("2026-11-01T00:00:00Z"), now = new Date("2026-12-01T00:00:00Z");
    expect(windowEnd(opens, [], now, 14).end.toISOString()).toBe("2026-11-15T00:00:00.000Z");
    // A 3-day hold inside the window moves its end by 3 days.
    const hold = { start: Date.parse("2026-11-05T00:00:00Z"), end: Date.parse("2026-11-08T00:00:00Z"), open: false };
    expect(windowEnd(opens, [hold], now, 14).end.toISOString()).toBe("2026-11-18T00:00:00.000Z");
    // One still on: paused, the end moves on day by day.
    const on = windowEnd(opens, [{ start: Date.parse("2026-11-05T00:00:00Z"), end: now.getTime(), open: true }], now, 14);
    expect(on.paused).toBe(true);
    expect(on.end.toISOString()).toBe("2026-12-11T00:00:00.000Z");
  });

  it("a held or suspended developer: Rate hidden and refused; their window pauses; the tester's Rate goes straight through", async () => {
    const x = await bothCanRate();
    await startHold(x.dev.user.id, "unpaid");
    const s = (await devRateStates([x.sessionId])).get(x.sessionId)!;
    expect(s).toMatchObject({ kind: "hidden", line: RATE_INACTIVE, paused: true });
    const r = await act(x.testId, "rate", x.dev.cookie, { contractId: x.sessionId, stars: 5 });
    expect(r.body.error).toMatchObject({ code: "inactive", message: RATE_INACTIVE });
    await db.user.update({ where: { id: x.dev.user.id }, data: { holdStartedAt: null } });
    await suspendAccount((await admin()).id, x.dev.user.id, "Checking", "developer");
    expect((await act(x.testId, "rate", x.dev.cookie, { contractId: x.sessionId, stars: 5 })).body.error.message).toBe(RATE_INACTIVE);
  });

  it("a suspended tester: Rate, Charge and Let it go refused; Dispute goes straight through; the limited view's line (section 10)", async () => {
    const x = await sent();
    const sub = await chargeOpen(x.testId, x.sessionId);
    expect(LIMITED_VIEW_LINE).toBe("Your account is paused. You can still dispute a payment.");
    await suspendAccount((await admin()).id, x.tester.user.id, "Checking", "tester");
    expect(await testerRateState(x.sessionId)).toMatchObject({ kind: "hidden", line: RATE_INACTIVE });
    expect((await sact(x.sessionId, "rate", x.tester.cookie, { stars: 5 })).body.error.message).toBe(RATE_INACTIVE);
    expect((await sact(x.sessionId, "choose", x.tester.cookie, { submissionId: sub.id, choice: "charge" })).body.error.message).toBe(LIMITED_CHOICE_REFUSAL);
    expect((await sact(x.sessionId, "choose", x.tester.cookie, { submissionId: sub.id, choice: "letgo" })).body.error.message).toBe(LIMITED_CHOICE_REFUSAL);
    // Nothing is lost: the piece is still open to Charge.
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
    // The developer pays under the listing; the dispute goes straight through from an old page.
    const old = seen();
    await settle();
    expect((await pay(x.dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Short" })).status).toBe(200);
    expect((await sact(x.sessionId, "dispute", x.tester.cookie, { kind: "submission", id: sub.id, reason: "I answered all", seenAt: old, pageSeenAt: old })).status).toBe(200);
    const page = await import("node:fs").then((fs) => fs.readFileSync("src/app/app/sessions/[id]/page.tsx", "utf8"));
    expect(page).toContain("const canChoose = !meOff;");
  });
});

describe("section 12: a stop while a page is open", () => {
  it("the developer's Stop: Charge stops once with it, the second press goes; Cancel call refused; Dispute and a page opened after go straight through", async () => {
    const x = await sent();
    const sub = await chargeOpen(x.testId, x.sessionId);
    const old = seen();
    await settle();
    expect((await act(x.testId, "stop", x.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const r = await sact(x.sessionId, "choose", x.tester.cookie, { submissionId: sub.id, choice: "letgo", seenAt: old, pageSeenAt: old });
    expect(r.body.error.code).toBe("stop_once");
    expect(r.body.error.changes.map((l: { text: string }) => l.text)).toEqual([expect.stringMatching(/^Nora Lane stopped this test at /)]);
    expect(r.body.error.changes[0].text).toMatch(AT);
    await settle();
    expect((await sact(x.sessionId, "choose", x.tester.cookie, { submissionId: sub.id, choice: "letgo", seenAt: old, pageSeenAt: old, confirmed: true, boxAt: seen() })).status).toBe(200);
    expect((await sact(x.sessionId, "cancel-call", x.tester.cookie, { callId: "x", seenAt: old })).body.error.message).toBe(CALL_CANCELLED_BY_STOP);
  });

  it("a page opened after the stop: Charge goes straight through", async () => {
    const x = await sent();
    const sub = await chargeOpen(x.testId, x.sessionId);
    expect((await act(x.testId, "stop", x.dev.cookie, { reason: "Done.", seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    expect((await sact(x.sessionId, "choose", x.tester.cookie, { submissionId: sub.id, choice: "letgo", seenAt: seen(), pageSeenAt: seen() })).status).toBe(200);
  });

  it("the team's Stop: testers read only 'This test was stopped at …'; the developer's Pay reads 'The team stopped this test at …'", async () => {
    const x = await sent();
    const sub = await chargeOpen(x.testId, x.sessionId);
    const old = seen();
    await settle();
    await adminStopTest(x.testId, "Against the rules", (await admin()).id);
    const t = await sact(x.sessionId, "choose", x.tester.cookie, { submissionId: sub.id, choice: "letgo", seenAt: old, pageSeenAt: old });
    expect(t.body.error.changes[0].text).toMatch(/^This test was stopped at /);
    expect(t.body.error.changes[0].text).not.toMatch(/team|rules/);
    const d = await pay(x.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: old, pageSeenAt: old, confirmed: false });
    expect(d.body.error.code).toBe("stop_once");
    expect(d.body.error.changes[0].text).toMatch(/^The team stopped this test at /);
    await settle();
    expect((await pay(x.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: old, pageSeenAt: old, confirmed: true, boxAt: seen() })).status).toBe(200);
  });

  it("the developer's own Stop on their Pay: 'You stopped this test at …'", async () => {
    const x = await sent();
    const old = seen();
    await settle();
    expect((await act(x.testId, "stop", x.dev.cookie, { reason: "Done.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const d = await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "10.00", tickedCents: 1000, seenAt: old, pageSeenAt: old, confirmed: false });
    expect(d.body.error.changes[0].text).toMatch(/^You stopped this test at /);
  });

  it("End early: the tester's Rate reads 'Nora Lane ended your work early at …'; the developer's Pay 'You ended Ana Silva's work early at …'", async () => {
    const x = await sent();
    const old = seen();
    await settle();
    expect((await act(x.testId, "end-early", x.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [x.sessionId], reason: "We have enough" })).status).toBe(200);
    const d = await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "10.00", tickedCents: 1000, seenAt: old, pageSeenAt: old, confirmed: false });
    expect(d.body.error.changes[0].text).toMatch(/^You ended Ana Silva's work early at /);
    await settle();
    expect((await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "10.00", tickedCents: 1000, seenAt: old, pageSeenAt: old, confirmed: true, boxAt: seen() })).status).toBe(200);
    const r = await sact(x.sessionId, "rate", x.tester.cookie, { stars: 5, seenAt: old, pageSeenAt: old });
    expect(r.body.error.changes.map((l: { text: string }) => l.text)).toEqual(expect.arrayContaining([expect.stringMatching(/^Nora Lane ended your work early at /)]));
  });

  it("the test closing: 'This test closed at …'", async () => {
    const x = await sent();
    const sub = await chargeOpen(x.testId, x.sessionId);
    const a = await admin();
    await pauseTest(a.id, x.testId, "Checking");
    const old = seen();
    await settle();
    await closePausedTest(x.testId, "admin", new Date(), a.id);
    const r = await sact(x.sessionId, "choose", x.tester.cookie, { submissionId: sub.id, choice: "letgo", seenAt: old, pageSeenAt: old });
    expect(r.body.error.changes[0].text).toMatch(/^This test closed at /);
  });
});

describe("section 14: Rate stops only for changes about that person", () => {
  it("a listing edit and another tester joining go straight through; a Pay on their work stops it once", async () => {
    const s = await setup({ recordingCents: "15.00" });
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    const old = seen();
    await settle();
    await act(s.testId, "edit", s.dev.cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: s.testId } })).version, fields: { description: "New words" }, seenAt: seen(), confirmed: true });
    await joined(s.testId, "Ben Carter", "he");
    expect((await sact(j.sessionId, "rate", j.tester.cookie, { stars: 5, seenAt: old, pageSeenAt: old })).status).toBe(200);
  });

  it("the developer's Pay on their work since the page loaded stops the tester's Rate once", async () => {
    const s = await setup({ recordingCents: "15.00" });
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const old = seen();
    await settle();
    await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    const r = await sact(j.sessionId, "rate", j.tester.cookie, { stars: 5, seenAt: old, pageSeenAt: old });
    expect(r.body.error.code).toBe("stop_once");
    expect(r.body.error.changes[0].text).toBe("Nora Lane paid $10.00 for your written answers");
  });

  it("a test the team paused: both sides rate, straight through", async () => {
    const x = await bothCanRate();
    await pauseTest((await admin()).id, x.testId, "Checking");
    expect((await act(x.testId, "rate", x.dev.cookie, { contractId: x.sessionId, stars: 5, seenAt: seen() })).status).toBe(200);
    const y = await sent();
    await pay(y.dev.cookie, { kind: "submission", id: y.sub.id, amount: "10.00", tickedCents: 1000 });
    await pauseTest((await admin()).id, y.testId, "Checking");
    expect((await sact(y.sessionId, "rate", y.tester.cookie, { stars: 5, seenAt: seen() })).status).toBe(200);
  });
});

describe("section 17: Ratings to give", () => {
  it("rows appear exactly when Rate is open, on both sides", async () => {
    const x = await sent();
    const t = () => db.user.findUniqueOrThrow({ where: { id: x.tester.user.id } });
    const d = () => db.user.findUniqueOrThrow({ where: { id: x.dev.user.id } });
    expect(await ratingsToGive(await t(), "tester")).toEqual([]);
    await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "10.00", tickedCents: 1000 });
    expect((await ratingsToGive(await t(), "tester")).map((r) => [r.text, r.href])).toEqual([["Rate Nora Lane on “Harbor Run”", `/app/sessions/${x.sessionId}#rate`]]);
    expect(await ratingsToGive(await d(), "developer")).toEqual([]);
    await sact(x.sessionId, "rate", x.tester.cookie, { stars: 4 });
    expect(await ratingsToGive(await t(), "tester")).toEqual([]);
    expect((await ratingsToGive(await d(), "developer")).map((r) => [r.text, r.href])).toEqual([["Rate Ana Silva on “Harbor Run” · 14 days left", `/app/tests/${x.testId}#rate-${x.sessionId}`]]);
    // A hold hides the developer's box.
    await db.user.update({ where: { id: x.dev.user.id }, data: { holdStartedAt: new Date() } });
    expect(await ratingsToGive(await d(), "developer")).toEqual([]);
  });
});

describe("section 19 (ratings): close-out", () => {
  it("testers can no longer rate; the developer can rate a tester who never rated, if everything was settled", async () => {
    const x = await sent();
    await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "10.00", tickedCents: 1000 });
    const past = new Date(Date.now() - 15 * DAY);
    await db.test.update({ where: { id: x.testId }, data: { openUntil: past } });
    await db.contract.update({ where: { id: x.sessionId }, data: { dueAt: past } });
    await db.outage.deleteMany({});
    const s = await testerRateState(x.sessionId);
    expect(s.kind).toBe("closed");
    expect(s.line).toMatch(/^Rating closed on .+\.$/);
    expect((await sact(x.sessionId, "rate", x.tester.cookie, { stars: 5 })).body.error.message).toBe(s.line);
    expect((await devRateStates([x.sessionId])).get(x.sessionId)!.kind).toBe("open");
    expect((await act(x.testId, "rate", x.dev.cookie, { contractId: x.sessionId, stars: 3 })).status).toBe(200);
  });

  it("anything left unpaid at close-out: no rating of that tester", async () => {
    const x = await sent();
    await db.submission.update({ where: { id: x.sub.id }, data: { agreedCents: null } });
    const past = new Date(Date.now() - 30 * DAY);
    await db.test.update({ where: { id: x.testId }, data: { openUntil: past } });
    await db.contract.update({ where: { id: x.sessionId }, data: { dueAt: past } });
    await db.submission.update({ where: { id: x.sub.id }, data: { payBy: past } });
    expect((await devRateStates([x.sessionId])).get(x.sessionId)!.kind).toBe("hidden");
  });
});
