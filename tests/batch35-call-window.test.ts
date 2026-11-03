import React, { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import type { User } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { CALL_MIN_AHEAD_MINUTES, LIVE_CALL_LEAD_MINUTES, leadMinutesFor } from "@/lib/callLead";
import { beforeEndLine, leadLine, repeatChoices, tooSoonNote, type CallEnd } from "@/lib/callWindow";
import { callsUntil, cutRow, occurrences } from "@/lib/callRows";
import { fmtDateIn, fmtDateTimeIn } from "@/lib/format";
import { workEndOf } from "@/lib/server/workWindow";
import { pageRows, topUpForeverSets } from "@/lib/server/requests";
import { testV } from "@/lib/server/pulseV";
import { acceptChoices, describeRows, fitRow, RequestRows, rowOffer, rowsPayload, type RowState } from "@/components/RequestRows";
import { CallRequestsPanel } from "@/components/CallRequestsPanel";
import { CallRequests } from "@/components/CallRequests";
import { DevCallPanel } from "@/app/app/tests/[id]/DevCallPanel";
import { localNow, localValue } from "@/components/FieldChecks";
import { CALL_WINDOW_TERMS, TERMS_VERSION, WHAT_CHANGED } from "@/lib/termsOfUse";
import { json, req } from "./helpers";
import { act, atHours, joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 2, batch 35 §132) THE CALL WINDOW: a call time is at least 24 hours ahead on the live site (1 minute, or CALL_MIN_AHEAD_MINUTES, when testing locally)
// and no later than when testers' work on the test ends (workDeadlineOf: the latest tester deadline, no earlier than Open until). Daily / Weekly sets are cut there,
// Forever runs until it; Accept and the Forever top-up keep to it; the forms offer only what fits and follow the end live.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/test", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const HOUR = 3_600_000, DAY = 24 * HOUR;
const devReq = (testId: string, cookie: string, contractIds: string[], extra: Record<string, unknown>) =>
  act(testId, "request-time", cookie, { seenAt: seen(), confirmed: true, minutes: "30", contractIds, ...extra });
const once = (startsAt: string) => ({ rows: [{ startsAt, repeat: "once", count: 1 }] });
/** The minute a moment is in (what a time box can hold). */
const minuteOf = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000);
const pending = (contractId: string, fromSide = "developer") => db.callRequest.findFirstOrThrow({ where: { contractId, fromSide, status: "pending" }, orderBy: { createdAt: "desc" } });
/** Moves a waiting request to another time (as if time passed, or it was sent before this rule). */
const moveRequest = (id: string, at: Date, repeat = "once", count = 1) =>
  db.callRequest.update({ where: { id }, data: { startsAt: at, times: [at], weeks: repeat === "once" || !count ? 0 : count, repeat: repeat === "once" ? "" : repeat, rows: [{ startsAt: at.toISOString(), repeat, count }] } });
const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("§132 at least 24 hours ahead on the live site", () => {
  it("the lead: 24 hours in production whatever the setting; locally 1 minute, or the setting; its line comes from the minutes", async () => {
    expect(LIVE_CALL_LEAD_MINUTES).toBe(1440);
    expect(leadMinutesFor("production", "1")).toBe(1440);
    expect(leadMinutesFor("production", undefined)).toBe(1440);
    expect(leadMinutesFor("development", undefined)).toBe(1);
    expect(leadMinutesFor("test", "30")).toBe(30);
    expect(leadMinutesFor("test", "-5")).toBe(1);
    expect(CALL_MIN_AHEAD_MINUTES).toBe(1); // these tests run locally, without the setting
    expect(leadLine(1440)).toBe("Pick a time at least 24 hours from now.");
    expect(leadLine(1)).toBe("Pick a time at least 1 minute from now.");
    expect(leadLine(60)).toBe("Pick a time at least 1 hour from now.");
    expect(leadLine(90)).toBe("Pick a time at least 90 minutes from now.");
    expect(leadLine(0)).toBe("Pick a time in the future.");
    // The module itself in production mode (read once).
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CALL_MIN_AHEAD_MINUTES", "1");
    vi.resetModules();
    const prod = await import("@/lib/callLead");
    expect(prod.CALL_MIN_AHEAD_MINUTES).toBe(1440);
    expect(prod.farEnoughAhead(new Date(Date.now() + 23 * HOUR))).toBe(false);
    expect(prod.farEnoughAhead(new Date(Date.now() + DAY + 60_000))).toBe(true);
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("production mode: the server refuses a time less than 24 hours ahead with the form's line and takes one 25 hours ahead; once less than 24 hours away it can't be accepted", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const body = (h: number) => ({ contractIds: [j.sessionId], ...once(atHours(h)), minutes: "30", seenAt: seen(), confirmed: true });
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    try {
      const tests = await import("@/app/api/tests/[id]/[action]/route");
      const sessions = await import("@/app/api/sessions/[id]/[action]/route");
      const press = (b: Record<string, unknown>) => tests.POST(req(`/api/tests/${s.testId}/request-time`, { cookie: s.dev.cookie, body: b }), { params: Promise.resolve({ id: s.testId, action: "request-time" }) }).then(json);
      expect((await press(body(23))).body.error).toMatchObject({ code: "bad_time", message: "Pick a time at least 24 hours from now." });
      expect((await press(body(25))).status).toBe(200);
      // An hour later it's less than 24 hours away (moved here): Accept is refused, saying why; nothing is booked.
      const q = await pending(j.sessionId);
      const soon = minuteOf(new Date(Date.now() + 23 * HOUR));
      await moveRequest(q.id, soon);
      const a = await sessions.POST(req(`/api/sessions/${j.sessionId}/answer-request`, { cookie: j.tester.cookie, body: { requestId: q.id, action: "accept", seenAt: seen(), confirmed: true } }), { params: Promise.resolve({ id: j.sessionId, action: "answer-request" }) }).then(json);
      expect(a.body.error).toMatchObject({ code: "too_soon", message: `${fmtDateTimeIn(soon, "UTC")} is less than 24 hours from now, so it can't be booked any more. Request a later time instead.` });
      expect(await db.call.count({ where: { contractId: j.sessionId } })).toBe(0);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("locally (the override: 1 minute by default) a time 2 minutes ahead is taken and one 20 seconds ahead is refused with the 1-minute line", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    expect((await devReq(s.testId, s.dev.cookie, [j.sessionId], once(new Date(Date.now() + 2 * 60_000).toISOString()))).status).toBe(200);
    const r = await sact(j.sessionId, "request-time", j.tester.cookie, { ...once(new Date(Date.now() + 20_000).toISOString()), minutes: "30", seenAt: seen(), confirmed: true });
    expect(r.body.error).toMatchObject({ code: "bad_time", message: "Pick a time at least 1 minute from now." });
  });
});

describe("§132 no later than when testers' work on the test ends", () => {
  it("a time after the end is refused on both sides, naming the end in the reader's zone; the end's own minute is taken", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const end = (await workEndOf(db, s.testId))!;
    const t = await db.test.findUniqueOrThrow({ where: { id: s.testId }, include: { contracts: true } });
    expect(end.getTime()).toBe(Math.max(t.openUntil!.getTime(), ...t.contracts.map((c) => c.dueAt.getTime())));
    // The developer reads it in their own zone (Chicago), the tester in theirs (none saved: UTC).
    await db.user.update({ where: { id: s.dev.user.id }, data: { timeZone: "America/Chicago" } });
    const late = new Date(end.getTime() + HOUR).toISOString();
    const d = await devReq(s.testId, s.dev.cookie, [j.sessionId], once(late));
    expect(d.body.error).toMatchObject({ code: "bad_time", message: `Pick a time before ${fmtDateTimeIn(end, "America/Chicago")} (when testers' work on this test ends).` });
    expect(d.body.error.message).toBe(beforeEndLine(fmtDateTimeIn(end, "America/Chicago")));
    const tr = await sact(j.sessionId, "request-time", j.tester.cookie, { ...once(late), minutes: "30", seenAt: seen(), confirmed: true });
    expect(tr.body.error.message).toBe(`Pick a time before ${fmtDateTimeIn(end, "UTC")} (when testers' work on this test ends).`);
    // A set whose first time is after the end is refused the same way (never cut to nothing).
    expect((await devReq(s.testId, s.dev.cookie, [j.sessionId], { rows: [{ startsAt: late, repeat: "weekly", count: 3 }] })).body.error.code).toBe("bad_time");
    expect(await db.callRequest.count({ where: { contractId: j.sessionId } })).toBe(0);
    expect((await devReq(s.testId, s.dev.cookie, [j.sessionId], once(minuteOf(end).toISOString()))).status).toBe(200);
  });

  it("a weekly ×8 set is cut at the end (not refused): the request covers the calls that fit, says how many on both pages, and Accept books them", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const end = (await workEndOf(db, s.testId))!;
    const start = atHours(48);
    const n = callsUntil(new Date(start), "weekly", end);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThan(8);
    expect((await devReq(s.testId, s.dev.cookie, [j.sessionId], { rows: [{ startsAt: start, repeat: "weekly", count: 8 }] })).status).toBe(200);
    const q = await pending(j.sessionId);
    expect(q.rows).toEqual([{ startsAt: start, repeat: "weekly", count: n }]);
    expect(q).toMatchObject({ weeks: n, repeat: "weekly" });
    const rows = pageRows(q, end);
    expect(describeRows(rows)).toContain(`· ${n} calls from `);
    expect(acceptChoices(rows)).toEqual([{ label: `Accept all ${n}` }]);
    // The developer's test page and the tester's session page show the request covering n calls.
    auth.user = await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } });
    const { default: TestPage } = await import("@/app/app/tests/[id]/page");
    const devHtml = unescape(render(await TestPage({ params: Promise.resolve({ id: s.testId }), searchParams: Promise.resolve({}) })));
    expect(devHtml).toContain(`${n} calls from `);
    auth.user = await db.user.findUniqueOrThrow({ where: { id: j.tester.user.id } });
    const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
    const testerHtml = unescape(render(await SessionPage({ params: Promise.resolve({ id: j.sessionId }) })));
    expect(testerHtml).toContain(`${n} calls from `);
    expect(testerHtml).toContain(`Accept all ${n}`);
    const a = await sact(j.sessionId, "answer-request", j.tester.cookie, { requestId: q.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(a.body).toMatchObject({ booked: true, calls: n });
    const calls = await db.call.findMany({ where: { contractId: j.sessionId }, orderBy: { startsAt: "asc" } });
    expect(calls).toHaveLength(n);
    expect(calls.every((c) => c.startsAt <= end)).toBe(true);
    expect(await db.callSet.findFirstOrThrow({ where: { contractId: j.sessionId } })).toMatchObject({ repeat: "weekly", count: n });
  });

  it("a set with only its first call before the end is a single call; a daily set keeps the days that fit", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const end = (await workEndOf(db, s.testId))!;
    const three = minuteOf(new Date(end.getTime() - 3 * DAY)).toISOString();
    expect((await devReq(s.testId, s.dev.cookie, [j.sessionId], { rows: [{ startsAt: three, repeat: "weekly", count: 4 }] })).status).toBe(200);
    expect((await pending(j.sessionId)).rows).toEqual([{ startsAt: three, repeat: "once", count: 1 }]);
    const two = minuteOf(new Date(end.getTime() - 2 * DAY - HOUR)).toISOString();
    const r = await sact(j.sessionId, "request-time", j.tester.cookie, { rows: [{ startsAt: two, repeat: "daily", count: 8 }], minutes: "30", seenAt: seen(), confirmed: true });
    expect(r.status).toBe(200);
    expect((await pending(j.sessionId, "tester")).rows).toEqual([{ startsAt: two, repeat: "daily", count: 3 }]);
    // The pure rule the server uses.
    expect(cutRow({ startsAt: new Date(three), repeat: "weekly", count: 4 }, end)).toEqual({ startsAt: new Date(three), repeat: "once", count: 1 });
    expect(cutRow({ startsAt: new Date(end.getTime() + 60_000), repeat: "daily", count: 2 }, end)).toBeNull();
    expect(occurrences({ startsAt: new Date(two), repeat: "daily", count: 0 }, end)).toHaveLength(3);
  });

  it("with less than the lead left before the end nothing can be requested: the server says so, and both forms show the line instead of the time boxes", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const soonEnd = new Date(Date.now() + 30_000); // the lead here is 1 minute
    await db.test.update({ where: { id: s.testId }, data: { openUntil: soonEnd } });
    await db.contract.updateMany({ where: { testId: s.testId }, data: { dueAt: soonEnd } });
    expect((await devReq(s.testId, s.dev.cookie, [j.sessionId], once(atHours(1)))).body.error).toMatchObject({ code: "bad_time", message: `No more calls can be requested: testers' work on this test ends ${fmtDateTimeIn(soonEnd, "UTC")}, less than 1 minute from now.` });
    // The forms with the live site's 24 hours and the end 10 hours away: the line and no time box; with time left (1 minute), the box.
    const end: CallEnd = { at: new Date(Date.now() + 10 * HOUR).toISOString(), text: "Tue, Nov 3, 8:00 PM", day: "Nov 3" };
    const line = "No more calls can be requested: testers' work on this test ends Tue, Nov 3, 8:00 PM, less than 24 hours from now.";
    const tester = (leadMinutes: number) => unescape(render(h(CallRequests, { path: "/api/sessions/x", seenAt: seen(), side: "tester", requests: [], targets: [{ contractId: "c1", name: "Nora Lane", rate: "" }], canRequest: true, leadMinutes, end })));
    expect(tester(1440)).toContain(line);
    expect(tester(1440)).not.toContain('aria-label="Requested time 1"');
    expect(tester(1)).toContain('aria-label="Requested time 1"');
    expect(tester(1)).not.toContain("No more calls can be requested");
    const dev = (leadMinutes: number) => unescape(render(h(DevCallPanel, { testId: "t1", seenAt: seen(), leadMinutes, end, canRequest: true, testers: [{ contractId: "c1", name: "Ana Silva", terms: "", booked: 0, calls: [], sets: [], requests: [] }] })));
    expect(dev(1440)).toContain(line);
    expect(dev(1440)).not.toContain('aria-label="Requested time 1"');
    expect(dev(1)).toContain('aria-label="Requested time 1"');
  });

  it("Forever runs until testers' work ends: it books the calls before the end, the top-up adds none after it, and goes on when the end moves later", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const end = (await workEndOf(db, s.testId))!;
    const start = atHours(48);
    const fit = callsUntil(new Date(start), "weekly", end);
    expect(fit).toBe(3); // the default test: 2 days ahead, the work ends about 20 days from now
    expect((await devReq(s.testId, s.dev.cookie, [j.sessionId], { rows: [{ startsAt: start, repeat: "weekly", count: "forever" }] })).status).toBe(200);
    const q = await pending(j.sessionId);
    expect(q.rows).toEqual([{ startsAt: start, repeat: "weekly", count: 0 }]);
    // Its words: how many calls it covers, until the end.
    expect(describeRows(pageRows(q, end))).toMatch(new RegExp(`· ${fit} calls from .+ until testers' work ends \\(${fmtDateIn(end, "UTC").replace(/, \d{4}$/, "")}\\)$`));
    const a = await sact(j.sessionId, "answer-request", j.tester.cookie, { requestId: q.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(a.body.calls).toBe(fit);
    const set = await db.callSet.findFirstOrThrow({ where: { contractId: j.sessionId } });
    expect(set.count).toBe(0);
    const booked = () => db.call.count({ where: { setId: set.id, status: "booked" } });
    // The next one would be after the end: none is added, even once the first has passed.
    await topUpForeverSets();
    expect(await booked()).toBe(fit);
    const first = await db.call.findFirstOrThrow({ where: { setId: set.id }, orderBy: { startsAt: "asc" } });
    await db.call.update({ where: { id: first.id }, data: { startsAt: new Date(Date.now() - HOUR) } });
    await topUpForeverSets();
    expect(await booked()).toBe(fit);
    expect(await db.call.count({ where: { setId: set.id, startsAt: { gt: end } } })).toBe(0);
    expect((await db.callSet.findUniqueOrThrow({ where: { id: set.id } })).status).toBe("active");
    // Open until moves 2 weeks later: the set goes on up to the new end (4 ahead again, none after it).
    const t = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
    await db.test.update({ where: { id: s.testId }, data: { openUntil: new Date(t.openUntil!.getTime() + 14 * DAY) } });
    await topUpForeverSets();
    const newEnd = (await workEndOf(db, s.testId))!;
    const ahead = await db.call.count({ where: { setId: set.id, status: "booked", startsAt: { gt: new Date() } } });
    expect(ahead).toBe(Math.min(4, callsUntil(new Date(start), "weekly", newEnd) - 1));
    expect(ahead).toBeGreaterThan(fit - 1);
    expect(await db.call.count({ where: { setId: set.id, startsAt: { gt: newEnd } } })).toBe(0);
  });

  it("Accept: a time now less than the lead away, or after the end, can't be booked and says why; an older set past the end books only the calls before it", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const end = (await workEndOf(db, s.testId))!;
    const accept = (id: string) => sact(j.sessionId, "answer-request", j.tester.cookie, { requestId: id, action: "accept", seenAt: seen(), confirmed: true });
    // Sent 3 hours ahead; now it's 30 seconds away (the lead here is 1 minute).
    expect((await devReq(s.testId, s.dev.cookie, [j.sessionId], once(atHours(3)))).status).toBe(200);
    const soon = await pending(j.sessionId);
    const at = new Date(Date.now() + 30_000);
    await moveRequest(soon.id, at);
    expect((await accept(soon.id)).body.error).toMatchObject({ code: "too_soon", message: `${fmtDateTimeIn(at, "UTC")} is less than 1 minute from now, so it can't be booked any more. Request a later time instead.` });
    // Sent before this rule, for after the end.
    expect((await devReq(s.testId, s.dev.cookie, [j.sessionId], once(atHours(5)))).status).toBe(200);
    const after = await pending(j.sessionId);
    const later = minuteOf(new Date(end.getTime() + 2 * DAY));
    await moveRequest(after.id, later);
    expect((await accept(after.id)).body.error).toMatchObject({ code: "after_end", message: `${fmtDateTimeIn(later, "UTC")} is after testers' work on this test ends (${fmtDateTimeIn(end, "UTC")}), so it can't be booked.` });
    expect(await db.call.count({ where: { contractId: j.sessionId } })).toBe(0);
    // An older weekly ×8 (sent before this rule): only the calls before the end are booked.
    const start = new Date(atHours(72));
    const old = await db.callRequest.create({ data: { testId: s.testId, contractId: j.sessionId, fromSide: "developer", startsAt: start, times: [start], weeks: 8, repeat: "weekly", rows: [{ startsAt: start.toISOString(), repeat: "weekly", count: 8 }], minutes: 30 } });
    const fit = callsUntil(start, "weekly", end);
    expect(describeRows(pageRows(old, end))).toContain(`· ${fit} calls from `);
    expect((await accept(old.id)).body).toMatchObject({ booked: true, calls: fit });
    expect(await db.call.count({ where: { contractId: j.sessionId, status: "booked", startsAt: { gt: end } } })).toBe(0);
    expect(await db.callSet.findFirstOrThrow({ where: { contractId: j.sessionId } })).toMatchObject({ count: fit });
    expect(await db.notification.count({ where: { userId: s.dev.user.id, text: { startsWith: `Booked: ${fit} weekly calls from` } } })).toBe(1);
  });
});

describe("§132 the forms offer only what's inside the window, and follow it live", () => {
  const endAt = "2026-11-20T23:59:59.000Z";
  const end: CallEnd = { at: endAt, text: "Fri, Nov 20, 11:59 PM", day: "Nov 20" };
  const row = (when: string, repeat: RowState["repeat"], count = "8"): RowState => ({ when, repeat, count });

  it("the time box: earliest now + the lead (rounded up to the minute), latest the end's minute, each with its line", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T10:00:30.000Z")); // the tests' clock is UTC
    expect(localNow(1440)).toBe("2026-11-03T10:01");
    expect(localNow(1)).toBe("2026-11-02T10:02");
    expect(localNow(0, true)).toBe("2026-11-02");
    expect(localValue(new Date(endAt))).toBe("2026-11-20T23:59");
    vi.useRealTimers();
    const html = unescape(render(h(RequestRows, { rows: [row("", "once")], setRows: () => {}, minNow: "2026-11-03T10:01", leadMinutes: 1440, end })));
    expect(html).toContain('min="2026-11-03T10:01"');
    expect(html).toContain(`data-end="${endAt}"`);
    expect(html).toContain('data-msg="Pick a time at least 24 hours from now."');
    expect(html).toContain(`data-max-msg="Pick a time before Fri, Nov 20, 11:59 PM (when testers' work on this test ends)."`);
    // Without the window (an older page): the plain line, no latest time.
    const plain = unescape(render(h(RequestRows, { rows: [row("", "once")], setRows: () => {}, minNow: "" })));
    expect(plain).toContain('data-msg="Pick a time in the future."');
    expect(plain).not.toContain("data-max-msg");
  });

  it("the calls drop-down lists only the counts that fit before the end; Forever reads until testers' work ends; a repeat that can't fit twice isn't offered, saying why", () => {
    // Weekly from Thu, Nov 5 3:00 PM: Nov 5, 12, 19 fit (Nov 26 is after the end).
    const weekly = rowOffer(row("2026-11-05T15:00", "weekly"), end);
    expect(weekly.counts).toEqual([2, 3]);
    expect(weekly.shown).toMatchObject({ repeat: "weekly", count: "3" });
    expect(weekly.last).toBe("Until testers' work ends (Nov 20)");
    expect(weekly.offLine).toBe("");
    const html = unescape(render(h(RequestRows, { rows: [row("2026-11-05T15:00", "weekly")], setRows: () => {}, minNow: "", leadMinutes: 1, end })));
    // (Owner, Nov 3) Every count that fits, in weeks (or days) with the last call's day; no separate "until testers' work ends" choice when there's an end.
    expect(html).toContain('<option value="2">2 weeks (to Nov 12)</option><option value="3" selected="">3 weeks (to Nov 19)</option></select>'); // the 8 picked shows as 3
    expect(html).not.toContain('<option value="4">');
    expect(html).not.toContain('<option value="forever">');
    // What's sent is what's shown: 3, not the 8 that was picked before the time was.
    expect(rowsPayload([row("2026-11-05T15:00", "weekly")], end)).toEqual([{ startsAt: "2026-11-05T15:00:00.000Z", repeat: "weekly", count: 3 }]);
    expect(rowsPayload([row("2026-11-05T15:00", "weekly", "forever")], end)[0].count).toBe(3); // an older "forever" row: the most that fit
    // 4 days before the end: Daily fits (up to 5), Weekly doesn't.
    const near = rowOffer(row("2026-11-16T15:00", "weekly"), end);
    expect(near).toMatchObject({ daily: true, weekly: false, offLine: "Weekly isn't offered: only one call fits before testers' work ends (Nov 20)." });
    expect(near.shown.repeat).toBe("once");
    expect(rowOffer(row("2026-11-16T15:00", "daily"), end).counts).toEqual([2, 3, 4, 5]);
    // (Owner, Nov 3) All that fit, past 8: Daily from Nov 5 lists 2 to 16 days.
    expect(rowOffer(row("2026-11-05T15:00", "daily"), end).counts).toEqual(Array.from({ length: 15 }, (_, i) => i + 2));
    const nearHtml = unescape(render(h(RequestRows, { rows: [row("2026-11-16T15:00", "weekly")], setRows: () => {}, minNow: "", end })));
    expect(nearHtml).toContain('<option value="weekly" disabled="">Weekly</option>');
    expect(nearHtml).toContain('data-repeat-off=""');
    expect(nearHtml).not.toContain('aria-label="How many calls 1"');
    // The last day: neither repeats.
    expect(rowOffer(row("2026-11-20T09:00", "daily"), end)).toMatchObject({ daily: false, weekly: false, offLine: "Daily and Weekly aren't offered: only one call fits before testers' work ends (Nov 20)." });
    // A row without a time, or one after the end (its box is red), offers everything; no end: "Forever".
    expect(rowOffer(row("", "weekly"), end).counts).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(rowOffer(row("2026-11-25T09:00", "weekly"), end)).toMatchObject({ weekly: true, offLine: "" });
    expect(rowOffer(row("2026-11-05T15:00", "weekly"), null).last).toBe("Forever");
    // The typed choice is kept: moving the time earlier brings the 8 back.
    expect(fitRow(row("2026-10-01T15:00", "weekly"), new Date(endAt)).count).toBe("8");
    expect(repeatChoices(new Date("2026-11-05T15:00:00Z"), "weekly", new Date(endAt)).fit).toBe(3);
  });

  it("both pages pass the server's lead and the end (the reader's words) to the form", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const end = (await workEndOf(db, s.testId))!;
    auth.user = await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } });
    const { default: TestPage } = await import("@/app/app/tests/[id]/page");
    auth.user = await db.user.update({ where: { id: s.dev.user.id }, data: { timeZone: "Asia/Tokyo" } });
    const devHtml = unescape(render(await TestPage({ params: Promise.resolve({ id: s.testId }), searchParams: Promise.resolve({}) })));
    expect(devHtml).toContain(`data-end="${end.toISOString()}"`);
    expect(devHtml).toContain('data-msg="Pick a time at least 1 minute from now."');
    expect(devHtml).toContain(`data-max-msg="${beforeEndLine(fmtDateTimeIn(end, "Asia/Tokyo"))}"`);
    auth.user = await db.user.findUniqueOrThrow({ where: { id: j.tester.user.id } });
    const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
    const testerHtml = unescape(render(await SessionPage({ params: Promise.resolve({ id: j.sessionId }) })));
    expect(testerHtml).toContain(`data-end="${end.toISOString()}"`);
    expect(testerHtml).toContain(`data-max-msg="${beforeEndLine(fmtDateTimeIn(end, "UTC"))}"`);
  });

  it("the poll's fingerprint changes when the work end moves (Open until later, a later deadline), so both pages redraw the forms' limits on the normal poll", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const devV = () => testV(s.dev.user.id, s.testId);
    const testerV = () => testV(j.tester.user.id, s.testId, j.sessionId);
    const [d1, t1] = [await devV(), await testerV()];
    expect(await devV()).toBe(d1); // nothing moved: the same
    const t = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
    await db.test.update({ where: { id: s.testId }, data: { openUntil: new Date(t.openUntil!.getTime() + 3 * DAY) } }); // no test event
    const [d2, t2] = [await devV(), await testerV()];
    expect(d2).not.toBe(d1);
    expect(t2).not.toBe(t1);
    // A tester's deadline later than everything else (a tester joining later, a pause lifted).
    await db.contract.update({ where: { id: j.sessionId }, data: { dueAt: new Date(t.openUntil!.getTime() + 5 * DAY) } });
    expect(await devV()).not.toBe(d2);
    expect(await testerV()).not.toBe(t2);
  });

  it("the requests panel: a waiting time less than the lead away loses its Accept and says why (Decline stays)", () => {
    const panel = (leadMinutes: number) => unescape(render(h(CallRequestsPanel, {
      side: "tester", seenAt: new Date().toISOString(), path: () => "/api/sessions/x", leadMinutes, panelId: "call-requests-x",
      requests: [{ id: "r1", contractId: "c1", tester: "You", asker: "Nora Lane", rows: [{ startsAt: new Date(Date.now() + 2 * HOUR).toISOString(), repeat: "once", count: 1 }], minutes: 30, mine: false, rate: "Contract $30/h" }],
    })));
    const live = panel(1440);
    expect(live).not.toContain(">Accept<");
    expect(live).toContain(">Decline<");
    expect(live).toContain(tooSoonNote(1440));
    expect(tooSoonNote(1440)).toBe("Less than 24 hours away now: it can't be booked any more.");
    const local = panel(1);
    expect(local).toContain(">Accept<");
    expect(local).not.toContain("data-too-soon");
  });
});

describe("§132 the Terms of Use say when a call can be booked", () => {
  it("section 7 states the window (in version 2's What changed) and nothing says a call can be booked after a deadline", async () => {
    expect(CALL_WINDOW_TERMS).toBe("A call can be booked at least 24 hours ahead, and no later than when testers' work on the test ends (the latest tester's deadline, or Open until if later); daily and weekly calls stop there.");
    expect(TERMS_VERSION).toBe(2);
    const v2 = WHAT_CHANGED.find((w) => w.version === 2)!;
    expect(v2.points).toContain("A call can be booked at least 24 hours ahead, and no later than when testers' work on the test ends (the latest tester's deadline, or Open until if later); daily and weekly calls stop there (section 7).");
    const { default: TermsPage } = await import("@/app/terms/page");
    const page = TermsPage() as React.ReactElement<{ children: React.ReactNode }>;
    const html = unescape(render(h(React.Fragment, null, page.props.children)));
    const calls = html.slice(html.indexOf("7. Calls and recordings"), html.indexOf("8. The service"));
    expect(calls).toContain(CALL_WINDOW_TERMS);
    expect(html).not.toMatch(/booked (any time|after (a|the|their|the tester's) deadline)/i);
  });
});
