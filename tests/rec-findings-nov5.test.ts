import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as verifyPOST } from "@/app/api/payments/verify-card/route";
import { MENU_EDGE, menuLeft } from "@/components/AlertsMenu";
import { lostRefusal, requestOfPress, requestPressName } from "@/components/CallRequestsPanel";
import { CARD_CHECK_CANCELLED } from "@/lib/bankNotice";
import { currentKept, dropKept, keepRefusal, resetKept } from "@/lib/keptRefusal";
import { publishShownVersion, setVersionSource, watchNewPageVersion } from "@/lib/pageVersion";
import { refusalLine } from "@/lib/pressLabels";
import { liftMomentLine } from "@/lib/rules";
import { chargebackOpened } from "@/lib/server/holds";
import { pauseTest, unpauseTest } from "@/lib/server/restrictions";
import { json, makeUser, req } from "./helpers";
import { act, atHours, joined, sact, seen, settle, setup } from "./fixtures";
import { sentWork } from "./b15";

// (Owner, Nov 5, batch 35 §207) Fixes from the Nov 5 recordings (and three from Nov 4's): the Alerts menu stays on the screen; the team lifting its pause is
// named like the pause; an Accept on a withdrawn request keeps its refusal; Verify a card's own Cancel reads as a cancel. (The bank window that closed by itself
// when its check was cancelled underneath it: tests/batch35-stop-rules-v2.test.ts, "§207".)

const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");
const texts = (r: { body: { error?: { changes?: { text: string }[] } } }) => (r.body.error?.changes ?? []).map((c) => c.text);
async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a.user.id;
}

describe("§207 1: the Alerts menu opens inside the screen wherever its button sits", () => {
  const W = 288; // w-72
  it("right edges together when there's room on the left (as before)", () => {
    // 1280: the button at the top right of the test's header.
    expect(menuLeft({ left: 718, right: 807 }, W, 1280)).toBe(807 - W - 718);
  });
  it("left edges together when the button sits near the left (it hung past the left edge there)", () => {
    // 768 (and the recording's desktop page, where the header's buttons wrapped under the title): the button at x 120-210.
    expect(menuLeft({ left: 120, right: 210 }, W, 768)).toBe(0);
    expect(menuLeft({ left: 40, right: 130 }, W, 1280)).toBe(0);
  });
  it("slid in from whichever edge it would cross, keeping its gap from the edges", () => {
    // Too little room on either side: kept MENU_EDGE from the left, never past it.
    const x = menuLeft({ left: 100, right: 190 }, W, 400);
    expect(100 + x).toBeGreaterThanOrEqual(MENU_EDGE);
    expect(100 + x + W).toBeLessThanOrEqual(400 - MENU_EDGE);
    // A button running off the right: pulled back in.
    const y = menuLeft({ left: 1200, right: 1290 }, W, 1280);
    expect(1200 + y + W).toBeLessThanOrEqual(1280 - MENU_EDGE);
  });
  it("placed from the button when it opens and when the window changes size; phones keep it in the page (static, full width)", () => {
    const m = src("components/AlertsMenu.tsx");
    expect(m).toContain("onToggle={place}");
    expect(m).toContain('window.addEventListener("resize", place)');
    expect(m).toContain("style={left == null ? undefined : { left, right: \"auto\" }}");
    expect(m).toContain("max-sm:static max-sm:w-full");
    expect(m).toContain("window.innerWidth < MENU_STATIC_BELOW");
  });
});

describe("§207 2: the team lifting its pause is named like the pause", () => {
  it("the lines", () => {
    const at = new Date("2026-11-05T09:08:55Z");
    const t = () => "3:08 AM", dt = () => "Thu, Nov 5, 3:08 AM";
    expect(liftMomentLine("developer", at, t, dt, at)).toBe("The team lifted its pause on this test at 3:08 AM.");
    expect(liftMomentLine("tester", at, t, dt, at)).toBe("This test resumed at 3:08 AM.");
  });

  it("developer (the R4b recording): Stop stops once for the pause; after the lift, the next press stops once naming the lift; the press after goes ahead", async () => {
    const { dev, testId } = await setup();
    await joined(testId, "Ana Silva");
    const loaded = seen();
    await settle();
    await pauseTest(await admin(), testId, "Checking reports about this build.");
    await settle();
    const first = await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(texts(first)).toEqual([expect.stringMatching(/^The team paused this test at .+\.$/)]);
    await settle();
    await unpauseTest(testId);
    await settle();
    const second = await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: loaded, confirmed: true, boxAt: first.body.error!.now });
    expect(second.body.error?.code, JSON.stringify(second.body)).toBe("stop_once");
    expect(texts(second)).toEqual([expect.stringMatching(/^The team lifted its pause on this test at .+\.$/)]);
    const third = await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: loaded, confirmed: true, boxAt: second.body.error!.now });
    expect(third.status, JSON.stringify(third.body)).toBe(200);
  });

  it("developer: a page from before both the pause and its lift names both, oldest first; a page drawn after the lift names neither", async () => {
    const { dev, testId } = await setup();
    const b = await joined(testId, "Ben Okafor", "he");
    const loaded = seen();
    await settle();
    await pauseTest(await admin(), testId, "Checking");
    await settle();
    await unpauseTest(testId);
    await settle();
    const r = await act(testId, "end-early", dev.cookie, { contractIds: [b.sessionId], reason: "We have enough", seenAt: loaded });
    expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
    expect(texts(r)).toEqual([expect.stringMatching(/^The team paused this test at /), expect.stringMatching(/^The team lifted its pause on this test at /)]);
    expect(texts(r).join(" ")).not.toMatch(/hold|suspended/);
    const after = seen();
    await settle();
    expect((await act(testId, "end-early", dev.cookie, { contractIds: [b.sessionId], reason: "We have enough", seenAt: after })).status).toBe(200);
  });

  it("tester: Request a time works on the first press after a pause is lifted", async () => {
    const { testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    await pauseTest(await admin(), testId, "Checking");
    await settle();
    const loaded = seen();
    await settle();
    await unpauseTest(testId);
    await settle();
    const body = { seenAt: loaded, pageSeenAt: loaded, times: [atHours(72)] };
    const r = await sact(a.sessionId, "request-time", a.tester.cookie, body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it("tester: a page drawn before the pause can request a time on the first press after the lift", async () => {
    const { testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const loaded = seen();
    await settle();
    await pauseTest(await admin(), testId, "Checking");
    await settle();
    await unpauseTest(testId);
    await settle();
    const r = await sact(a.sessionId, "request-time", a.tester.cookie, { seenAt: loaded, pageSeenAt: loaded, times: [atHours(72)] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});

describe("§207 3: Accept on a withdrawn request from an older page shows its refusal, and keeps it after the redraw", () => {
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  const cleanups: (() => void)[] = [];
  beforeEach(() => resetKept());
  afterEach(() => { cleanups.splice(0).reverse().forEach((f) => f()); resetKept(); });

  it("the server's single refusal (no stop first), named: \"Your Accept didn't go through: Ana Silva withdrew this request.\"", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const loaded = seen();
    expect((await sact(a.sessionId, "request-time", a.tester.cookie, { seenAt: seen(), confirmed: true, times: [atHours(72)] })).status).toBe(200);
    const q = await db.callRequest.findFirstOrThrow({ where: { contractId: a.sessionId, status: "pending" } });
    expect((await sact(a.sessionId, "answer-request", a.tester.cookie, { requestId: q.id, action: "withdraw", seenAt: seen(), confirmed: true })).status).toBe(200);
    const r = await act(testId, "answer-request", dev.cookie, { requestId: q.id, contractId: a.sessionId, action: "accept", seenAt: loaded });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "gone", message: "Ana Silva withdrew this request." });
    expect(refusalLine(requestPressName(`a-${q.id}@x`), r.body.error.message)).toBe("Your Accept didn't go through: Ana Silva withdrew this request.");
  });

  it("the panel keeps the line above its people once the redraw took the request's row away (both sides use the panel)", () => {
    expect(requestOfPress("a-req1@2026-11-08T16:00:00.000Z")).toBe("req1");
    expect(requestOfPress("w-req2")).toBe("req2");
    expect(requestOfPress("")).toBe("");
    expect(lostRefusal("a-req1@t", "Ana Silva withdrew this request.", [{ id: "req2" }])).toBe(true);
    expect(lostRefusal("a-req1@t", "Ana Silva withdrew this request.", [{ id: "req1" }])).toBe(false); // still in its row
    expect(lostRefusal("a-req1@t", "", [])).toBe(false);
    const panel = src("components/CallRequestsPanel.tsx");
    // (Owner, Nov 5, §228 fix) On the page's own list: a request the page dropped stays drawn for its 6 s, but its refusal is at the top at once.
    expect(panel).toContain("const lost = lostRefusal(at, error, live.filter((r) => !closing.left(r.id)));");
    expect(panel).toContain('{lost && <div data-request-refusal=""><ChangesBox side={side} changes={null} error={error} press={requestPressName(at)} /></div>}');
  });

  it("the refusal's own redraw never takes the line away, even when the page's version couldn't be read at that moment (the recording's older page)", async () => {
    const query = "test=rec207";
    publishShownVersion(query, "before-the-withdrawal");
    cleanups.push(setVersionSource(query, async () => { throw new Error("offline"); }));
    const k = keepRefusal("Accept", "Ana Silva withdrew this request.")!;
    cleanups.push(watchNewPageVersion(() => dropKept(k.id)));
    await flush();
    publishShownVersion(query, "after-the-withdrawal"); // the refused press's own redraw
    expect(currentKept()).toBe(k);
    expect(k.text).toBe("Your Accept didn't go through: Ana Silva withdrew this request.");
    publishShownVersion(query, "after-the-withdrawal");
    expect(currentKept()).toBe(k);
    publishShownVersion(query, "something-else-changed"); // the next version: gone (§116)
    expect(currentKept()).toBeNull();
  });

  it("a version read at the refusal still works as before (its own redraw keeps it, the next drops it)", async () => {
    const query = "test=rec207-read";
    publishShownVersion(query, "v0");
    cleanups.push(setVersionSource(query, async () => "v1"));
    const k = keepRefusal("Accept", "Ana Silva withdrew this request.")!;
    cleanups.push(watchNewPageVersion(() => dropKept(k.id)));
    await flush();
    publishShownVersion(query, "v1");
    expect(currentKept()).toBe(k);
    publishShownVersion(query, "v2");
    expect(currentKept()).toBeNull();
  });
});

describe("§207 4: Verify a card's own Cancel reads as a cancel", () => {
  const verify = (cookie: string, body: Record<string, unknown>) => verifyPOST(req("/api/payments/verify-card", { cookie, body })).then(json);

  it("the developer's Cancel under the window: \"Cancelled: your card wasn't changed.\", not a refusal; the bank's own refusal still is one", async () => {
    const { dev, sessionId, tester, sub } = await sentWork();
    const pi = "pi_" + randomUUID();
    await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 160, testerCents: 640, status: "charged", stripePaymentIntentId: pi } });
    expect(await chargebackOpened(pi)).toBe(true);
    expect((await verify(dev.cookie, { check: true })).body.standIn).toBe(true);
    const cancelled = await verify(dev.cookie, { finish: true, cancel: true, pressedCancel: true, simulate: "failed" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toEqual({ verified: false, cancelled: true, line: CARD_CHECK_CANCELLED });
    expect(CARD_CHECK_CANCELLED).toBe("Cancelled: your card wasn't changed.");
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).chargebackCardVerifiedAt).toBeNull();
    // Not pressed (the bank's answer, the peek, leaving the page): still the refusal.
    const refused = await verify(dev.cookie, { finish: true, cancel: true, simulate: "failed" });
    expect(refused.body.error).toMatchObject({ code: "not_verified" });
    // A Cancel when the check had gone through: verified as before.
    expect((await verify(dev.cookie, { finish: true, cancel: true, pressedCancel: true, simulate: "succeeded" })).body).toEqual({ verified: true });
  });

  it("the window's Cancel (and the stand-in's) tells the finish it was the developer's; the steps box shows the plain line", () => {
    const box = src("components/BankCheck.tsx");
    expect(box).toContain('onClick={() => end(undefined, true)} data-bank-close=""');
    expect(box).toContain('onClick={() => end("failed", true)} data-bank-cancel=""');
    expect(box).toContain("onEnd({ ok: true, value: await finish(simulate, cancel) });");
    const steps = src("components/ChargebackSteps.tsx");
    expect(steps).toContain("...(cancel ? { pressedCancel: true } : {})");
    expect(steps).toContain("if (r?.cancelled) throw new CardCheckCancelled();");
    expect(steps).toContain('{cancelled && !fin.line && <p className="ok" data-card-check-cancelled="">{cancelled}</p>}');
  });
});
