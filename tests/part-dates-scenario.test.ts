import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { chargeOpensAt, closeOutBase, pieceDueAt } from "@/lib/rules";
import { callChargeAt, closedOut, moneySpans, pieceCloseOut, testerRatingClosesAt, windowEnd } from "@/lib/server/closeOut";
import { finishMeasuring } from "@/lib/server/calls";
import { liftHoldIfClear, runDaily, runSweep, startHold } from "@/lib/server/holds";
import { recordOutage } from "@/lib/server/outages";
import { adminClosePaused } from "@/lib/server/pauseClosure";
import { adminStopTest, pauseTest, reinstateAccount, suspendAccount, unpauseTest } from "@/lib/server/restrictions";
import { createSession, SESSION_COOKIE } from "@/lib/server/session";
import { json, makeUser, req } from "./helpers";
import { act, addTo, bookCall, joined, sact, seen, setup } from "./fixtures";

/*
 * Part dates, step by step (owner's review scenario). A realistic timeline driven through the real server code on a fake clock (only Date is faked), recording
 * after every step every date in each part's life. Expected values: the owner's (worked out by hand) and, where the owner gave none, the agent's own
 * ("agent"). Mismatches are collected with expect.soft so one run shows them all. Nothing in src/ is changed by this file.
 *
 * Developer time zone: none saved (UTC). The code's end of day is 23:59:59.000 UTC (rules.ts endOfDayIn), written E("YYYY-MM-DD") below.
 *
 * Fake-clock notes (see SHORTCUTS): Prisma's @default(now()) is filled by the query engine with the REAL clock, so rows the code creates without an explicit
 * time (Test.createdAt, TestEvent.createdAt …) carry the machine's time, not the scenario's. Only the ones the date math reads are put back on the scenario clock.
 */

/** Where the date snapshots are written for the owner's step-by-step page: only when PART_DATES_OUT names a file (the checks run either way). */
const OUT = process.env.PART_DATES_OUT || "";
const E = (day: string) => `${day}T23:59:59.000Z`; // end of a day (UTC)
const T = (t: string) => new Date(`${t}${t.length === 16 ? ":00" : ""}Z`).toISOString(); // "2030-12-10T12:00" → ISO
const at = (t: string) => vi.setSystemTime(new Date(T(t)));
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const SET = "(set)"; // expected: any non-null value

type Val = string | number | boolean | null;
/** An expected value, optionally with a note on where it comes from (e.g. an owner decision that changed it). */
type Exp = Record<string, Val | { v: Val; note: string }>;
/** (Owner, decision 3, Dec 9 2026) Dispute closes with Charge: the dispute date is the piece's one closing date. */
const D3 = (v: Val) => ({ v, note: "decision Dec 9: dispute = charge" });
type Press = { who: string; button: string; part: string | null; httpStatus: number | null; code: string | null; message: string | null };
type Person = { user: { id: string }; cookie: string; sessionId: string };
type World = { scenario: string; testId: string; dev: { user: { id: string }; cookie: string }; admin: { user: { id: string }; cookie: string }; people: Record<string, Person>; parts: Record<string, { id: string; owner: string; kind: string; sentAt: string }> };

const SNAPSHOTS: unknown[] = [];
const SHORTCUTS: { scenario: string; step: string; what: string; why: string }[] = [];
const MISMATCHES: { scenario: string; step: string; what: string; source: string; expected: unknown; actual: unknown }[] = [];

function writeOut() {
  if (!OUT) return;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), endOfDay: "23:59:59.000 UTC (rules.ts endOfDayIn, developer zone unset = UTC)", keyFormat: "expected/checks keys: test.<field>, developer.<field>, <Tester>.<field>, <Tester>/<kind>.<field>, press.<n>.<field>", shortcuts: SHORTCUTS, mismatches: MISMATCHES, snapshots: SNAPSHOTS }, null, 2));
}
afterEach(() => vi.useRealTimers());
/** The outages this file records: site-wide rows, deleted when the file ends so no other test file (on the real clock) meets them. */
const OUTAGES: string[] = [];
async function outage(start: Date, end: Date) {
  const o = await recordOutage(start, end);
  if (o) OUTAGES.push(o.id);
  return o;
}
afterAll(async () => {
  writeOut();
  await db.outage.deleteMany({ where: { id: { in: OUTAGES } } });
});

function shortcut(w: World, step: string, what: string, why: string) {
  SHORTCUTS.push({ scenario: w.scenario, step, what, why });
}

/** Sign in again on the scenario clock (sessions last 30 days from when they were made). */
async function relogin(p: { user: { id: string }; cookie: string }) {
  const { token } = await createSession(p.user.id);
  p.cookie = `${SESSION_COOKIE}=${token}`;
}

/** The team's pause / lift line's event carries the engine's real clock; put it on the scenario clock (teamPauseSpans reads it). */
async function fixTeamEvent(w: World, step: string, kind: "paused" | "resumed") {
  const text = kind === "paused" ? "The team paused this test" : "The team lifted the pause on this test";
  const ev = await db.testEvent.findFirst({ where: { testId: w.testId, kind, text }, orderBy: { createdAt: "desc" } });
  if (!ev) return;
  await db.testEvent.update({ where: { id: ev.id }, data: { createdAt: new Date() } });
  shortcut(w, step, `TestEvent "${text}".createdAt set to the scenario time ${new Date().toISOString()}`, "Prisma's @default(now()) uses the real clock, not the faked Date; closeOut.teamPauseSpans reads these events for closed team-pause spans");
}

async function newWorld(scenario: string, made: string, openUntil: string, over: Record<string, unknown> = {}): Promise<World> {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(made);
  const s = await setup({ openUntil, recordingCents: "15.00", ...over });
  const admin = await makeUser({ name: "Team Admin", email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: admin.user.id }, data: { isAdmin: true } });
  const w: World = { scenario, testId: s.testId, dev: s.dev, admin, people: {}, parts: {} };
  await db.test.update({ where: { id: s.testId }, data: { createdAt: new Date() } });
  shortcut(w, "0", `Test.createdAt set to ${new Date().toISOString()}`, "the test is made through POST /api/tests on the fake clock, but createdAt is filled by Prisma's engine with the real clock");
  return w;
}

async function join(w: World, name: string, pronoun = "she") {
  const j = await joined(w.testId, name, pronoun);
  w.people[name] = { user: j.tester.user, cookie: j.tester.cookie, sessionId: j.sessionId };
}

const flat = (snap: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  const t = snap.test as Record<string, unknown>;
  for (const [k, v] of Object.entries(t)) out[`test.${k}`] = v;
  for (const [k, v] of Object.entries(snap.developer as Record<string, unknown>)) out[`developer.${k}`] = v;
  for (const s of snap.sessions as Record<string, unknown>[]) for (const [k, v] of Object.entries(s)) out[`${s.tester}.${k}`] = v;
  for (const p of snap.parts as Record<string, unknown>[]) for (const [k, v] of Object.entries(p)) out[`${p.owner}/${p.kind}.${k}`] = v;
  (snap.presses as Press[]).forEach((p, i) => { for (const [k, v] of Object.entries(p)) out[`press.${i}.${k}`] = v; });
  return out;
};

/** One snapshot: every date of the test, its sessions and its parts, now; the expected values beside them. */
async function snap(w: World, step: string, label: string, expected: Exp = {}, agent: Exp = {}, presses: Press[] = [], extra: Record<string, unknown> = {}) {
  const now = new Date();
  const t = await db.test.findUniqueOrThrow({ where: { id: w.testId }, include: { developer: true, contracts: { select: { id: true, status: true, dueAt: true, endedAt: true } } } });
  const sessions = [];
  for (const [name, p] of Object.entries(w.people)) {
    const c = await db.contract.findUniqueOrThrow({ where: { id: p.sessionId }, include: { tester: true } });
    const left = c.endedAt && c.status === "left" ? c.dueAt.getTime() - c.endedAt.getTime() : null;
    const dhms = (ms: number) => `${Math.floor(ms / 86_400_000)}d ${Math.floor((ms % 86_400_000) / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
    sessions.push({ tester: name, status: c.status, endKind: c.endKind, dueAt: iso(c.dueAt), endedAt: iso(c.endedAt), timeLeftAtLeave: left == null ? null : dhms(left), testerSuspendedAt: iso(c.tester.testerSuspendedAt), rateCloses: iso(await testerRatingClosesAt(c.id, now)) });
  }
  const parts = [];
  for (const p of Object.values(w.parts)) {
    const s = await db.submission.findUniqueOrThrow({ where: { id: p.id } });
    const c = await db.contract.findUniqueOrThrow({ where: { id: s.contractId } });
    const money = await pieceCloseOut({ submissionId: s.id }, now);
    const dispute = await pieceCloseOut({ submissionId: s.id }, now); // (decision 3, Dec 9 2026) the one closing date; recorded under both names
    parts.push({ id: s.id, owner: p.owner, kind: p.kind, sentAt: p.sentAt, updatedAt: iso(s.updatedAt), late: s.late, payBy: iso(s.payBy), stintDueAt: iso(s.stintDueAt), deadlineThatCounts: iso(pieceDueAt(s, c)), chargeOpens: iso(chargeOpensAt(s, t, c, now)), choiceOfferedAt: iso(s.choiceOfferedAt), choiceBy: iso(s.choiceBy), moneyCloses: iso(money), disputeCloses: iso(dispute), moneyClosedOut: closedOut(money, now), disputeClosedOut: closedOut(dispute, now) });
  }
  const snapshot: Record<string, unknown> = {
    scenario: w.scenario, step, label, now: now.toISOString(),
    test: { status: t.status, openUntil: iso(t.openUntil), testerDays: t.testerDays, workEndedAt: iso(t.workEndedAt), adminPausedAt: iso(t.adminPausedAt), pausedSince: iso(t.pausedSince), stoppedAt: iso(t.stoppedAt), base: iso(closeOutBase(t, t.contracts, now)) }, // (Owner, Dec 10 2026) no test-wide close-out any more (closeOutOf is gone): see each <Tester>.rateCloses
    developer: { holdStartedAt: iso(t.developer.holdStartedAt), devSuspendedAt: iso(t.developer.devSuspendedAt) },
    sessions, parts, expected, expectedAgent: agent, presses, extra,
  };
  const actual = flat(snapshot);
  for (const [k, v] of Object.entries(extra)) actual[`extra.${k}`] = v;
  const checks = [];
  for (const [source, exp] of [["owner", expected], ["agent", agent]] as const) {
    for (const [what, raw] of Object.entries(exp)) {
      const note = raw && typeof raw === "object" ? raw.note : undefined;
      const e = raw && typeof raw === "object" ? raw.v : raw;
      const a = actual[what];
      const pass = e === SET ? a != null : typeof e === "string" && e.startsWith("~") ? typeof a === "string" && a.includes(e.slice(1)) : a === e;
      checks.push({ what, source, ...(note ? { note } : {}), expected: e, actual: a ?? null, pass });
      if (!pass) MISMATCHES.push({ scenario: w.scenario, step, what, source, expected: e, actual: a ?? null });
      expect.soft(pass, `[${w.scenario} step ${step}] ${what} (${source}): expected ${JSON.stringify(e)}, got ${JSON.stringify(a ?? null)}`).toBe(true);
    }
  }
  snapshot.checks = checks;
  SNAPSHOTS.push(snapshot);
  writeOut();
  return snapshot;
}

/** A press through the real route; its outcome recorded. */
async function press(who: string, button: string, part: string | null, fn: () => Promise<{ status: number; body: Record<string, unknown> }>): Promise<Press & { body: Record<string, unknown> }> {
  const r = await fn();
  const err = (r.body?.error ?? null) as { code?: string; message?: string } | null;
  return { who, button, part, httpStatus: r.status, code: err?.code ?? null, message: err?.message ?? null, body: r.body };
}
const strip = (p: Press & { body?: unknown }): Press => ({ who: p.who, button: p.button, part: p.part, httpStatus: p.httpStatus, code: p.code, message: p.message });
/** A flow that must go through (a 200): a mismatch otherwise, and the press recorded. */
async function flow(w: World, step: string, who: string, button: string, part: string | null, fn: () => Promise<{ status: number; body: Record<string, unknown> }>) {
  const p = await press(who, button, part, fn);
  if (p.httpStatus !== 200) MISMATCHES.push({ scenario: w.scenario, step, what: `flow ${who} ${button}`, source: "flow", expected: 200, actual: `${p.httpStatus} ${p.code}: ${p.message}` });
  expect.soft(p.httpStatus, `[${w.scenario} step ${step}] ${who} ${button}: ${p.code} ${p.message}`).toBe(200);
  return p;
}

const sendWritten = async (w: World, step: string, name: string) => {
  const p = w.people[name];
  const r = await flow(w, step, name, "Send Answers", `${name}/written`, () => sact(p.sessionId, "written", p.cookie, { answers: ["The harbour level was clear and the boats handled well.", "Nowhere, it was smooth."], seenAt: seen(), confirmed: true }));
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: p.sessionId, kind: "written" } });
  w.parts[`${name}/written`] = { id: sub.id, owner: name, kind: "written", sentAt: new Date().toISOString() };
  return r;
};
const sendRecording = async (w: World, step: string, name: string) => {
  const p = w.people[name];
  const up = await flow(w, step, name, "Upload recording (start)", `${name}/recording`, () => sact(p.sessionId, "recording-start", p.cookie, { size: 1000, contentType: "video/mp4", filename: "run.mp4" }));
  await flow(w, step, name, "Upload recording (done)", `${name}/recording`, () => sact(p.sessionId, "recording-done", p.cookie, { recordingId: up.body.recordingId }));
  const r = await flow(w, step, name, "Send recording", `${name}/recording`, () => sact(p.sessionId, "recording-send", p.cookie, { seenAt: seen(), confirmed: true }));
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: p.sessionId, kind: "recording" } });
  w.parts[`${name}/recording`] = { id: sub.id, owner: name, kind: "recording", sentAt: new Date().toISOString() };
  return r;
};
const leave = (w: World, step: string, name: string) => flow(w, step, name, "Leave", null, () => sact(w.people[name].sessionId, "leave", w.people[name].cookie, { seenAt: seen(), confirmed: true }));
/** Ask to rejoin (the tester) → Accept (the developer): the real rejoin path. */
async function rejoin(w: World, step: string, name: string) {
  const p = w.people[name];
  const lv = (await db.test.findUniqueOrThrow({ where: { id: w.testId } })).listingVersion;
  const ask = await flow(w, step, name, "Ask to rejoin", null, () => act(w.testId, "rejoin-ask", p.cookie, { listingVersion: lv, seenAt: seen(), confirmed: true, anyway: true }));
  const app = await db.application.findFirstOrThrow({ where: { testId: w.testId, testerId: p.user.id, status: "pending" }, orderBy: { createdAt: "desc" } });
  const accept = await flow(w, step, "developer", "Accept (rejoin ask)", null, () => act(w.testId, "application", w.dev.cookie, { applicationId: app.id, action: "accept", seenAt: seen(), confirmed: true }));
  return [strip(ask), strip(accept)];
}
const teamPause = async (w: World, step: string) => {
  await pauseTest(w.admin.user.id, w.testId, "Checking a report about this test.");
  await fixTeamEvent(w, step, "paused");
};
const teamLift = async (w: World, step: string) => {
  await unpauseTest(w.testId, w.admin.user.id);
  await fixTeamEvent(w, step, "resumed");
};
const daily = async () => {
  const r = await runDaily(new Date(), { waitMs: 20_000 });
  expect(r, "the daily job ran").not.toBeNull();
};

// ====================================================================================================================================================

describe("part dates, step by step", () => {
  it("main scenario: Ben (left and rejoined) and Cara, through an Open until move, an addition, a team pause, two outages, a hold and a tester suspension", async () => {
    const w = await newWorld("main", "2030-12-01T09:00", "2030-12-11");
    await snap(w, "0", "Dec 1: test made with Open until Dec 11", { "test.openUntil": E("2030-12-11"), "test.testerDays": 10 }, { "test.status": "open", "test.base": null });

    // 1. Ben joins.
    at("2030-12-02T10:00");
    await join(w, "Ben", "he");
    await snap(w, "1", "Dec 2: Ben joins", { "Ben.dueAt": E("2030-12-12") });

    // 2. Ben sends written answers, then a recording.
    at("2030-12-03T12:00");
    const sw = await sendWritten(w, "2a", "Ben");
    await snap(w, "2a", "Dec 3 12:00: Ben sends written answers", { "Ben/written.payBy": T("2030-12-10T12:00") }, { "Ben/written.chargeOpens": E("2030-12-12"), "Ben/written.stintDueAt": null }, [strip(sw)]);
    at("2030-12-04T12:00");
    const sr = await sendRecording(w, "2b", "Ben");
    await snap(w, "2b", "Dec 4 12:00: Ben sends a recording", { "Ben/recording.payBy": T("2030-12-11T12:00") }, { "Ben/recording.chargeOpens": E("2030-12-12") }, [strip(sr)]);

    // 3. Ben leaves.
    at("2030-12-05T12:00");
    const lv = await leave(w, "3", "Ben");
    await snap(w, "3", "Dec 5 12:00: Ben leaves (7d 11h 59m left)", { "Ben.dueAt": E("2030-12-12") }, { "Ben.status": "left", "Ben.timeLeftAtLeave": "7d 11h 59m 59s" }, [strip(lv)]);

    // 4. Ben rejoins (ask → developer's Accept).
    at("2030-12-08T12:00");
    const rj = await rejoin(w, "4", "Ben");
    await snap(w, "4", "Dec 8 12:00: Ben rejoins", {
      "Ben.dueAt": E("2030-12-15"), "Ben/written.stintDueAt": E("2030-12-12"), "Ben/recording.stintDueAt": E("2030-12-12"), "Ben/written.chargeOpens": E("2030-12-12"), "Ben/recording.chargeOpens": E("2030-12-12"),
    }, { "Ben.status": "working" }, rj);

    // 5. The developer moves Open until 3 days later (Edit → Save).
    at("2030-12-09T12:00");
    const v = (await db.test.findUniqueOrThrow({ where: { id: w.testId } })).version;
    const ed = await flow(w, "5", "developer", "Save (Open until Dec 14)", null, () => act(w.testId, "edit", w.dev.cookie, { version: v, fields: { openUntil: "2030-12-14" }, seenAt: seen(), confirmed: true }));
    await snap(w, "5", "Dec 9: developer moves Open until to Dec 14", { "test.openUntil": E("2030-12-14"), "Ben.dueAt": E("2030-12-18"), "Ben/written.stintDueAt": E("2030-12-12"), "Ben/recording.stintDueAt": E("2030-12-12"), "test.testerDays": 13 }, {}, [strip(ed)]);

    // 6. Ben adds to his written answers.
    at("2030-12-10T12:00");
    const ad = await flow(w, "6", "Ben", "Add to this answer", "Ben/written", () => addTo(w.people.Ben.sessionId, w.people.Ben.cookie, { text: "One more thing: the second harbour's buoys were hard to see at night.", seenAt: seen(), confirmed: true }));
    await snap(w, "6", "Dec 10 12:00: Ben adds to his written part", {
      "Ben/written.payBy": T("2030-12-17T12:00"), "Ben/written.stintDueAt": null, "Ben/written.chargeOpens": E("2030-12-18"),
      "Ben/recording.payBy": T("2030-12-11T12:00"), "Ben/recording.stintDueAt": E("2030-12-12"), "Ben/recording.chargeOpens": E("2030-12-12"),
    }, {}, [strip(ad)]);

    // 7. The team pauses the test Dec 11 08:00 and lifts it Dec 13 08:00.
    at("2030-12-11T08:00");
    await teamPause(w, "7a");
    await snap(w, "7a", "Dec 11 08:00: the team pauses the test", {}, { "test.adminPausedAt": T("2030-12-11T08:00"), "test.pausedSince": T("2030-12-11T08:00"), "test.openUntil": E("2030-12-14"), "Ben.dueAt": E("2030-12-18") });
    at("2030-12-12T12:00");
    await snap(w, "7b", "Dec 12 12:00: during the pause (nothing moved yet)", {
      "test.openUntil": E("2030-12-14"), "Ben.dueAt": E("2030-12-18"), "Ben/written.payBy": T("2030-12-17T12:00"), "Ben/recording.payBy": T("2030-12-11T12:00"), "Ben/recording.stintDueAt": E("2030-12-12"),
    });
    at("2030-12-13T08:00");
    await teamLift(w, "7c");
    await snap(w, "7c", "Dec 13 08:00: the team lifts the pause (2 days)", {
      "test.openUntil": E("2030-12-16"), "Ben.dueAt": E("2030-12-20"), "Ben/recording.stintDueAt": E("2030-12-14"), "Ben/written.payBy": T("2030-12-19T12:00"), "Ben/recording.payBy": T("2030-12-13T12:00"),
      "Ben/written.chargeOpens": E("2030-12-20"), "Ben/recording.chargeOpens": E("2030-12-14"),
    }, { "test.adminPausedAt": null, "test.pausedSince": null, "Ben/written.stintDueAt": null });
    at("2030-12-14T12:00");
    await relogin(w.people.Ben);
    shortcut(w, "7d", "fresh sign-in session (createSession) for Ben on the scenario clock", "sessions last 30 days from when they were made");
    const ch1 = await press("Ben", "Charge", "Ben/recording", () => sact(w.people.Ben.sessionId, "choose", w.people.Ben.cookie, { submissionId: w.parts["Ben/recording"].id, choice: "charge", amount: "15.00", seenAt: seen(), confirmed: true }));
    await snap(w, "7d", "Dec 14 12:00: Ben presses Charge on the recording (not open yet)", { "press.0.code": "not_yet" }, { "press.0.httpStatus": 409, "Ben/recording.choiceOfferedAt": null }, [strip(ch1)]);
    at("2030-12-15T00:30");
    await daily();
    await snap(w, "7e", "Dec 15 00:30: the daily job (after Dec 14 11:59 PM)", { "Ben/recording.choiceOfferedAt": SET }, { "Ben/written.choiceOfferedAt": null });

    // 8. Cara joins.
    at("2030-12-15T10:00");
    await join(w, "Cara", "she");
    await snap(w, "8", "Dec 15: Cara joins (13 tester days)", { "Cara.dueAt": E("2030-12-28") }, { "test.testerDays": 13 });

    // 9. Outage Dec 16 10:00 → Dec 17 10:00, recorded through the real outage path.
    at("2030-12-17T10:05");
    await outage(new Date(T("2030-12-16T10:00")), new Date(T("2030-12-17T10:00")));
    await snap(w, "9", "Dec 17: outage Dec 16 10:00 → Dec 17 10:00 recorded", {
      "Ben.dueAt": E("2030-12-21"), "Cara.dueAt": E("2030-12-29"), "test.openUntil": E("2030-12-17"), "Ben/written.payBy": T("2030-12-20T12:00"),
      "Ben/recording.stintDueAt": E("2030-12-14"), "Ben/recording.payBy": T("2030-12-13T12:00"), "Ben/written.chargeOpens": E("2030-12-21"),
    });
    at("2030-12-22T00:30");
    await daily();
    await snap(w, "9b", "Dec 22 00:30: the daily job (Ben's written Charge opens)", {}, { "Ben/written.choiceOfferedAt": SET });

    // 10. Cara sends written answers.
    at("2030-12-28T12:00");
    await relogin(w.people.Cara);
    shortcut(w, "10", "fresh sign-in session (createSession) for Cara on the scenario clock", "sessions last 30 days from when they were made");
    const cw = await sendWritten(w, "10", "Cara");
    await snap(w, "10", "Dec 28 12:00: Cara sends written answers", { "Cara/written.payBy": T("2031-01-04T12:00") }, { "Cara/written.chargeOpens": T("2031-01-04T12:00") }, [strip(cw)]);

    // 11. The work ends at Dec 29 11:59 PM: the daily job writes workEndedAt.
    at("2030-12-30T00:30");
    await daily();
    await snap(w, "11", "Dec 30 00:30: the daily job closes the work", { "test.workEndedAt": E("2030-12-29"), "test.base": E("2030-12-29") }, {
      "test.status": "closed", "Ben.status": "ended", "Cara.status": "ended",
      "Ben/written.moneyCloses": E("2031-01-12"), "Ben/recording.moneyCloses": E("2031-01-12"), "Cara/written.moneyCloses": T("2031-01-18T12:00"),
      "Ben/written.disputeCloses": E("2031-01-12"), "Ben/recording.disputeCloses": E("2031-01-12"), "Cara/written.disputeCloses": T("2031-01-18T12:00"),
    });

    // 12. Outage Jan 2 10:00 → Jan 3 10:00 (after the close).
    at("2031-01-03T10:05");
    await outage(new Date(T("2031-01-02T10:00")), new Date(T("2031-01-03T10:00")));
    await snap(w, "12", "Jan 3: outage Jan 2 10:00 → Jan 3 10:00 recorded (after the close)", {
      "Cara/written.payBy": T("2031-01-05T12:00"), "Ben/written.payBy": T("2030-12-20T12:00"), "Ben/recording.payBy": T("2030-12-13T12:00"), "Ben.dueAt": E("2030-12-21"), "Cara.dueAt": E("2030-12-29"),
      "test.workEndedAt": E("2030-12-29"), "test.openUntil": E("2030-12-17"), "Ben/recording.stintDueAt": E("2030-12-14"),
      "Ben/written.moneyCloses": E("2031-01-13"), "Ben/recording.moneyCloses": E("2031-01-13"), "Cara/written.moneyCloses": T("2031-01-19T12:00"),
      "Ben/written.disputeCloses": E("2031-01-13"), "Ben/recording.disputeCloses": E("2031-01-13"), "Cara/written.disputeCloses": T("2031-01-19T12:00"),
    }, { "Ben.rateCloses": E("2031-01-13"), "Cara.rateCloses": E("2031-01-13") });

    // 13. Developer hold Jan 6 12:00 → lifted Jan 8 12:00. (startHold is what a declined payment calls; liftHoldIfClear is what paying what's owed calls.)
    at("2031-01-06T12:00");
    await startHold(w.dev.user.id, "unpaid");
    shortcut(w, "13", "startHold(dev, \"unpaid\") called directly", "a hold starts from a declined card payment (holds.declinedPayment → startHold); payments are off in tests (no Stripe), so the hold function itself is called. The lift is liftHoldIfClear, the function Pay what you owe ends with (nothing is owed here)");
    await snap(w, "13a", "Jan 6 12:00: developer hold starts (after the close)", { "developer.holdStartedAt": T("2031-01-06T12:00"), "Ben/written.disputeCloses": D3(E("2031-01-13")) }, {
      "test.pausedSince": null, "Ben/written.moneyCloses": E("2031-01-13"), "Cara/written.moneyCloses": T("2031-01-19T12:00"),
    });
    at("2031-01-07T12:00");
    await snap(w, "13b", "Jan 7 12:00: during the hold (money and dispute dates move day by day)", { "Ben/written.disputeCloses": D3(E("2031-01-14")), "Cara/written.disputeCloses": D3(T("2031-01-20T12:00")) }, {
      "Ben/written.moneyCloses": E("2031-01-14"), "Ben/recording.moneyCloses": E("2031-01-14"), "Cara/written.moneyCloses": T("2031-01-20T12:00"),
    });
    at("2031-01-08T12:00");
    expect.soft(await liftHoldIfClear(w.dev.user.id), "the hold lifts").toBe(true);
    // (Decision 4, Dec 9 2026) A hold after the work ended now shifts payBy at its lift, but only dates still ahead at its start: every payBy here (Ben's Dec 20
    // and Dec 13, Cara's Jan 5 12:00) and every deadline had passed by Jan 6 12:00, so nothing saved moves.
    await snap(w, "13c", "Jan 8 12:00: the hold lifts (no payBy or stamp was still ahead: nothing saved moves)", {
      "developer.holdStartedAt": null, "Ben/written.moneyCloses": E("2031-01-15"), "Ben/recording.moneyCloses": E("2031-01-15"), "Cara/written.moneyCloses": T("2031-01-21T12:00"),
      "Ben/written.disputeCloses": D3(E("2031-01-15")), "Ben/recording.disputeCloses": D3(E("2031-01-15")), "Cara/written.disputeCloses": D3(T("2031-01-21T12:00")),
      "Ben/written.payBy": T("2030-12-20T12:00"), "Ben/recording.payBy": T("2030-12-13T12:00"), "Cara/written.payBy": T("2031-01-05T12:00"), "test.workEndedAt": E("2030-12-29"),
      "Ben/written.stintDueAt": null, "Ben/recording.stintDueAt": E("2030-12-14"), "Cara/written.stintDueAt": null,
    }, {
      "Ben.rateCloses": E("2031-01-15"), "Cara.rateCloses": E("2031-01-15"),
      // (Lead, Dec 9 2026) shiftAfterPause moves choiceBy only while it is still ahead: Ben's passed choiceBy stays (as at step 12).
      "Ben/written.choiceBy": T("2030-12-29T00:30"), "Ben/recording.choiceBy": T("2030-12-23T00:30"),
    });

    // 14. Ben's tester side suspended Jan 9 12:00 → reinstated Jan 10 12:00.
    at("2031-01-09T12:00");
    await suspendAccount(w.admin.user.id, w.people.Ben.user.id, "Checking a report about this account.", "tester");
    await snap(w, "14a", "Jan 9 12:00: Ben's tester side suspended", {}, { "Ben.testerSuspendedAt": T("2031-01-09T12:00") });
    at("2031-01-10T12:00");
    await reinstateAccount(w.people.Ben.user.id, "tester", w.admin.user.id);
    await snap(w, "14b", "Jan 10 12:00: Ben reinstated", {
      "Ben/written.moneyCloses": E("2031-01-16"), "Ben/recording.moneyCloses": E("2031-01-16"), "Ben/written.disputeCloses": D3(E("2031-01-16")), "Ben/recording.disputeCloses": D3(E("2031-01-16")),
      "Cara/written.moneyCloses": T("2031-01-21T12:00"), "Cara/written.disputeCloses": D3(T("2031-01-21T12:00")),
    }, { "Ben.testerSuspendedAt": null, "Ben.rateCloses": { v: E("2031-01-15"), note: "decision Dec 10: the tester's own suspension no longer moves his Rate" }, "Cara.rateCloses": E("2031-01-15") });

    // 15. Presses at Jan 17 12:00.
    at("2031-01-17T12:00");
    await relogin(w.dev);
    await relogin(w.people.Ben);
    shortcut(w, "15", "fresh sign-in sessions (createSession) for the developer and Ben on the scenario clock", "sessions last 30 days from when they were made; the scenario runs 47 days");
    const pay = await press("developer", "Pay", "Ben/written", () => reviewPOST(req("/api/review", { cookie: w.dev.cookie, body: { kind: "submission", id: w.parts["Ben/written"].id, amount: "10.00", payKey: randomUUID(), seenAt: seen(), confirmed: true } })).then(json));
    const chg = await press("Ben", "Charge", "Ben/recording", () => sact(w.people.Ben.sessionId, "choose", w.people.Ben.cookie, { submissionId: w.parts["Ben/recording"].id, choice: "charge", amount: "15.00", seenAt: seen(), confirmed: true }));
    const dsp = await press("Ben", "Dispute", "Ben/written", () => sact(w.people.Ben.sessionId, "dispute", w.people.Ben.cookie, { kind: "submission", id: w.parts["Ben/written"].id, reason: "I answered every question fully and on time.", seenAt: seen(), confirmed: true }));
    await snap(w, "15", "Jan 17 12:00: the presses", {
      "press.0.code": "pay_closed", "press.0.message": "~Jan 16, 2031", "press.1.code": "charge_closed", "press.2.message": D3("~Jan 16, 2031"),
      "Cara/written.moneyClosedOut": false, "Cara/written.disputeClosedOut": false,
    }, { "press.0.httpStatus": 409, "press.1.httpStatus": 409, "press.2.httpStatus": 409, "Ben/written.moneyClosedOut": true, "Ben/written.disputeClosedOut": true, "Ben/recording.moneyClosedOut": true }, [strip(pay), strip(chg), strip(dsp)]);
  }, 600_000);

  // ---------------------------------------------------------------------------------------------------------------------------------------------------
  // Side scenarios: each its own world, in its own month (outages are site-wide: an earlier scenario's outage ends before the next one starts).

  it("A: Stop while a developer hold is on (all deadlines before the stop): dispute fixed at base + 14; money moves a day each day until the hold lifts", async () => {
    const w = await newWorld("A stop during hold", "2031-03-01T09:00", "2031-03-11");
    at("2031-03-02T10:00");
    await join(w, "Ann");
    at("2031-03-03T12:00");
    await sendWritten(w, "A1", "Ann");
    await snap(w, "A1", "Mar 3: Ann (deadline Mar 12) sends written answers", {}, { "Ann.dueAt": E("2031-03-12"), "Ann/written.payBy": T("2031-03-10T12:00"), "Ann/written.chargeOpens": E("2031-03-12") });
    at("2031-03-08T12:00");
    await startHold(w.dev.user.id, "unpaid");
    shortcut(w, "A2", "startHold(dev, \"unpaid\") called directly", "no Stripe in tests: the declined payment that would start it can't happen");
    await snap(w, "A2", "Mar 8 12:00: hold starts during the work", {}, { "developer.holdStartedAt": T("2031-03-08T12:00"), "test.pausedSince": T("2031-03-08T12:00") });
    at("2031-03-13T00:30");
    await daily();
    await snap(w, "A3", "Mar 13 00:30: deadlines passed during the hold; the daily job doesn't close the work (paused)", {}, { "test.workEndedAt": null, "test.status": "open", "Ann.dueAt": E("2031-03-12") });
    at("2031-03-14T12:00");
    const st = await flow(w, "A4", "developer", "Stop", null, () => act(w.testId, "stop", w.dev.cookie, { reason: "We found what we needed.", seenAt: seen(), confirmed: true }));
    // Agent-derived: base = the stop (every deadline before it) = Mar 14 12:00; the dispute window clips the hold at the stop → Mar 28 12:00; the money window
    // counts the hold still on → now + 14 days.
    await snap(w, "A4", "Mar 14 12:00: developer Stops the test during the hold", {}, {
      "test.status": "stopped", "test.stoppedAt": T("2031-03-14T12:00"), "test.base": T("2031-03-14T12:00"),
      "Ann/written.disputeCloses": T("2031-03-28T12:00"), "Ann/written.moneyCloses": T("2031-03-28T12:00"),
    }, [strip(st)]);
    at("2031-03-15T12:00");
    await daily();
    await snap(w, "A5", "Mar 15 12:00: hold still on, day 1 after the stop", { "Ann/written.disputeCloses": D3(T("2031-03-29T12:00")) }, { "Ann/written.moneyCloses": T("2031-03-29T12:00") });
    at("2031-03-16T12:00");
    await daily();
    await snap(w, "A6", "Mar 16 12:00: hold still on, day 2 after the stop", { "Ann/written.disputeCloses": D3(T("2031-03-30T12:00")) }, { "Ann/written.moneyCloses": T("2031-03-30T12:00") });
    at("2031-03-17T12:00");
    expect.soft(await liftHoldIfClear(w.dev.user.id), "the hold lifts").toBe(true);
    // (Owner's decision, Dec 9 2026) A developer hold, then a Stop: the lift shifts by the whole hold (to the lift), so the piece's own window wins: Apr 4.
    await snap(w, "A7", "Mar 17 12:00: the hold lifts (whole hold shifted: owner-decided)", {
      "Ann/written.payBy": T("2031-03-19T12:00"), "Ann/written.stintDueAt": E("2031-03-21"), "Ann/written.moneyCloses": E("2031-04-04"), "Ann/written.disputeCloses": E("2031-04-04"),
    }, { "developer.holdStartedAt": null });
    at("2031-03-18T12:00");
    await snap(w, "A8", "Mar 18 12:00: a day after the lift (fixed)", { "Ann/written.moneyCloses": E("2031-04-04"), "Ann/written.disputeCloses": E("2031-04-04") });
  }, 300_000);

  it("B: a team pause still on when the work would end: dates move day by day; after the lift they settle with no double count", async () => {
    const w = await newWorld("B pause over work end", "2031-04-01T09:00", "2031-04-11");
    at("2031-04-02T10:00");
    await join(w, "Bo", "he");
    at("2031-04-03T12:00");
    await sendWritten(w, "B1", "Bo");
    await snap(w, "B1", "Apr 3: Bo (deadline Apr 12) sends written answers", {}, { "Bo.dueAt": E("2031-04-12"), "Bo/written.payBy": T("2031-04-10T12:00") });
    at("2031-04-09T08:00");
    await teamPause(w, "B2");
    await snap(w, "B2", "Apr 9 08:00: team pause", {}, { "test.adminPausedAt": T("2031-04-09T08:00") });
    at("2031-04-13T12:00");
    await runSweep(new Date());
    // Agent-derived: base = Apr 12 11:59 PM (Open until and Bo's deadline passed, not moved yet); the open pause makes each window now + 14 days.
    await snap(w, "B3", "Apr 13 12:00: the work would have ended Apr 12; pause still on (sweep run)", {}, {
      "test.workEndedAt": null, "test.base": E("2031-04-12"), "Bo/written.moneyCloses": T("2031-04-27T12:00"), "Bo/written.disputeCloses": T("2031-04-27T12:00"),
    });
    at("2031-04-14T12:00");
    await runSweep(new Date());
    await snap(w, "B4", "Apr 14 12:00: next day, pause still on", {}, {
      "test.workEndedAt": null, "Bo/written.moneyCloses": T("2031-04-28T12:00"), "Bo/written.disputeCloses": T("2031-04-28T12:00"),
    });
    at("2031-04-15T08:00");
    await teamLift(w, "B5");
    // Agent-derived: the pause (6 days) moves Open until Apr 11 → Apr 17, Bo's deadline Apr 12 → Apr 18, payBy Apr 10 → Apr 16 12:00; nothing closes yet.
    await snap(w, "B5", "Apr 15 08:00: the team lifts (6 days)", {}, {
      "test.openUntil": E("2031-04-17"), "Bo.dueAt": E("2031-04-18"), "Bo/written.payBy": T("2031-04-16T12:00"), "Bo/written.chargeOpens": E("2031-04-18"), "test.base": null,
    });
    at("2031-04-19T00:30");
    await runSweep(new Date());
    await snap(w, "B6", "Apr 19 00:30: the sweep closes the work at the moved deadline", {}, {
      "test.workEndedAt": E("2031-04-18"), "test.base": E("2031-04-18"), "Bo/written.moneyCloses": E("2031-05-02"), "Bo/written.disputeCloses": E("2031-05-02"), "Bo.rateCloses": E("2031-05-02"),
    });
    at("2031-04-20T12:00");
    await snap(w, "B7", "Apr 20 12:00: settled (unchanged a day later)", {}, { "Bo/written.moneyCloses": E("2031-05-02"), "Bo/written.disputeCloses": E("2031-05-02") });
  }, 300_000);

  it("C: an outage entirely inside a team pause moves nothing; the lift moves dates once by the whole pause", async () => {
    const w = await newWorld("C outage inside pause", "2031-05-01T09:00", "2031-05-11");
    at("2031-05-02T10:00");
    await join(w, "Cy", "he");
    at("2031-05-03T12:00");
    await sendWritten(w, "C1", "Cy");
    await snap(w, "C1", "May 3: Cy (deadline May 12) sends written answers", {}, { "Cy.dueAt": E("2031-05-12"), "Cy/written.payBy": T("2031-05-10T12:00"), "test.openUntil": E("2031-05-11") });
    at("2031-05-05T08:00");
    await teamPause(w, "C2");
    at("2031-05-07T10:05");
    await outage(new Date(T("2031-05-06T10:00")), new Date(T("2031-05-07T10:00")));
    await snap(w, "C3", "May 7: outage May 6 10:00 → May 7 10:00 recorded during the pause (moves nothing)", {}, { "Cy.dueAt": E("2031-05-12"), "Cy/written.payBy": T("2031-05-10T12:00"), "test.openUntil": E("2031-05-11") });
    at("2031-05-08T08:00");
    await teamLift(w, "C4");
    await snap(w, "C4", "May 8 08:00: the team lifts (3 days; once, not 3 + 1)", {}, { "Cy.dueAt": E("2031-05-15"), "Cy/written.payBy": T("2031-05-13T12:00"), "test.openUntil": E("2031-05-14"), "Cy/written.chargeOpens": E("2031-05-15") });
    at("2031-05-16T00:30");
    await runSweep(new Date());
    await snap(w, "C5", "May 16 00:30: the work closes", {}, { "test.workEndedAt": E("2031-05-15"), "Cy/written.moneyCloses": E("2031-05-29"), "Cy/written.disputeCloses": E("2031-05-29") });
  }, 300_000);

  it("D: a part's payBy exactly at a pause's start is not moved at the lift (payBy > start)", async () => {
    const w = await newWorld("D payBy at pause start", "2031-06-01T09:00", "2031-06-21");
    at("2031-06-02T10:00");
    await join(w, "Di");
    at("2031-06-03T12:00");
    await sendWritten(w, "D1", "Di");
    await snap(w, "D1", "Jun 3 12:00: Di (deadline Jun 22) sends written answers", {}, { "Di.dueAt": E("2031-06-22"), "Di/written.payBy": T("2031-06-10T12:00") });
    at("2031-06-10T12:00");
    await teamPause(w, "D2");
    await snap(w, "D2", "Jun 10 12:00:00.000: team pause starts exactly at payBy", {}, { "test.adminPausedAt": T("2031-06-10T12:00") });
    at("2031-06-12T12:00");
    await teamLift(w, "D3");
    await snap(w, "D3", "Jun 12 12:00: lift (2 days): payBy stays, the deadline moves", {}, { "Di/written.payBy": T("2031-06-10T12:00"), "Di.dueAt": E("2031-06-24"), "Di/written.chargeOpens": E("2031-06-24"), "test.openUntil": E("2031-06-23") });
  }, 300_000);

  it("E: a second leave + rejoin keeps the first rejoin's stamps", async () => {
    const w = await newWorld("E second rejoin", "2031-07-01T09:00", "2031-07-21");
    at("2031-07-02T10:00");
    await join(w, "Eve");
    at("2031-07-03T12:00");
    await sendWritten(w, "E1", "Eve");
    at("2031-07-04T12:00");
    await leave(w, "E2", "Eve");
    at("2031-07-06T12:00");
    const r1 = await rejoin(w, "E3", "Eve");
    await snap(w, "E3", "Jul 6 12:00: first rejoin (left with 18d 11h 59m 59s)", {}, { "Eve.dueAt": E("2031-07-24"), "Eve/written.stintDueAt": E("2031-07-22") }, r1);
    at("2031-07-07T12:00");
    await sendRecording(w, "E4", "Eve");
    await snap(w, "E4", "Jul 7 12:00: Eve sends a recording in the second stint", {}, { "Eve/recording.payBy": T("2031-07-14T12:00"), "Eve/recording.stintDueAt": null, "Eve/recording.chargeOpens": E("2031-07-24") });
    at("2031-07-08T12:00");
    await leave(w, "E5", "Eve");
    at("2031-07-10T12:00");
    const r2 = await rejoin(w, "E6", "Eve");
    await snap(w, "E6", "Jul 10 12:00: second rejoin: the written part keeps Jul 22; the recording is stamped Jul 24", {}, {
      "Eve.dueAt": E("2031-07-26"), "Eve/written.stintDueAt": E("2031-07-22"), "Eve/recording.stintDueAt": E("2031-07-24"), "Eve/written.chargeOpens": E("2031-07-22"), "Eve/recording.chargeOpens": E("2031-07-24"),
    }, r2);
  }, 300_000);

  it("F: an addition after the part's Charge opened is frozen: payBy and stamp unchanged", async () => {
    const w = await newWorld("F addition after Charge opened", "2031-08-01T09:00", "2031-08-11");
    at("2031-08-02T10:00");
    await join(w, "Fay");
    at("2031-08-02T12:00");
    await sendWritten(w, "F1", "Fay");
    at("2031-08-03T12:00");
    await leave(w, "F2", "Fay");
    at("2031-08-10T12:00");
    const r = await rejoin(w, "F3", "Fay");
    await snap(w, "F3", "Aug 10 12:00: Fay rejoins (left with 9d 11h 59m 59s)", {}, { "Fay.dueAt": E("2031-08-19"), "Fay/written.stintDueAt": E("2031-08-12"), "Fay/written.payBy": T("2031-08-09T12:00"), "Fay/written.chargeOpens": E("2031-08-12") }, r);
    at("2031-08-13T12:00");
    const a1 = await flow(w, "F4", "Fay", "Add to this answer", "Fay/written", () => addTo(w.people.Fay.sessionId, w.people.Fay.cookie, { text: "Also: the map screen didn't scroll on my laptop.", seenAt: seen(), confirmed: true }));
    await snap(w, "F4", "Aug 13 12:00: addition after Charge opened (before the daily job marked it)", {}, { "Fay/written.payBy": T("2031-08-09T12:00"), "Fay/written.stintDueAt": E("2031-08-12"), "Fay/written.chargeOpens": E("2031-08-12"), "Fay/written.late": false }, [strip(a1)]);
    at("2031-08-14T00:30");
    await daily();
    at("2031-08-14T12:00");
    const a2 = await flow(w, "F5", "Fay", "Add to this answer", "Fay/written", () => addTo(w.people.Fay.sessionId, w.people.Fay.cookie, { text: "And the sound kept playing after I paused the game.", seenAt: seen(), confirmed: true }));
    await snap(w, "F5", "Aug 14 12:00: a second addition after the daily job opened Charge", {}, { "Fay/written.payBy": T("2031-08-09T12:00"), "Fay/written.stintDueAt": E("2031-08-12"), "Fay/written.choiceOfferedAt": SET, "Fay/written.late": false }, [strip(a2)]);
  }, 300_000);

  // ---------------------------------------------------------------------------------------------------------------------------------------------------
  // G (owner, Dec 9 2026): a team pause, then a Stop: the Stop is the pause's lift (holds.shiftAtStop). Gil's deadline Sep 18 is his own (10 tester days from
  // Sep 8; Open until Sep 11: a tester joining after the test opened always gets a deadline at or after Open until, so Open until can't be later than Sep 18).
  // G0 control: the team lifts at the same moment instead.
  for (const variant of ["G0 lift", "G1 developer Stop", "G2 team Stop", "G3 pause closure"] as const) {
    it(`G team pause then Stop: ${variant}`, async () => {
      const w = await newWorld(`G ${variant}`, "2031-09-01T09:00", "2031-09-11");
      const g = variant.slice(0, 2);
      at("2031-09-08T10:00");
      await join(w, "Gil", "he");
      at("2031-09-10T12:00");
      await sendWritten(w, `${g}.1`, "Gil");
      await snap(w, `${g}.1`, "Sep 10 12:00: Gil (deadline Sep 18) sends written answers", { "Gil.dueAt": E("2031-09-18"), "Gil/written.payBy": T("2031-09-17T12:00") }, { "Gil/written.chargeOpens": E("2031-09-18") });
      at("2031-09-10T18:00");
      await teamPause(w, `${g}.2`);
      at("2031-09-15T12:00");
      await snap(w, `${g}.2`, "Sep 15 12:00: during the team pause (from Sep 10 18:00): nothing moved", {}, { "test.adminPausedAt": T("2031-09-10T18:00"), "test.pausedSince": T("2031-09-10T18:00"), "Gil.dueAt": E("2031-09-18"), "Gil/written.payBy": T("2031-09-17T12:00") });
      at("2031-09-20T12:00");
      const presses: Press[] = [];
      if (variant === "G0 lift") await teamLift(w, `${g}.3`);
      if (variant === "G1 developer Stop") presses.push(strip(await flow(w, `${g}.3`, "developer", "Stop", null, () => act(w.testId, "stop", w.dev.cookie, { reason: "We found what we needed.", seenAt: seen(), confirmed: true }))));
      if (variant === "G2 team Stop") await adminStopTest(w.testId, "Stopped after a report.", w.admin.user.id);
      if (variant === "G3 pause closure") await adminClosePaused(w.admin.user.id, w.testId);
      if (variant === "G0 lift") {
        await snap(w, `${g}.3`, "Sep 20 12:00: the team LIFTS (9d 18h): Gil, still working, gets the time back", {
          "Gil/written.payBy": T("2031-09-27T06:00"), "Gil.dueAt": E("2031-09-28"), "Gil/written.stintDueAt": null, "Gil/written.chargeOpens": E("2031-09-28"),
        }, { "test.status": "open", "Gil.status": "working", "test.pausedSince": null, "test.adminPausedAt": null, "test.base": null }, presses);
        at("2031-09-29T00:30");
        await daily();
        await snap(w, `${g}.4`, "Sep 29 00:30: the daily job (work closes at Sep 28 11:59 PM; Charge opens)", {}, { "test.workEndedAt": E("2031-09-28"), "Gil/written.choiceOfferedAt": SET, "Gil/written.moneyCloses": E("2031-10-12"), "Gil/written.disputeCloses": E("2031-10-12") });
        return;
      }
      await snap(w, `${g}.3`, `Sep 20 12:00: ${variant} during the team pause: the Stop is the pause's lift (9d 18h)`, {
        "Gil.dueAt": E("2031-09-18"), "Gil/written.payBy": T("2031-09-27T06:00"), "Gil/written.stintDueAt": E("2031-09-28"), "Gil/written.chargeOpens": E("2031-09-28"),
        "test.base": T("2031-09-20T12:00"), "Gil/written.moneyCloses": E("2031-10-12"), "Gil/written.disputeCloses": E("2031-10-12"), "test.pausedSince": null,
      }, { "test.status": "stopped", "test.stoppedAt": T("2031-09-20T12:00") }, presses);
      at("2031-09-22T12:00");
      const ch = await press("Gil", "Charge", "Gil/written", () => sact(w.people.Gil.sessionId, "choose", w.people.Gil.cookie, { submissionId: w.parts["Gil/written"].id, choice: "charge", amount: "10.00", seenAt: seen(), confirmed: true }));
      await snap(w, `${g}.4`, "Sep 22 12:00: Gil presses Charge (not offered yet)", { "press.0.code": "not_yet" }, { "press.0.httpStatus": 409, "Gil/written.choiceOfferedAt": null }, [strip(ch)]);
      at("2031-09-29T00:30");
      await daily();
      await snap(w, `${g}.5`, "Sep 29 00:30: the daily job after Sep 28 11:59 PM", { "Gil/written.choiceOfferedAt": SET }, { "Gil/written.moneyCloses": E("2031-10-12"), "Gil/written.disputeCloses": E("2031-10-12") });
    }, 300_000);
  }

  it("H: a team pause + a developer hold, then a Stop: nothing moves at the Stop; the hold's lift shifts the whole stretch once", async () => {
    const w = await newWorld("H team pause + hold, then Stop", "2031-10-01T09:00", "2031-10-11");
    // The test-side windows on their own (the part's own window is pieceCloseOut's other half), and the "running again" lines on this test.
    const extra = async () => {
      const now = new Date();
      const t = await db.test.findUniqueOrThrow({ where: { id: w.testId }, include: { developer: true, contracts: { select: { status: true, dueAt: true } } } });
      const base = closeOutBase(t, t.contracts, now);
      return {
        moneyTestWindow: base ? iso(windowEnd(base, await moneySpans(t, base, now), now, 14).end) : null,
        runningAgainEvents: await db.testEvent.count({ where: { testId: w.testId, kind: "resumed", text: "Your tests are running again" } }),
      };
    };
    at("2031-10-08T10:00");
    await join(w, "Hal", "he");
    at("2031-10-10T12:00");
    await sendWritten(w, "H1", "Hal");
    await snap(w, "H1", "Oct 10 12:00: Hal (deadline Oct 18) sends written answers", { "Hal.dueAt": E("2031-10-18"), "Hal/written.payBy": T("2031-10-17T12:00") });
    at("2031-10-10T18:00");
    await teamPause(w, "H2");
    at("2031-10-15T12:00");
    await startHold(w.dev.user.id, "unpaid");
    shortcut(w, "H3", "startHold(dev, \"unpaid\") called directly", "no Stripe in tests: the declined payment that would start it can't happen");
    await snap(w, "H3", "Oct 15 12:00: developer hold starts (team pause still on)", {}, { "developer.holdStartedAt": T("2031-10-15T12:00"), "test.pausedSince": T("2031-10-10T18:00") });
    at("2031-10-20T12:00");
    const st = await flow(w, "H4", "developer", "Stop", null, () => act(w.testId, "stop", w.dev.cookie, { reason: "We found what we needed.", seenAt: seen(), confirmed: true }));
    await snap(w, "H4", "Oct 20 12:00: developer Stops: NOTHING moves (the hold is still on)", {
      "Hal/written.payBy": T("2031-10-17T12:00"), "Hal/written.stintDueAt": null, "test.pausedSince": T("2031-10-10T18:00"),
    }, { "test.status": "stopped", "test.base": T("2031-10-20T12:00"), "Hal.dueAt": E("2031-10-18"), "Hal/written.moneyCloses": T("2031-11-03T12:00"), "Hal/written.disputeCloses": T("2031-11-03T12:00") }, [strip(st)], await extra());
    at("2031-10-22T12:00");
    await snap(w, "H5", "Oct 22 12:00: during the hold (money and dispute move day by day)", { "Hal/written.disputeCloses": D3(T("2031-11-05T12:00")) }, { "Hal/written.moneyCloses": T("2031-11-05T12:00") }, [], await extra());
    at("2031-10-23T12:00");
    await snap(w, "H6", "Oct 23 12:00: next day of the hold", { "Hal/written.disputeCloses": D3(T("2031-11-06T12:00")) }, { "Hal/written.moneyCloses": T("2031-11-06T12:00") }, [], await extra());
    at("2031-10-25T12:00");
    expect.soft(await liftHoldIfClear(w.dev.user.id), "the hold lifts").toBe(true);
    await snap(w, "H7", "Oct 25 12:00: the hold lifts: one shift by the whole stretch Oct 10 18:00 → Oct 25 12:00 (14d 18h)", {
      "Hal/written.payBy": T("2031-11-01T06:00"), "Hal/written.stintDueAt": E("2031-11-02"), "Hal/written.chargeOpens": E("2031-11-02"), "test.pausedSince": null, "extra.runningAgainEvents": 0,
      "Hal/written.moneyCloses": E("2031-11-16"), "extra.moneyTestWindow": T("2031-11-08T12:00"), "Hal/written.disputeCloses": E("2031-11-16"),
    }, { "developer.holdStartedAt": null, "Hal.dueAt": E("2031-10-18") }, [], await extra());
    at("2031-10-26T12:00");
    await snap(w, "H8", "Oct 26 12:00: a day after the lift (fixed)", {}, { "Hal/written.moneyCloses": E("2031-11-16"), "Hal/written.disputeCloses": E("2031-11-16"), "Hal/written.payBy": T("2031-11-01T06:00") }, [], await extra());
  }, 300_000);

  // I (owner, decision 4, Dec 9 2026): a developer hold that starts AFTER the work ended, before a part's payBy: its lift moves payBy (and a listed call's) like one
  // during the work; callChargeAt counts only a freeze still on, so the lift isn't counted twice.
  it("I: a hold after the close, before payBy: its lift moves payBy and the call's payBy once", async () => {
    const w = await newWorld("I hold after the close, before payBy", "2031-11-02T09:00", "2031-11-12");
    let callId = "";
    const extra = async () => {
      const now = new Date();
      const t = await db.test.findUniqueOrThrow({ where: { id: w.testId }, include: { developer: true, contracts: { select: { status: true, dueAt: true } } } });
      const base = closeOutBase(t, t.contracts, now);
      const call = callId ? await db.call.findUniqueOrThrow({ where: { id: callId } }) : null;
      return {
        moneyTestWindow: base ? iso(windowEnd(base, await moneySpans(t, base, now), now, 14).end) : null,
        callStartsAt: iso(call?.startsAt), callMeasuredTo: iso(call?.measuredTo), callMeasuredAt: iso(call?.measuredAt), callRateCents: call?.rateCents ?? null,
        callPayBy: iso(call?.payBy), callChargeAt: callId ? iso(await callChargeAt(callId, now)) : null, callMoneyCloses: callId ? iso(await pieceCloseOut({ callId }, now)) : null,
      };
    };
    at("2031-11-02T10:00");
    await join(w, "Ivy");
    await snap(w, "I0", "Nov 2: Ivy joins (deadline Nov 12 = Open until)", {}, { "Ivy.dueAt": E("2031-11-12"), "test.openUntil": E("2031-11-12") });
    // A listed call (the listing's $30/h): requested by the developer, accepted by Ivy, Nov 10 10:30 for 30 minutes.
    at("2031-11-08T10:30");
    const booked = await bookCall(w.testId, w.dev.cookie, w.people.Ivy.sessionId, w.people.Ivy.cookie, 48);
    callId = booked.id;
    // Both in the room 10:30 → 11:00 (the room's presence rows), then the measuring sweep makes the length final.
    await db.callPresence.createMany({ data: (["developer", "tester"] as const).map((side) => ({ callId, userId: side === "developer" ? w.dev.user.id : w.people.Ivy.user.id, side, startAt: new Date(T("2031-11-10T10:30")), endAt: new Date(T("2031-11-10T11:00")) })) });
    shortcut(w, "I1", "CallPresence rows written for both sides, Nov 10 10:30 → 11:00", "the call room records presence from the two browsers' live connection (WebRTC polling), which can't run in a test; the measuring itself is the real finishMeasuring sweep");
    at("2031-11-10T11:10");
    await finishMeasuring(new Date());
    await snap(w, "I1", "Nov 10 11:10: the listed call (10:30 → 11:00) is measured", { "extra.callPayBy": T("2031-11-17T11:00") }, { "extra.callMeasuredTo": T("2031-11-10T11:00"), "extra.callRateCents": 3000 }, [], await extra());
    at("2031-11-11T12:00");
    await sendWritten(w, "I2", "Ivy");
    await snap(w, "I2", "Nov 11 12:00: Ivy sends written answers", { "Ivy/written.payBy": T("2031-11-18T12:00") }, { "Ivy/written.chargeOpens": T("2031-11-18T12:00") }, [], await extra());
    at("2031-11-13T00:30");
    await daily();
    await snap(w, "I3", "Nov 13 00:30: the daily job ends the work at Nov 12 11:59 PM", {}, { "test.workEndedAt": E("2031-11-12"), "test.status": "closed", "Ivy/written.moneyCloses": T("2031-12-02T12:00") }, [], await extra());
    at("2031-11-14T12:00");
    await startHold(w.dev.user.id, "unpaid");
    shortcut(w, "I4", "startHold(dev, \"unpaid\") called directly", "no Stripe in tests: the declined payment that would start it can't happen");
    await snap(w, "I4", "Nov 14 12:00: developer hold starts (after the close, before payBy)", {}, { "developer.holdStartedAt": T("2031-11-14T12:00"), "test.pausedSince": null }, [], await extra());
    at("2031-11-15T12:00");
    await snap(w, "I5", "Nov 15 12:00: during the hold", {
      "Ivy/written.payBy": T("2031-11-18T12:00"), "Ivy/written.moneyCloses": T("2031-12-02T12:00"), "Ivy/written.disputeCloses": T("2031-12-02T12:00"), "extra.callChargeAt": T("2031-11-18T11:00"),
    }, { "extra.callPayBy": T("2031-11-17T11:00") }, [], await extra());
    at("2031-11-16T06:00");
    // Agent-derived: the call's date moves with the clock (its countdown runs through the hold); the part's own 14 days start at its Charge opening (Nov 18 12:00),
    // which is still ahead, so its closing date waits at Dec 2 12:00 instead of moving.
    await snap(w, "I5b", "Nov 16 06:00: still during the hold (18 hours later)", {}, { "extra.callChargeAt": T("2031-11-19T05:00"), "Ivy/written.moneyCloses": T("2031-12-02T12:00") }, [], await extra());
    at("2031-11-16T12:00");
    expect.soft(await liftHoldIfClear(w.dev.user.id), "the hold lifts").toBe(true);
    await snap(w, "I6", "Nov 16 12:00: the hold lifts: payBy and the call's payBy move by 2 days (counted once)", {
      "Ivy/written.payBy": T("2031-11-20T12:00"), "Ivy/written.chargeOpens": T("2031-11-20T12:00"), "extra.callPayBy": T("2031-11-19T11:00"), "extra.callChargeAt": T("2031-11-19T11:00"),
      "extra.moneyTestWindow": E("2031-11-28"), "Ivy/written.moneyCloses": T("2031-12-04T12:00"), "Ivy/written.disputeCloses": T("2031-12-04T12:00"),
    }, { "developer.holdStartedAt": null, "Ivy/written.stintDueAt": null, "Ivy.dueAt": E("2031-11-12") }, [], await extra());
    at("2031-11-17T12:00");
    await snap(w, "I7", "Nov 17 12:00: a day after the lift (unchanged)", {
      "Ivy/written.payBy": T("2031-11-20T12:00"), "extra.callPayBy": T("2031-11-19T11:00"), "extra.callChargeAt": T("2031-11-19T11:00"), "Ivy/written.moneyCloses": T("2031-12-04T12:00"), "Ivy/written.disputeCloses": T("2031-12-04T12:00"),
    }, {}, [], await extra());
  }, 300_000);
});
