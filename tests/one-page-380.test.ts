import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as claimPOST } from "@/app/api/page-claim/route";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { POST as testAction } from "@/app/api/tests/[id]/[action]/route";
import { POST as sessionAction } from "@/app/api/sessions/[id]/[action]/route";
import { createSession, SESSION_COOKIE } from "@/lib/server/session";
import { PAGE_MOVED_CODE, PAGE_MOVED_LINE, sessionScope, testScope } from "@/lib/pageClaim";
import { json, makeUser, req } from "./helpers";
import { atHours, joined, seen, setup } from "./fixtures";

// (Owner, Nov 11, §380) One page at a time, across devices: the test page and its Edit are ONE page per test, the session page one per session. The newest copy
// claims it; an older copy is told on its poll (and goes to the dashboard), and its presses are refused with the one line.

const claim = (cookie: string, scope: string, tab: string) => claimPOST(req("/api/page-claim", { cookie, body: { scope }, headers: { "x-tab": tab } })).then(json);
const pulse = (cookie: string, query: string, scope: string, tab: string) => pulseGET(req(`/api/pulse?${query}`, { cookie, headers: { "x-tab": tab, "x-page": scope } })).then(json);
const act = (id: string, action: string, cookie: string, body: Record<string, unknown>, tab: string, scope?: string) =>
  testAction(req(`/api/tests/${id}/${action}`, { cookie, body, headers: { "x-tab": tab, ...(scope ? { "x-page": scope } : {}) } }), { params: Promise.resolve({ id, action }) }).then(json);
const sact = (id: string, action: string, cookie: string, body: Record<string, unknown>, tab: string, scope?: string) =>
  sessionAction(req(`/api/sessions/${id}/${action}`, { cookie, body, headers: { "x-tab": tab, ...(scope ? { "x-page": scope } : {}) } }), { params: Promise.resolve({ id, action }) }).then(json);

describe("§380 one page at a time", () => {
  it("developer: the test page in one tab, then Edit in another: the older copy is told it moved and its press is refused with the one line", async () => {
    const { dev, testId } = await setup();
    const scope = testScope(testId);
    expect((await claim(dev.cookie, scope, "tab-page")).status).toBe(200);
    // Its own poll: still its page.
    expect((await pulse(dev.cookie, `test=${testId}`, scope, "tab-page")).body.moved).toBeUndefined();
    // Edit opened in a second tab claims the same page.
    expect((await claim(dev.cookie, scope, "tab-edit")).status).toBe(200);
    expect((await pulse(dev.cookie, `test=${testId}`, scope, "tab-page")).body.moved).toBe(true);
    expect((await pulse(dev.cookie, `test=${testId}`, scope, "tab-edit")).body.moved).toBeUndefined();
    // The older copy's press: refused with the one line, nothing done.
    const r = await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen() }, "tab-page", scope);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe(PAGE_MOVED_CODE);
    expect(r.body.error.message).toBe(PAGE_MOVED_LINE);
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).status).toBe("open");
    // The newest copy's press goes ahead.
    expect((await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen() }, "tab-edit", scope)).status).toBe(200);
    // Opening the older copy again (a reload, Back) claims it back: newest wins again.
    expect((await claim(dev.cookie, scope, "tab-page")).status).toBe(200);
    expect((await pulse(dev.cookie, `test=${testId}`, scope, "tab-edit")).body.moved).toBe(true);
  });

  it("tester: the session page on two devices (two sign-ins): the older device is told it moved and its press is refused", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const { token } = await createSession(tester.user.id);
    const phone = `${SESSION_COOKIE}=${token}`;
    const scope = sessionScope(sessionId);
    expect((await claim(tester.cookie, scope, "laptop")).status).toBe(200);
    expect((await claim(phone, scope, "phone")).status).toBe(200);
    expect((await pulse(tester.cookie, `session=${sessionId}`, scope, "laptop")).body.moved).toBe(true);
    expect((await pulse(phone, `session=${sessionId}`, scope, "phone")).body.moved).toBeUndefined();
    const r = await sact(sessionId, "request-time", tester.cookie, { startsAt: atHours(50), seenAt: seen() }, "laptop", scope);
    expect(r.body.error.code).toBe(PAGE_MOVED_CODE);
    expect(r.body.error.message).toBe(PAGE_MOVED_LINE);
    expect(await db.callRequest.count({ where: { contractId: sessionId } })).toBe(0);
    expect((await sact(sessionId, "request-time", phone, { startsAt: atHours(50), seenAt: seen() }, "phone", scope)).status).toBe(200);
  });

  it("pages are separate: another test's page, a page outside the claim (no x-page) and a page nobody claimed are never refused", async () => {
    const { dev, testId } = await setup();
    const other = await setup();
    await claim(dev.cookie, testScope(testId), "tab-a");
    // Another test's page in another tab: its own claim.
    const devB = other.dev;
    expect((await claim(devB.cookie, testScope(other.testId), "tab-b")).status).toBe(200);
    expect((await pulse(dev.cookie, `test=${testId}`, testScope(testId), "tab-a")).body.moved).toBeUndefined();
    // A press that names no page (the dashboard, Payments, a profile) is never checked against a claim.
    expect((await act(testId, "invite-search", dev.cookie, { q: "" }, "tab-dashboard")).status).toBe(200);
    // Nobody claimed this one yet (a page from before §380, or the claim still on its way): it goes ahead.
    const third = await setup();
    expect((await act(third.testId, "invite-search", third.dev.cookie, { q: "" }, "tab-x", testScope(third.testId))).status).toBe(200);
  });

  it("only the test's developer or the session's tester can claim it", async () => {
    const { testId } = await setup();
    const { sessionId } = await joined(testId);
    const stranger = await makeUser({ dev: true, tester: true, name: "Sam Stone" });
    expect((await claim(stranger.cookie, testScope(testId), "t")).status).toBe(404);
    expect((await claim(stranger.cookie, sessionScope(sessionId), "t")).status).toBe(404);
    expect((await claim(stranger.cookie, "admin:x", "t")).status).toBe(400);
  });
});

describe("§380 an older copy leaves", () => {
  it("disables every button and field and goes to the dashboard, once", async () => {
    const { leaveMovedPage, resetMovedPage, pageScope, setPageScope } = await import("@/lib/client");
    const { PAGE_MOVED_PATH } = await import("@/lib/pageClaim");
    resetMovedPage();
    setPageScope("test:abc");
    const els = [{ disabled: false }, { disabled: false }];
    const attrs: string[] = [];
    const went: string[] = [];
    const w = { document: { querySelectorAll: () => els, querySelector: () => ({ setAttribute: (k: string) => attrs.push(k) }) }, location: { replace: (u: string) => went.push(u) } } as unknown as Window & typeof globalThis;
    expect(leaveMovedPage(w)).toBe(true);
    expect(els.every((e) => e.disabled)).toBe(true);
    expect(attrs).toEqual(["inert"]);
    expect(went).toEqual([PAGE_MOVED_PATH]);
    expect(pageScope()).toBe(""); // its presses no longer name the page
    expect(leaveMovedPage(w)).toBe(false);
    expect(went).toHaveLength(1);
    resetMovedPage();
  });
});
