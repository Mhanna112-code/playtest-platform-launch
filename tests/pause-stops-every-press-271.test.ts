import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { POST as joinPOST } from "@/app/api/calls/[id]/join/route";
import { ALERT_TYPES } from "@/lib/alerts";
import { lineId } from "@/lib/server/shownLines";
import { pauseTest, unpauseTest } from "@/lib/server/restrictions";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, atHours, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 5, §271) A pause since the page loaded (the team's, the developer's hold or suspension) or the team's lift of it stops EVERY press on the test once,
// both sides, whatever the Alerts; a press refused while paused gets only its refusal; the team's Decide dispute never stops for it; once a stop box on the page
// listed the line, no other button there stops for it again.

afterEach(() => setStripeForTests(null));
const later = () => new Promise((r) => setTimeout(r, 30));
/** The page's load time, clear of the writes before and after it. */
const loadedNow = async () => {
  await later();
  const t = seen();
  await later();
  return t;
};
type Res = { status: number; body: { error?: { code?: string; message?: string; now?: string; changes?: { text: string; sid?: string; forced?: boolean }[] } } };
const texts = (r: Res) => (r.body.error?.changes ?? []).map((c) => c.text);
const sids = (r: Res) => (r.body.error?.changes ?? []).map((c) => c.sid ?? "");
const again = (r: Res) => ({ confirmed: true, boxAt: r.body.error!.now });
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), ...body } })).then(json) as Promise<Res>;
const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json) as Promise<Res>;
async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
const alertsOff = (userId: string) => db.user.update({ where: { id: userId }, data: { testerAlertsOff: true } });
const allIgnored = (testId: string) => db.test.update({ where: { id: testId }, data: { ignoredAlerts: ALERT_TYPES.map((a) => a.key) } });
const suspendDev = (devId: string) => db.user.update({ where: { id: devId }, data: { devSuspendedAt: new Date() } });

/** Ana's written answers are open to her Charge (the review days and her deadline passed). */
async function chargeOpen() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "written" } });
  await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000), choiceOfferedAt: new Date() } });
  await db.test.update({ where: { id: s.testId }, data: { openUntil: new Date(Date.now() - 1000) } });
  await db.contract.updateMany({ where: { testId: s.testId }, data: { dueAt: new Date(Date.now() - 1000) } });
  await settle();
  return { ...s, ...j, sub };
}

describe("tester session actions after a pause or lift", () => {
  it("Let it go goes through on the first press during a team pause", async () => {
    const w = await chargeOpen();
    await alertsOff(w.tester.user.id);
    const loaded = await loadedNow();
    await pauseTest((await admin()).user.id, w.testId, "Checking reports");
    await later();
    const body = { submissionId: w.sub.id, choice: "letgo", seenAt: loaded };
    const first = (await sact(w.sessionId, "choose", w.tester.cookie, body)) as Res;
    expect(first.status, JSON.stringify(first.body)).toBe(200);
  });

  it("Send is refused while paused and goes through on the first press after the lift", async () => {
    const { testId } = await setup();
    const a = await joined(testId);
    await alertsOff(a.tester.user.id);
    const loaded = await loadedNow();
    await pauseTest((await admin()).user.id, testId, "Checking");
    await later();
    const body = { answers: ["The first level was fine.", "Nothing else."], seenAt: loaded };
    const refused = (await sact(a.sessionId, "written", a.tester.cookie, body)) as Res;
    expect(refused.body.error?.code, JSON.stringify(refused.body)).toBe("paused");
    await unpauseTest(testId);
    await later();
    const first = (await sact(a.sessionId, "written", a.tester.cookie, body)) as Res;
    expect(first.status, JSON.stringify(first.body)).toBe(200);
  });

  it("Cancel call goes through during a developer suspension while Request a time is refused", async () => {
    const s = await setup();
    const a = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, a.sessionId, a.tester.cookie, 72);
    await alertsOff(a.tester.user.id);
    const loaded = await loadedNow();
    await suspendDev(s.dev.user.id);
    await later();
    // Refused while paused: the refusal alone tells her.
    const asked = (await sact(a.sessionId, "request-time", a.tester.cookie, { times: [atHours(96)], seenAt: loaded })) as Res;
    expect(asked.body.error?.code, JSON.stringify(asked.body)).toBe("paused");
    const body = { callId: call.id, reason: "Something came up.", seenAt: loaded };
    const first = (await sact(a.sessionId, "cancel-call", a.tester.cookie, body)) as Res;
    expect(first.status, JSON.stringify(first.body)).toBe(200);
  });

  it("Let it go goes through from a page drawn before the lift", async () => {
    const w = await chargeOpen();
    await alertsOff(w.tester.user.id);
    await pauseTest((await admin()).user.id, w.testId, "Checking");
    const loaded = await loadedNow();
    await unpauseTest(w.testId);
    await later();
    const body = { submissionId: w.sub.id, choice: "letgo", seenAt: loaded };
    const first = (await sact(w.sessionId, "choose", w.tester.cookie, body)) as Res;
    expect(first.status, JSON.stringify(first.body)).toBe(200);
  });

  it("a message sends after the lift and Join call still checks its own rules", async () => {
    const s = await setup();
    const a = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, a.sessionId, a.tester.cookie, 72);
    await pauseTest((await admin()).user.id, s.testId, "Checking");
    const loaded = await loadedNow();
    await unpauseTest(s.testId);
    await later();
    const msg = (await sact(a.sessionId, "message", a.tester.cookie, { body: "Hello", clientId: randomUUID(), seenAt: loaded })) as Res;
    expect(msg.status, JSON.stringify(msg.body)).toBe(200);
    // Join call: the call isn't due yet, so it's refused as before (the refusal alone); the stop is checked after the refusals.
    const j = (await joinPOST(req(`/api/calls/${call.id}/join`, { cookie: a.tester.cookie, body: { seenAt: loaded } }), { params: Promise.resolve({ id: call.id }) }).then(json)) as Res;
    expect(j.body.error?.code, JSON.stringify(j.body)).not.toBe("stop_once");
  });
});

describe("§271 developer side: their own words, whatever the Alerts ticks", () => {
  /** A test where Ana sent written answers (not paid yet), every Alerts type ticked off. */
  async function sent() {
    const s = await setup();
    const a = await joined(s.testId);
    await sact(a.sessionId, "written", a.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: a.sessionId } });
    await allIgnored(s.testId);
    await settle();
    return { ...s, a, sub };
  }

  it("Pay: the team's pause and its lift since the page loaded stop it once (named in the developer's words); the second press goes ahead", async () => {
    const w = await sent();
    const loaded = await loadedNow();
    await pauseTest((await admin()).user.id, w.testId, "Checking");
    await later();
    await unpauseTest(w.testId);
    await later();
    const body = { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "Half of it", seenAt: loaded };
    const first = await pay(w.dev.cookie, body);
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(texts(first)).toEqual([expect.stringMatching(/^The team paused this test at .+\.$/), expect.stringMatching(/^The team lifted its pause on this test at .+\.$/)]);
    expect((await pay(w.dev.cookie, { ...body, ...again(first) })).status).toBe(200);
  });

  it("Edit Save: a pause and lift since Edit opened stop it once with the timed lines (not the raw records); the second Save saves", async () => {
    const { dev, testId } = await setup();
    await joined(testId);
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const loaded = await loadedNow();
    await pauseTest((await admin()).user.id, testId, "Checking");
    await later();
    await unpauseTest(testId);
    await later();
    const body = { version: t.version, fields: { description: "A new description of the test." }, payRulesOk: true, seenAt: loaded };
    const first = (await act(testId, "edit", dev.cookie, body)) as Res;
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("changed");
    expect(texts(first)).toEqual([expect.stringMatching(/^The team paused this test at .+\.$/), expect.stringMatching(/^The team lifted its pause on this test at .+\.$/)]);
    const second = (await act(testId, "edit", dev.cookie, { ...body, ...again(first) })) as Res;
    expect(second.status, JSON.stringify(second.body)).toBe(200);
  });

  it("Add your side (exempt from stops) stops once for their suspension since the page loaded", async () => {
    const w = await sent();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "1.00", tickedCents: 100, reason: "Partly done only", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await sact(w.a.sessionId, "dispute", w.a.tester.cookie, { kind: "submission", id: w.sub.id, reason: "I answered everything in full.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: w.sub.id } });
    const loaded = await loadedNow();
    await suspendDev(w.dev.user.id);
    await later();
    const first = (await act(w.testId, "dispute-side", w.dev.cookie, { disputeId: d.id, text: "They skipped one.", seenAt: loaded })) as Res;
    expect(texts(first), JSON.stringify(first.body)).toEqual([expect.stringMatching(/^Your developer account was suspended at /)]);
    expect((await act(w.testId, "dispute-side", w.dev.cookie, { disputeId: d.id, text: "They skipped one.", seenAt: loaded, ...again(first) })).status).toBe(200);
  });
});

describe("§271 the team's Decide dispute never stops for a pause or hold", () => {
  it("a dispute decided on a page opened before the developer's suspension and the team's pause goes through at once", async () => {
    const s = await setup();
    const a = await joined(s.testId);
    await sact(a.sessionId, "written", a.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: a.sessionId } });
    expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "1.00", tickedCents: 100, reason: "Partly done only", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await sact(a.sessionId, "dispute", a.tester.cookie, { kind: "submission", id: sub.id, reason: "I answered everything in full.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    const team = await admin();
    const loaded = await loadedNow();
    await pauseTest(team.user.id, s.testId, "Checking");
    await suspendDev(s.dev.user.id);
    await later();
    const r = await aact(team.cookie, "decide", { id: d.id, total: "", note: "", seenAt: loaded });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});

describe("§271 shown once per page, across buttons (§250's shownIds)", () => {
  it("tester: Leave needs no retry after a developer suspension", async () => {
    const s = await setup();
    const a = await joined(s.testId);
    const loaded = await loadedNow();
    await suspendDev(s.dev.user.id);
    await later();
    const left = (await sact(a.sessionId, "leave", a.tester.cookie, { seenAt: loaded })) as Res;
    expect(left.status, JSON.stringify(left.body)).toBe(200);
  });

  it("developer: End early's box listed the pause and lift; Pay on the same page then goes ahead at once", async () => {
    const s = await setup({ spots: 5 });
    const a = await joined(s.testId);
    const b = await joined(s.testId, "Ben Okafor", "he");
    await sact(a.sessionId, "written", a.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: a.sessionId } });
    const loaded = await loadedNow();
    await pauseTest((await admin()).user.id, s.testId, "Checking");
    await later();
    await unpauseTest(s.testId);
    await later();
    const box = (await act(s.testId, "end-early", s.dev.cookie, { contractIds: [b.sessionId], reason: "We have enough.", seenAt: loaded })) as Res;
    expect(box.body.error?.code, JSON.stringify(box.body)).toBe("stop_once");
    expect(texts(box)).toEqual([expect.stringMatching(/^The team paused this test at /), expect.stringMatching(/^The team lifted its pause on this test at /)]);
    expect(sids(box).every((x) => x.length > 0)).toBe(true);
    const r = await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "5.00", tickedCents: 500, reason: "Half of it", seenAt: loaded, shownIds: sids(box) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it("a line's identity is stable for the same moment (the page's shownIds match on the next press)", () => {
    const at = new Date("2026-11-05T09:08:55Z");
    expect(lineId({ kind: "stop", text: "This test was paused at 3:08 AM.", createdAt: at })).toBe(lineId({ kind: "stop", text: "This test was paused at 3:08 AM.", createdAt: new Date(at) }));
  });
});
