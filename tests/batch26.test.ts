import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { GET as liveGET } from "@/app/api/live/route";
import { POST as alertPOST } from "@/app/api/health/alert/route";
import { ChangesBox } from "@/components/ChangesBox";
import { SetView } from "@/components/AnswerSets";
import { afterSent } from "@/components/GapDialog";
import { requestPressName } from "@/components/CallRequestsPanel";
import { OUTAGE_APPROVE_OVER_MS, SWEEP_LAST_KEY, outageLine, recordAlert, sweepGap } from "@/lib/server/outages";
import { blockUser, callStatus } from "@/lib/server/blocks";
import { adminStopTest } from "@/lib/server/restrictions";
import { testerStopSince, stopBox } from "@/lib/server/stopMoment";
import { confirmStart } from "@/lib/server/confirm";
import { togetherState } from "@/lib/server/invites";
import { devRateLabel, requestGoneLine } from "@/lib/server/requests";
import { adminPage } from "@/lib/server/adminLists";
import { signUp } from "@/lib/server/passwords";
import { finishGoogleSignup } from "@/lib/server/google";
import { decideTerms } from "@/lib/server/terms";
import { ANSWER_ONE, ANSWER_REQUIRED, NOT_REQUIRED, REQUIRED, answersMissing, qOptional, qRequired, qText } from "@/lib/questions";
import { chargeOpensNote, endedLine, stillWorksLine, termsDiff } from "@/lib/rules";
import { endLine } from "@/lib/adminScroll";
import { renderTimes } from "@/lib/tz";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";
import { pay } from "./b15";

// Batch 26 (Oct 29): bugs found by the batch 20-24 recordings, and the owner's additions (13-16).
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const MIN = 60_000, H = 60 * MIN, DAY = 24 * H;
const later = () => new Promise((r) => setTimeout(r, 30));

// ---------- 1. A real outage is always recorded ----------

describe("batch 26 section 1: a real outage is always recorded", () => {
  beforeEach(async () => {
    process.env.OUTAGE_CHECKS = "1";
    process.env.HEALTH_KEY = "b26-health-key";
    await db.outage.deleteMany({});
    await db.appState.deleteMany({ where: { OR: [{ key: { in: ["outage-down", SWEEP_LAST_KEY] } }, { key: { startsWith: "gap:" } }] } });
  });
  afterEach(async () => {
    delete process.env.OUTAGE_CHECKS;
    delete process.env.HEALTH_KEY;
    await db.appState.deleteMany({ where: { key: { in: ["outage-down", SWEEP_LAST_KEY] } } });
  });
  const dueOf = async (sessionId: string) => (await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).dueAt.getTime();
  const working = async () => {
    const { testId } = await setup();
    return (await joined(testId)).sessionId;
  };

  it("an up alert alone (its down lost) records the outage from its duration: the right start and end; the clocks move once", async () => {
    const sessionId = await working();
    const due0 = await dueOf(sessionId);
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    // The webhook as UptimeRobot sends it: alertType 2 (up), alertDateTime, alertDuration in seconds (40 minutes).
    const r = await alertPOST(new Request("http://localhost:3400/api/health/alert?key=b26-health-key", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alertType: "2", alertDateTime: String(Math.round(now.getTime() / 1000)), alertDuration: "2400" }) }));
    const body = (await r.json()) as { outage: { startAt: string; endAt: string; ms: number } | null };
    expect(r.status).toBe(200);
    expect(body.outage).not.toBeNull();
    expect(body.outage!.ms).toBeGreaterThanOrEqual(40 * MIN);
    expect(new Date(body.outage!.endAt).getTime() - new Date(body.outage!.startAt).getTime()).toBe(40 * MIN);
    expect(await db.outage.count()).toBe(1);
    expect((await dueOf(sessionId)) - due0).toBe(40 * MIN);
    // A placeholder UptimeRobot didn't fill in reads as no duration: nothing recorded from it.
    expect((await import("@/lib/server/outages")).parseAlert({ alertType: "2", alertDuration: "*alertDuration*" }).durationMs).toBeNull();
  });

  it("the heartbeat alone (batch 28 §1): a gap of 15 minutes or more between sweeps is listed for the admins, nothing moves; under 15 minutes nothing", async () => {
    const sessionId = await working();
    const due0 = await dueOf(sessionId);
    const t0 = new Date(Date.now() - 3 * H);
    expect(await sweepGap(t0)).toBeNull(); // the first sweep only stores its time
    expect(await sweepGap(new Date(t0.getTime() + 10 * MIN))).toBeNull(); // 10 minutes: nothing
    expect(await sweepGap(new Date(t0.getTime() + 20 * MIN))).toBeNull(); // 10 more minutes since the last sweep: still nothing
    expect(await db.outage.count()).toBe(0);
    const g = await sweepGap(new Date(t0.getTime() + 50 * MIN)); // 30 minutes without a sweep
    expect(g).toMatchObject({ startAt: new Date(t0.getTime() + 20 * MIN), endAt: new Date(t0.getTime() + 50 * MIN), ms: 30 * MIN });
    expect(await db.outage.count()).toBe(0);
    expect(await dueOf(sessionId)).toBe(due0);
    // Gated: with OUTAGE_CHECKS off nothing is stored or recorded.
    delete process.env.OUTAGE_CHECKS;
    expect(await sweepGap(new Date(t0.getTime() + 2 * H))).toBeNull();
    expect(await db.outage.count()).toBe(0);
  });

  it("the heartbeat gap first, then the up alert for the same downtime (batch 28 §2): the alert's span is applied once, and the gap is closed as covered by it", async () => {
    const sessionId = await working();
    const due0 = await dueOf(sessionId);
    const t0 = new Date(Date.now() - 2 * H);
    await sweepGap(t0);
    const end = new Date(t0.getTime() + 45 * MIN);
    await sweepGap(end); // the gap [t0, t0 + 45], listed
    const upAt = new Date(end.getTime() + MIN);
    const merged = await recordAlert("up", upAt, 50 * 60_000);
    expect(await db.outage.count()).toBe(1);
    expect(merged).toMatchObject({ startAt: new Date(t0.getTime() - 4 * MIN), endAt: upAt, ms: 50 * MIN });
    expect((await dueOf(sessionId)) - due0).toBe(50 * MIN);
    expect(await db.appState.count({ where: { key: { startsWith: "gap:" } } })).toBe(0);
    // One bell line for the tester, reworded to the merged times.
    const tester = (await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).testerId;
    const bells = await db.notification.findMany({ where: { userId: tester, text: { startsWith: "The site was down from " } } });
    expect(bells.map((b) => b.text)).toEqual([renderTimes(outageLine(merged!.startAt, merged!.endAt, merged!.ms), "UTC")]);
    // The same up alert again (or the next sweep for an already-covered stretch): nothing new.
    expect((await recordAlert("up", upAt, 50 * 60_000))!.id).toBe(merged!.id);
    expect(await db.outage.count()).toBe(1);
    expect((await dueOf(sessionId)) - due0).toBe(50 * MIN);
  });

  it("the up alert first, then the heartbeat's gap for the same downtime: still one outage, with the alert's span (batch 28 §2)", async () => {
    const t0 = new Date(Date.now() - 2 * H);
    await sweepGap(t0);
    const o = await recordAlert("up", new Date(t0.getTime() + 30 * MIN), 25 * 60_000);
    expect(o).toMatchObject({ ms: 25 * MIN });
    expect(await sweepGap(new Date(t0.getTime() + 31 * MIN))).toBeNull(); // the gap [t0, t0 + 31] is covered by it: not listed
    expect(await db.outage.count()).toBe(1);
    expect((await db.outage.findFirstOrThrow()).ms).toBe(25 * MIN);
  });

  it("under 15 minutes nothing; over 24 hours waits for the admin's Approve (nothing moves)", async () => {
    const sessionId = await working();
    const due0 = await dueOf(sessionId);
    expect(await recordAlert("up", new Date(), 10 * 60_000)).toBeNull();
    const o = await recordAlert("up", new Date(), 30 * H);
    expect(o).toMatchObject({ needsApproval: true, approvedAt: null });
    expect(o!.ms).toBeGreaterThan(OUTAGE_APPROVE_OVER_MS);
    expect(await dueOf(sessionId)).toBe(due0);
  });

  it("the sweep checks the heartbeat (wall clock) and the server start does too; HANDOVER names the webhook's variables", () => {
    expect(src("lib/server/holds.ts")).toContain("await (await import(\"./outages\")).sweepGap()");
    expect(src("instrumentation.ts")).toContain('if (process.env.NEXT_RUNTIME === "nodejs") {');
    expect(src("instrumentation-node.ts")).toContain("await sweepGap();");
    const handover = fs.readFileSync(path.resolve(__dirname, "../docs/HANDOVER.md"), "utf8");
    expect(handover).toContain("`*alertType*` (1 = down, 2 = up)");
    expect(handover).toContain("`*alertDuration*` (seconds the monitor was down");
  });
});

// ---------- 2. Calls and blocks ----------

describe("batch 26 section 2: a block ends a call in progress at once", () => {
  it("both pages show it ended; the one who blocked reads who, the other that the call was cancelled", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 5 * MIN) } }); // in progress, nobody connected yet
    await blockUser({ id: s.dev.user.id, email: s.dev.user.email, name: "Nora Lane" }, j.tester.user.id);
    const c = await db.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(c.endedAt).not.toBeNull();
    expect(c.endReason).toBe("blocked:developer");
    expect((await callStatus(s.dev.user, call.id)).line).toBe("Call ended: you blocked Ana Silva.");
    const t = await callStatus(j.tester.user, call.id);
    expect(t.line).toBe("Call ended: the call was cancelled.");
    expect(t.line).not.toMatch(/block/i);
    expect(t.ended).toBe(true);
  });
});

// ---------- 3 and 4. Stop lines ----------

describe("batch 26 sections 3 and 4: the team's Stop never names the developer; one time per line", () => {
  it("stop box, banner, final refusal and live box all say “This test was stopped at …”", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    await db.user.update({ where: { id: j.tester.user.id }, data: { timeZone: "UTC" } });
    await later();
    const loaded = new Date();
    await later();
    await adminStopTest(s.testId, "Breaks the rules");
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId }, include: { test: true } });
    const time = c.endedAt!.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    // The stop box (Rate, Charge / Let it go): the tester's own zone, no name.
    const stop = await testerStopSince(j.sessionId, loaded);
    expect(stop!.text).toBe(`This test was stopped at ${time}.`);
    // The banner and the final refusal.
    const banner = stillWorksLine({ ...c, teamTime: time }, "Nora Lane", () => "Oct 29, 2026", { chat: true });
    expect(banner).toBe(`This test was stopped at ${time}. You can still chat. Work you sent is still reviewed.`);
    expect(endedLine({ ...c, title: "Harbor Run" }, "Nora Lane", () => "Oct 29, 2026")).toBe("This test was stopped on Oct 29, 2026. Work you sent is still reviewed.");
    const refused = await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    expect(refused.body.error.message).toBe(`This test was stopped at ${time}, so your Send didn't go through. Work you sent is still reviewed.`);
    // The live box (it says when itself).
    const live = await json(await liveGET(req(`/api/live?scope=session:${j.sessionId}&since=${encodeURIComponent(loaded.toISOString())}`, { cookie: j.tester.cookie, method: "GET" })));
    const texts = (live.body.changes as { text: string }[]).map((x) => x.text);
    expect(texts).toContain("This test was stopped");
    expect(texts.join(" ")).not.toContain("Nora Lane");
    // The bell never names who either.
    const bell = await db.notification.findMany({ where: { userId: j.tester.user.id, text: { contains: "stopped" } } });
    expect(bell.map((n) => n.text).join(" ")).not.toContain("Nora Lane");
  });

  it("a developer's own Stop still names them", () => {
    const c = { status: "ended", endKind: "stopped", endedAt: new Date("2026-10-29T15:10:00Z"), test: { adminStoppedAt: null } };
    expect(endedLine(c, "Nora Lane", () => "Oct 29, 2026")).toBe("Nora Lane stopped the test on Oct 29, 2026. Work you sent is still reviewed.");
  });

  it("the stop box prints the stop's time once", () => {
    let box: { data?: { changes: { text: string; at: Date; kind?: string }[] } } = {};
    try {
      stopBox([{ kind: "stop", text: "This test was stopped at 5:24 AM.", createdAt: new Date() }]);
    } catch (e) {
      box = e as typeof box;
    }
    expect(box.data!.changes[0]).toMatchObject({ kind: "stop", text: "This test was stopped at 5:24 AM." });
    const html = renderToStaticMarkup(createElement(ChangesBox, { changes: [{ text: "This test was stopped at 5:24 AM.", at: new Date().toISOString(), kind: "stop" }], press: "Rate" }));
    expect(html).toContain("<li>This test was stopped at 5:24 AM.</li>");
    expect(html.match(/5:24 AM/g)).toHaveLength(1);
    expect(src("lib/server/tests.ts")).toContain('...(c.kind === "stop" ? { kind: "stop" } : {}),');
  });
});

// ---------- 5 to 8 ----------

describe("batch 26 sections 5 to 8", () => {
  it("5: the developer's chargeback box says chargeback hold", () => {
    const box = src("components/ChargebackSteps.tsx");
    expect(box).toContain("so your account is on a chargeback hold.");
    expect(box).not.toContain("so your account is on a payment hold.");
  });

  it("6: a sent, listed part says when Charge opens; an unlisted one doesn't", () => {
    expect(chargeOpensNote("Nora Lane", "Nov 5")).toBe("If Nora Lane hasn't paid by Nov 5, you can charge or let it go then.");
    const dash = src("app/app/page.tsx");
    expect(dash).toContain("const listed = (s.kind === \"recording\" ? c.recordingCents : c.writtenCents) != null;");
    expect(dash).toContain("const opens = listed ? chargeOpensAt(s, c.test, c, now) : null;");
    // (Batch 28 §21) A listed call is charged automatically instead; (batch 28 §5) the sent part's line is on the session page too.
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("{x.rateCents != null && x.payBy && <p className=\"text-xs text-slate-400\" data-auto-charge=\"\">");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("data-charge-opens=\"\">{chargeOpensNote(dev,");
  });

  it("7: the invite panel's own check follows the test both ways (full, then a spot opens)", async () => {
    const s = await setup({ spots: 1 });
    const j = await joined(s.testId);
    const state = async () => (await json(await pulseGET(req(`/api/pulse?inviteState=${s.testId}`, { cookie: s.dev.cookie, method: "GET" })))).body.blocked;
    expect(await state()).toMatchObject({ full: true });
    await sact(j.sessionId, "leave", j.tester.cookie, { seenAt: seen(), confirmed: true });
    expect(await state()).toBeNull();
    // Someone else's test: not theirs to ask about.
    const other = await makeUser({ dev: true });
    expect((await pulseGET(req(`/api/pulse?inviteState=${s.testId}`, { cookie: other.cookie, method: "GET" }))).status).toBe(404);
    expect(src("app/app/tests/[id]/InvitePanel.tsx")).toContain("const blocked = (liveBlocked !== undefined ? liveBlocked : p.blocked)");
  });

  it("8: a tester who rated shows “finished”, not “left”", () => {
    expect(togetherState({ status: "left", endKind: "rated" })).toBe("finished");
    expect(togetherState({ status: "left", endKind: "" })).toBe("left");
    expect(togetherState({ status: "working" })).toBe("in it now");
    expect(togetherState({ status: "ended", endKind: "early" })).toBe("ended");
  });
});

// ---------- 9. Confirm stops exactly like Pay ----------

describe("batch 26 section 9: Confirm with your bank stops for exactly what Pay on that piece stops for", () => {
  it("another tester's dispute and another tab's Pay stop both, with the same lines", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Okafor", "he");
    const cJ = await joined(testId, "Cam Lee", "they");
    for (const x of [a, b, cJ]) await sact(x.sessionId, "written", x.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const subA = await db.submission.findFirstOrThrow({ where: { contractId: a.sessionId } });
    const subC = await db.submission.findFirstOrThrow({ where: { contractId: cJ.sessionId } });
    // Ana's Charge waits for the bank (made while the developer was away): a review exists, so Pay on it is refused after its stop-once check.
    await db.review.create({ data: { submissionId: subA.id, contractId: a.sessionId, amountCents: 1000, agreedCents: 1000, reason: "", rejected: false, payKey: randomUUID() } });
    const p = await db.payment.create({ data: { kind: "review", submissionId: subA.id, contractId: a.sessionId, developerId: dev.user.id, testerId: a.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_confirmation", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 2 * DAY) } });
    await later();
    const loaded = seen();
    await later();
    // Meanwhile: Ben disputes (a tester's change) and another tab pays Cam.
    await db.testEvent.create({ data: { testId, contractId: b.sessionId, kind: "dispute", text: "Ben Okafor disputed what you paid for the written answers" } });
    expect((await pay(dev.cookie, { kind: "submission", id: subC.id, amount: "10.00", tickedCents: 1000, tab: "other" })).status).toBe(200);
    await later();
    const payStop = await pay(dev.cookie, { kind: "submission", id: subA.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, confirmed: false, tab: "this" });
    expect(payStop.body.error.code).toBe("stop_once");
    let confirmErr: { code?: string; data?: { changes: { text: string }[] } } = {};
    try {
      await confirmStart({ id: dev.user.id }, p.id, { seenAt: loaded, tab: "this" });
    } catch (e) {
      confirmErr = e as typeof confirmErr;
    }
    expect(confirmErr.code).toBe("stop_once");
    const lines = (x: { text: string }[]) => x.map((c) => c.text);
    expect(lines(confirmErr.data!.changes)).toEqual(lines(payStop.body.error.changes ?? payStop.body.error.data?.changes ?? []));
    expect(lines(confirmErr.data!.changes)).toContain("Ben Okafor disputed what you paid for the written answers");
    expect(lines(confirmErr.data!.changes).some((t) => t.startsWith("You paid Cam Lee $10.00"))).toBe(true);
    // The code: one press description for Pay, Pay more and Confirm.
    expect(src("lib/server/confirm.ts")).toContain("payPressOf(c.id, piece)");
    expect(src("lib/server/payments.ts")).toContain("const payPress = payPressOf(c.id, piece.where);");
  });
});

// ---------- 10. Call requests ----------

describe("batch 26 section 10: call requests", () => {
  it("a request closed because the tester finished their part shows live in its row; the press is named; older terms say so", async () => {
    expect(requestGoneLine({ status: "closed", closedReason: "the tester finished their part" })).toBe("Closed: the tester finished their part");
    expect(requestGoneLine({ status: "pending", closedReason: "" })).toBe("");
    expect(requestGoneLine({ status: "withdrawn", closedReason: "" })).toBe("Withdrawn");
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await act(testId, "request-time", dev.cookie, { contractIds: [j.sessionId], startsAt: new Date(Date.now() + 3 * DAY).toISOString(), minutes: "30", seenAt: seen(), confirmed: true })).status).toBe(200);
    const r = await db.callRequest.findFirstOrThrow({ where: { contractId: j.sessionId, status: "pending" } });
    const poll = async (cookie: string) => (await json(await pulseGET(req(`/api/pulse?requests=${r.id}`, { cookie, method: "GET" })))).body.gone;
    expect(await poll(dev.cookie)).toEqual([]);
    await db.callRequest.update({ where: { id: r.id }, data: { status: "closed", closedReason: "the tester finished their part" } });
    expect(await poll(dev.cookie)).toEqual([{ id: r.id, line: "Closed: the tester finished their part" }]);
    const stranger = await makeUser({ dev: true });
    expect(await poll(stranger.cookie)).toEqual([]);
    expect(requestPressName("w-abc")).toBe("Withdraw");
    expect(requestPressName("d-abc")).toBe("Decline");
    expect(requestPressName("a-abc")).toBe("Accept");
    expect(src("components/CallRequestsPanel.tsx")).toContain("press={requestPressName(at)}");
    expect(devRateLabel(3000, 3000, 2400)).toBe("Their terms: $30/h (the listing is now $24/h)");
    expect(devRateLabel(3000, 3000, 3000)).toBe("Contract $30/h");
    expect(devRateLabel(null, 3000, 2400)).toBe("Not listed");
  });
});

// ---------- 11. Layout ----------

describe("batch 26 section 11: layout", () => {
  it("every missing tick is red, each under its whole tick row, on both sign-up steps; the * right after the question's words", async () => {
    await expect(signUp({ email: `b26-${randomUUID()}@playtest.test`, password: "long enough pw", role: "tester", name: "Rae" }, "http://localhost")).rejects.toMatchObject({ message: "Agree to the Terms of Use to sign up\nYou must be 18 or older to use Playtest." });
    await expect(finishGoogleSignup("none", {})).rejects.toMatchObject({ message: "Agree to the Terms of Use to sign up\nYou must be 18 or older to use Playtest." });
    await expect(finishGoogleSignup("none", { acceptTerms: "yes" })).rejects.toMatchObject({ message: "You must be 18 or older to use Playtest." });
    for (const f of ["app/signup/page.tsx", "app/signup/google/page.tsx"]) expect(src(f).match(/<label className="flex items-start gap-2 text-sm text-slate-300" data-note-after="">/g)).toHaveLength(2);
    expect(src("components/FormMistakes.tsx")).toContain('text.slice(1).split("\\n").filter(Boolean)');
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain('<ScrollText className="min-w-0" text={qText(q)} label={`Question ${i + 1}`} />{qRequired(q) && <span className="req shrink-0"');
  });
});

// ---------- 12. Admin payouts waiting ----------

describe("batch 26 section 12: Payouts waiting shows everything, in the scroll box", () => {
  it("the next 25 as it nears its end, and the total for “That's all (N)”", async () => {
    await db.payment.updateMany({ where: { transferStatus: "waiting", status: "charged" }, data: { transferStatus: "none" } });
    const t = await makeUser({ tester: true, name: "Wai Ting" });
    const d = await makeUser({ dev: true });
    for (let i = 0; i < 30; i++) await db.payment.create({ data: { kind: "review", developerId: d.user.id, testerId: t.user.id, amountCents: 1000 + i, feeCents: 0, testerCents: 800 + i, status: "charged", transferStatus: "waiting", createdAt: new Date(Date.now() - i * MIN) } });
    const first = await adminPage("payouts", d.user.id, null);
    expect(first.total).toBe(30);
    expect(first.rows).toHaveLength(25);
    expect(first.next).not.toBeNull();
    expect((first.rows[0] as { text: string }).text).toMatch(new RegExp(`^${t.user.email.replace(/[.+]/g, "\\$&")} · \\$8\\.29 · waiting since `)); // (batch 28 §7) oldest first
    const second = await adminPage("payouts", d.user.id, first.next);
    expect(second.rows).toHaveLength(5);
    expect(second.next).toBeNull();
    expect(endLine(first.total)).toBe("That's all (30)");
    const page = src("app/admin/page.tsx");
    expect(page).toContain('<PagedList kind="payouts" title="Payouts waiting for a payout account" initial={rows(payoutsP)} empty="None." />');
  });
});

// ---------- 13. The device pop-up's Join anyway ----------

describe("batch 26 section 13: the pop-up's press closes it when the page stays", () => {
  it("Apply anyway and Ask to rejoin anyway close the pop-up and show the done line; Join anyway still goes to the session page", () => {
    expect(afterSent({ ok: true, moving: false })).toBe("close");
    expect(afterSent({ ok: true })).toBe("close");
    expect(afterSent({ ok: true, moving: true })).toBe("stay");
    const box = src("app/app/find/[id]/JoinBox.tsx");
    expect(box).toContain("window.location.href = `/app/sessions/${r.sessionId}`;\n        return { ok: true, moving: true };");
    expect(box).toContain("setDone(rejoining ? \"Sent. You'll hear back when the developer answers.\" : \"Application sent. You'll hear back when the developer answers.\");\n      return { ok: true, moving: false };");
    expect(src("components/GapDialog.tsx")).toContain("ref.current?.close(); // (batch 26 section 13) the page stays");
  });
});

// ---------- 14. Questions not required by default ----------

describe("batch 26 section 14: questions are not required by default; sending needs at least one answer", () => {
  it("the markers and the one rule", () => {
    expect(qRequired(REQUIRED + "Q?")).toBe(true);
    expect(qOptional("Q?")).toBe(true);
    expect(qOptional(NOT_REQUIRED + "Q?")).toBe(true);
    expect(qText(REQUIRED + "Q?")).toBe("Q?");
    expect(qText(NOT_REQUIRED + "Q?")).toBe("Q?");
    expect(answersMissing(["A?", "B?"], ["", ""])).toEqual({ message: ANSWER_ONE, at: 0 });
    expect(answersMissing(["A?", "B?"], ["", "  "])).toEqual({ message: ANSWER_ONE, at: 0 });
    expect(answersMissing(["A?", "B?"], ["", "b"])).toBeNull();
    expect(answersMissing(["A?", REQUIRED + "B?"], ["a", ""])).toEqual({ message: ANSWER_REQUIRED, at: 1 });
    expect(answersMissing([], [])).toBeNull();
    expect(ANSWER_ONE).toBe("Answer at least one question before sending.");
  });

  it("no Required ticks: one answer is enough, none is refused (the notes box alone doesn't count); a Required one empty is refused at it", async () => {
    const { testId } = await setup({ questions: ["What did you like?", "Where did you get stuck?"] });
    const j = await joined(testId);
    const none = await sact(j.sessionId, "written", j.tester.cookie, { answers: ["", ""], notes: "Only notes" });
    expect(none.body.error).toMatchObject({ code: "bad_answers", message: ANSWER_ONE, missing: 0 });
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["", "The map"], notes: "" })).status).toBe(200);
    const r = await setup({ questions: ["One?", REQUIRED + "Two?"] });
    const k = await joined(r.testId);
    const miss = await sact(k.sessionId, "written", k.tester.cookie, { answers: ["x", ""] });
    expect(miss.body.error).toMatchObject({ code: "bad_answers", message: ANSWER_REQUIRED, missing: 1 });
  });

  it("Post / Edit: a Required tick, off by default, and the line under the questions box; the * only on Required questions", () => {
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("checked={f.requiredQs.includes(q)}");
    expect(form).toContain("/> Required");
    expect(form).not.toContain("Not required");
    expect(src("lib/questions.ts")).toContain('"Testers answer at least one question. Tick Required on any they must answer."');
    expect(form).toContain("{QUESTIONS_RULE_LINE}");
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain("{qRequired(q) && <span className=\"req shrink-0\" data-required-star=\"\"");
  });

  it("the conversion: old rows lose the “[not required] ” marker; unmarked ones stay (now not required); nothing reads as a question change", async () => {
    const { dev, testId } = await setup({ questions: ["Q1?", "Q2?"] });
    const j = await joined(testId);
    // Rows as stored before batch 26.
    await db.test.update({ where: { id: testId }, data: { questions: ["Q1?", NOT_REQUIRED + "Q2?"] } });
    await db.contract.update({ where: { id: j.sessionId }, data: { questions: ["Q1?", NOT_REQUIRED + "Q2?"] } });
    const sql = path.resolve(__dirname, "../prisma/migrations/20261106090000_questions_not_required/migration.sql");
    execSync(`npx prisma db execute --file "${sql}" --schema prisma/schema.prisma`, { cwd: path.resolve(__dirname, ".."), env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DATABASE_URL }, stdio: "pipe" });
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    expect(t.questions).toEqual(["Q1?", "Q2?"]);
    expect(c.questions).toEqual(["Q1?", "Q2?"]);
    expect((t.questions as string[]).every(qOptional)).toBe(true);
    // The contract and the listing read the same: no new terms.
    const terms = (x: typeof t | typeof c) => ({ ndaText: x.ndaText, writtenCents: x.writtenCents, recordingCents: x.recordingCents, liveRateCents: x.liveRateCents, liveMinutes: x.liveMinutes, deadlineDays: x.deadlineDays, questions: x.questions as string[], writtenRequired: x.writtenRequired, recordingRequired: x.recordingRequired, liveRequired: x.liveRequired });
    expect(termsDiff(terms(c), terms(t))).not.toContain("questions changed");
    // An old page still sending the old marker: dropped on Save, never a change.
    const v = t.version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { questions: ["Q1?", NOT_REQUIRED + "Q2?"] }, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).questions).toEqual(["Q1?", "Q2?"]);
    expect(await db.termsOffer.count({ where: { contractId: j.sessionId } })).toBe(0);
  });
});

// ---------- 15. Previous questions and answers ----------

describe("batch 26 section 15: previous sets show each question as a label above its answer", () => {
  it("a small grey question label, the answer indented under it, “(no answer)” in grey", () => {
    const html = renderToStaticMarkup(createElement(SetView, { items: [{ question: "aaaa", required: false, answer: "m;ll" }, { question: "dddd", required: true, answer: "" }] }));
    expect(html).toContain('data-set-question=""');
    expect(html).toContain('class="flex items-start gap-0.5 text-xs text-slate-400"');
    expect(html).toContain('class="border-l border-white/10 pl-3" data-set-answer=""');
    expect(html).toContain('data-no-answer="">(no answer)</p>');
    expect(html).not.toContain("not required");
    for (const f of ["app/app/sessions/[id]/page.tsx", "app/app/tests/[id]/page.tsx", "app/admin/DisputeWork.tsx"]) expect(src(f)).toMatch(/<(SetView|PrevSetFolds)/);
  });

  it("switching to terms that only tick Required doesn't move the current set into “Previous questions and answers”", async () => {
    const { dev, testId } = await setup({ questions: ["Q1?", "Q2?"] });
    const j = await joined(testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["one", "two"] });
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { questions: [REQUIRED + "Q1?", "Q2?"] }, seenAt: seen(), confirmed: true })).status).toBe(200);
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: j.sessionId, status: "open" } });
    expect(offer.diff).toContain("questions changed"); // ticking Required is part of the terms
    await decideTerms({ id: j.tester.user.id }, j.sessionId, { offerId: offer.id, choice: "switch", seenAt: seen(), confirmed: true });
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    expect(c.questions).toEqual([REQUIRED + "Q1?", "Q2?"]);
    expect(c.prevSets).toEqual([]);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "written" } });
    expect(sub.setUntil).toBeNull();
  });
});
