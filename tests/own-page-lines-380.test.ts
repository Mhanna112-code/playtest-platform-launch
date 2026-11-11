import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { GET as liveGET } from "@/app/api/live/route";
import { sessionScope, testScope } from "@/lib/pageClaim";
import { json, makeUser, req } from "./helpers";
import { act, atHours, bookCall, joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 11, §380) One page at a time: the test page (with Edit) and the session page are each the only copy that can press, so the person's own actions
// made on that page are never "You … in another tab" lines there (live box or stop box). Their own actions on pages OUTSIDE the claim (the dashboard, Payments,
// the join page) can still race it: those lines stay.

const later = () => new Promise((r) => setTimeout(r, 30));
const texts = (r: { body: { error?: { changes?: { text: string }[] } } }) => (r.body.error?.changes ?? []).map((c) => c.text);
const live = (cookie: string, scope: string, since: string, tab: string, page = true) =>
  later().then(() => liveGET(req(`/api/live?scope=${encodeURIComponent(scope)}&since=${encodeURIComponent(since)}`, { cookie, headers: { "x-tab": tab, ...(page ? { "x-page": scope } : {}) } }))).then(json).then((r) => (r.body.changes as { text: string }[]).map((c) => c.text));

describe("§380 own actions on the one page are never 'in another tab' there", () => {
  it("session page: what an older copy sent never stops or shows on the newest copy; the join page's own lines still do", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const page = sessionScope(sessionId);
    await later();
    const loaded = seen();
    await later();
    // The older copy (tab-1, before it learned it moved) sent the written answers.
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: loaded, tab: "tab-1", pageScope: page })).status).toBe(200);
    expect(await live(tester.cookie, page, loaded, "tab-2")).not.toContain("You sent your written answers in another tab");
    // Its request goes through on the first press: no "You sent your written answers in another tab".
    const r = await sact(sessionId, "request-time", tester.cookie, { startsAt: atHours(60), seenAt: loaded, tab: "tab-2", pageScope: page });
    expect(r.body.error?.code).not.toBe("stop_once");
    expect(r.status).toBe(200);
    // A page outside the claim (the join page reads her session actions too) still lists them.
    expect(await live(tester.cookie, `listing:${testId}`, loaded, "tab-join", false)).toContain("You sent your written answers in another tab");
  });

  it("test page: a Pay from Edit's tab or an older copy never stops Stop; a Cancel call from the dashboard still does", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 72);
    const page = testScope(testId);
    await later();
    const loaded = seen();
    await later();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    // Pay pressed on the test page (an older copy, or Edit's tab before Edit was opened there): never a line on the test page.
    const pay = await json(await reviewPOST(req("/api/review", { cookie: dev.cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, tab: "tab-old", pageScope: page } })));
    expect(pay.status).toBe(200);
    expect(await live(dev.cookie, page, loaded, "tab-new")).not.toContain("You paid Ana Silva $10.00 for the written answers in another tab");
    // Cancel call on the dashboard (outside the claim): still a line, and it still stops a press on the test page once.
    expect((await act(testId, "cancel-call", dev.cookie, { callId: call.id, reason: "Something came up.", seenAt: seen(), confirmed: true, tab: "tab-dashboard" })).status).toBe(200);
    const lines = await live(dev.cookie, page, loaded, "tab-new");
    expect(lines.some((l) => /^You cancelled the call with Ana Silva on .* in another tab$/.test(l))).toBe(true);
    expect(lines).not.toContain("You paid Ana Silva $10.00 for the written answers in another tab");
    const stop = await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: loaded, tab: "tab-new", pageScope: page });
    expect(stop.body.error.code).toBe("stop_once");
    expect(texts(stop).filter((t) => t.startsWith("You "))).toEqual([expect.stringMatching(/^You cancelled the call with Ana Silva on .* in another tab$/)]);
  });

  it("test page: an Edit Save is never 'You saved the listing in another tab' on the test page", async () => {
    const { dev, testId } = await setup();
    const page = testScope(testId);
    await later();
    const loaded = seen();
    await later();
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const save = await act(testId, "edit", dev.cookie, { version: t.version, fields: { title: "Harbor Run 2", description: "Sail on" }, seenAt: seen(), tab: "tab-edit", pageScope: page });
    expect(save.status).toBe(200);
    const lines = await live(dev.cookie, page, loaded, "tab-page");
    expect(lines.filter((l) => l.startsWith("You "))).toEqual([]);
    // Without the page (an old page from before §380): the line is still there, as before.
    expect((await live(dev.cookie, page, loaded, "tab-page", false)).some((l) => l.startsWith("You saved the listing in another tab"))).toBe(true);
  });

  it("an already-paid piece from the same page is the plain refusal, never 'in another tab'", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const page = testScope(testId);
    const body = { seenAt: seen(), confirmed: true, kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, pageScope: page };
    expect((await json(await reviewPOST(req("/api/review", { cookie: dev.cookie, body: { ...body, payKey: randomUUID(), tab: "tab-old" } })))).status).toBe(200);
    const again = await json(await reviewPOST(req("/api/review", { cookie: dev.cookie, body: { ...body, payKey: randomUUID(), tab: "tab-new" } })));
    expect(again.status).toBe(409);
    expect(again.body.error.message).not.toMatch(/in another tab/);
    void makeUser;
  });
});
