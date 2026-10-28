import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { closedForSuspended } from "@/lib/closedPages";
import { PAUSED_ALERTS, STOPPED_ALERTS } from "@/lib/alerts";
import { allowedLine, BANNER_TITLES } from "@/app/app/tests/[id]/TestBanner";
import { disputesForSide } from "@/lib/server/disputes";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";
import { pay } from "./b15";

// Batch 15 sections 23, 27, 29, 37 and 39: one rule for every pause; the developer's side of a dispute.
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");
async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);

/** A test with two working testers, a call booked ahead, and a change after the page loaded (Ben joins). */
async function busyTest() {
  const s = await setup();
  const a = await joined(s.testId, "Ana Silva");
  const call = await bookCall(s.testId, s.dev.cookie, a.sessionId, a.tester.cookie, 72);
  const loaded = seen();
  await settle();
  const b = await joined(s.testId, "Ben Okafor");
  return { ...s, a, b, call, loaded };
}

describe("the restricted view (sections 29 and 37)", () => {
  it("test pages open for a restricted developer (Edit and Post stay closed); the banner's title by cause and its allowed line built from what shows", () => {
    const dev = { isDeveloper: true, isTester: false, devSuspendedAt: new Date() };
    expect(closedForSuspended("/app/tests/abc", dev, "developer")).toBe(false);
    expect(closedForSuspended("/app/tests/abc/edit", dev, "developer")).toBe(true);
    expect(closedForSuspended("/app/tests/new", dev, "developer")).toBe(true);
    expect(closedForSuspended("/app/tests/abc", { isDeveloper: true, isTester: false, holdStartedAt: new Date() }, "developer")).toBe(false);
    expect(BANNER_TITLES["team-paused"]).toBe("The team paused this test.");
    expect(BANNER_TITLES.hold).toBe("Your tests are paused until you pay what you owe.");
    expect(BANNER_TITLES.suspended).toBe("Your account is suspended: your tests are paused.");
    expect(BANNER_TITLES.stopped).toBe("This test is stopped.");
    expect(allowedLine(true, { stop: true, endEarly: true, cancelCalls: true })).toBe("For now you can stop this test, end testers' work early, or cancel calls.");
    expect(allowedLine(true, { stop: true })).toBe("For now you can stop this test.");
    expect(allowedLine(false, { nextRound: false })).toBe("You can still pay for work testers already sent, chat with them, rate testers, and read their answers.");
    expect(allowedLine(false, { nextRound: true })).toMatch(/, and start a Next round\.$/);
    expect(src("app/app/tests/[id]/page.tsx")).toContain("<RestrictedCalls testId={t.id}");
    expect(src("app/app/tests/[id]/TopPanel.tsx")).toContain("`Done: you stopped ${p.title}.`");
  });

  it("a suspended developer: Cancel call stops once; End early and Stop go through silently despite a tester's change; other presses are refused", async () => {
    const { dev, testId, a, b, call, loaded } = await busyTest();
    await db.user.update({ where: { id: dev.user.id }, data: { devSuspendedAt: new Date() } });
    expect((await act(testId, "cancel-call", dev.cookie, { callId: call.id, reason: "Can't make it", seenAt: loaded })).body.error.code).toBe("stop_once");
    expect((await act(testId, "next-round", dev.cookie, { seenAt: loaded })).body.error.code).toBe("suspended");
    expect((await act(testId, "end-early", dev.cookie, { contractIds: [b.sessionId], reason: "We have enough", seenAt: loaded })).status).toBe(200);
    expect((await act(testId, "stop", dev.cookie, { seenAt: loaded })).status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).status).toBe("stopped");
    void a;
  });

  it("the team's pause: the same pair goes through silently; any other press is refused and routed to the banner with its failed line", async () => {
    const { dev, testId, b, loaded } = await busyTest();
    await db.test.update({ where: { id: testId }, data: { adminPausedAt: new Date(), adminNote: "Build link is broken" } });
    const e = await act(testId, "edit", dev.cookie, { version: 1, fields: { title: "x" }, seenAt: loaded });
    expect(e.body.error.code).toBe("admin_paused");
    expect(e.body.error.failed).toBe("Your Save on Harbor Run didn't go through");
    expect((await act(testId, "end-early", dev.cookie, { contractIds: [b.sessionId], reason: "Paused anyway", seenAt: loaded })).status).toBe(200);
    expect((await act(testId, "stop", dev.cookie, { seenAt: loaded })).status).toBe(200);
  });

  it("(section 39) a paused test's Alerts list only what can still happen; a stopped one fewer still", () => {
    expect([...PAUSED_ALERTS]).toEqual(["leaving", "calls", "payments", "disputes", "admin", "own"]);
    expect([...STOPPED_ALERTS]).toEqual(["payments", "disputes", "admin", "own"]);
    expect(src("components/AlertsMenu.tsx")).toContain("!keys || keys.includes(a.key)");
  });
});

describe("the developer's side of a dispute (section 27)", () => {
  it("never stops, works while suspended (from the dashboard box), is refused over 2,000; an admin's Decide stops once for a side that arrived after the page loaded", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "5.00", tickedCents: 500, reason: "Half of it" })).status).toBe(200);
    expect((await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered everything in full.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    const adminLoaded = seen();
    await settle();
    await joined(testId, "Ben Okafor"); // a change after the developer's page loaded: never a stop for this press
    await db.user.update({ where: { id: dev.user.id }, data: { devSuspendedAt: new Date() } });
    expect((await disputesForSide(dev.user.id)).map((x) => x.id)).toEqual([d.id]);
    expect((await act(testId, "dispute-side", dev.cookie, { disputeId: d.id, text: "x".repeat(2001), seenAt: adminLoaded })).status).toBe(400);
    expect((await act(testId, "dispute-side", dev.cookie, { disputeId: d.id, text: "They skipped the second question.", seenAt: adminLoaded })).status).toBe(200);
    expect((await act(testId, "dispute-side", dev.cookie, { disputeId: d.id, text: "Again", seenAt: seen() })).body.error.message).toMatch(/^You already/);
    const a = await admin();
    const first = await aact(a.cookie, "decide", { id: d.id, total: "", note: "", seenAt: adminLoaded });
    expect(first.body.error.code).toBe("stop_once");
    expect(first.body.error.changes[0].text).toMatch(/^Nora Lane added their side at .+: read it, then press Decide again\.$/);
    expect((await aact(a.cookie, "decide", { id: d.id, total: "", note: "", seenAt: adminLoaded, confirmed: true })).status).toBe(200);
    expect(src("app/app/page.tsx")).toContain('data-dispute-box=""');
  });
});
