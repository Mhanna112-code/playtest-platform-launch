import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { GET as testGET } from "@/app/api/tests/[id]/[action]/route";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { StatusPill } from "@/components/Ui";
import * as R from "@/lib/rules";
import { CRITICAL_KEYS, countsAfter, countsOf, criticalLine, lockedFields } from "@/lib/limits";
import { rateLabel } from "@/lib/server/requests";
import { decideDispute, review } from "@/lib/server/payments";
import { liftHoldIfClear, owedLines, payOwed, startHold } from "@/lib/server/holds";
import { reinstateAccount } from "@/lib/server/restrictions";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, atHours, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 6 (owner, Oct 28 afternoon): calls without a Live call part, "Full", the per-field 3-change limit, and what testers can do in a paused test.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const DAY = 86_400_000;
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), ...body } })).then(json);
const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } })).then((r) => r.json());
const admin = async () => {
  const a = await makeUser({ name: "Admin" });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
};
const adm = (action: string, cookie: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) =>
  act(testId, "edit", cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields });
const decline = () => setStripeForTests({ paymentIntents: { create: async () => { throw Object.assign(new Error("declined"), { type: "StripeCardError" }); } } } as unknown as Stripe);
const withCard = (userId: string) => db.user.update({ where: { id: userId }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
afterEach(() => setStripeForTests(null));

/** A tester whose written answers waited 14 days and Charge / Let it go is open. */
async function chargeOpen(over: Record<string, unknown> = {}) {
  const s = await setup(over);
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 14 * DAY) } });
  await settle();
  return { ...s, ...j, sub };
}
/** Paid below the listing, then disputed. */
async function disputed() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await review(s.dev.user, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Short answers here", payKey: randomUUID(), seenAt: seen(), confirmed: true });
  expect((await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question fully" })).status).toBe(200);
  const d = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
  const a = await admin();
  return { ...s, ...j, sub, d, a: { ...a.user, isAdmin: true } };
}

describe("batch 6 item 1: calls without a Live call part are allowed again", () => {
  it("both sides can request and book a call on a test with no live call; it reads 'Not listed' (batch 7) and has no rate", async () => {
    const { dev, testId } = await setup({ liveRateCents: null });
    const { tester, sessionId } = await joined(testId);
    const d = await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: atHours(48) });
    expect(d.status).toBe(200);
    const q = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId, fromSide: "developer" } });
    expect((await sact(sessionId, "answer-request", tester.cookie, { requestId: q.id, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    const call = await db.call.findFirstOrThrow({ where: { contractId: sessionId } });
    expect(call.rateCents).toBeNull();
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), confirmed: true, startsAt: atHours(96) })).status).toBe(200);
    // The labels on each side.
    expect(rateLabel(null, null)).toBe("Not listed"); // (batch 7) the short label, both sides
    expect(rateLabel(3000, 3000)).toBe("Contract $30/h"); // listed and in the contract: as before
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("{NOT_LISTED}");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("Live call: ${NOT_LISTED}");
  });

  it("listed only when the listing has a live call AND it is in this tester's contract", async () => {
    expect(R.callListed({ liveRateCents: 3000 }, { liveRateCents: 3000 })).toBe(true);
    expect(R.callListed({ liveRateCents: null }, { liveRateCents: 3000 })).toBe(false);
    expect(R.callListed({ liveRateCents: 3000 }, { liveRateCents: null })).toBe(false);
    // A tester who joined before a live call was added (and kept their terms) books calls that aren't a listed part.
    const { dev, testId } = await setup({ liveRateCents: null });
    const { tester, sessionId } = await joined(testId);
    await db.test.update({ where: { id: testId }, data: { liveRateCents: 3000 } });
    await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: atHours(48) });
    const q = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId } });
    await sact(sessionId, "answer-request", tester.cookie, { requestId: q.id, action: "accept", seenAt: seen(), confirmed: true });
    expect((await db.call.findFirstOrThrow({ where: { contractId: sessionId } })).rateCents).toBeNull();
  });

  it("pay for an unlisted call: the box starts empty, (batch 9) at most $200/h for the logged minutes, and Charge never opens for it", async () => {
    const { dev, testId } = await setup({ liveRateCents: null });
    const { tester, sessionId } = await joined(testId);
    await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: atHours(48) });
    const q = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId } });
    await sact(sessionId, "answer-request", tester.cookie, { requestId: q.id, action: "accept", seenAt: seen(), confirmed: true });
    const call = await db.call.findFirstOrThrow({ where: { contractId: sessionId } });
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 20 * DAY), measuredMinutes: 30, measuredAt: new Date(Date.now() - 20 * DAY) } });
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain('const start = more ? null : p.listingCents;');
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain('useState(start == null ? "" :');
    // Charge / Let it go never opens for it, however long it waits.
    await cron();
    expect(await db.review.count({ where: { callId: call.id } })).toBe(0);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "charge" } } })).toBe(0);
    const over = await pay(dev.cookie, { kind: "call", id: call.id, amount: "150.00", tickedCents: 15000, confirmed: true });
    expect(over.status).toBe(400);
    expect(over.body.error.message).toBe(R.overCallsLine(10_000)); // 30 minutes at $200/h (batch 12 section 2: nothing above it for an unlisted call)
    expect((await pay(dev.cookie, { kind: "call", id: call.id, amount: "100.00", tickedCents: 10000, confirmed: true })).status).toBe(200);
  });
});

describe("batch 6 item 2: 'Accepting testers' only when open with a spot", () => {
  it("open with a free spot: Accepting testers; open and full: Full; the others as before", () => {
    (globalThis as { React?: unknown }).React = React; // the components compile to React.createElement under vitest
    const html = (p: { status: string; full?: boolean }) => renderToStaticMarkup(createElement(StatusPill, p));
    expect(html({ status: "open" })).toContain("Accepting testers");
    expect(html({ status: "open", full: true })).toContain("Full");
    expect(html({ status: "open", full: true })).not.toContain("Accepting");
    expect(html({ status: "draft" })).toContain("Draft");
    expect(html({ status: "stopped", full: true })).toContain("Stopped");
    expect(html({ status: "closed" })).toContain("Not accepting testers");
    expect(src("app/app/page.tsx")).toContain("<StatusPill status={t.status} full={inIt.length >= t.spots} />");
    expect(src("app/app/page.tsx")).not.toContain('t.status === "open" ? null');
    expect(src("app/app/tests/[id]/page.tsx")).toContain("full={working.length >= t.spots}");
  });
});

describe("batch 6 item 3: the 3-change limit is per field", () => {
  it("the helpers: counts read from Json, one Save uses one change of each field it touches, the per-field line", () => {
    expect(countsOf(null)).toEqual({ description: 0, questions: 0, languages: 0, devices: 0, buildUrl: 0, parts: 0 }); // (batch 34 §15) never the NDA
    expect(countsOf({ description: 2, ndaText: 5, devices: "x", bogus: 9 })).toEqual({ description: 2, questions: 0, languages: 0, devices: 0, buildUrl: 0, parts: 0 });
    expect(countsAfter(countsOf({ description: 2 }), ["description", "questions"])).toMatchObject({ description: 3, questions: 1, devices: 0, buildUrl: 0, parts: 0 });
    expect(lockedFields(countsOf({ description: 3, devices: 2, buildUrl: 0, parts: 0 }))).toEqual(["description"]);
    expect(criticalLine("questions")).toBe("You've changed the questions 3 times since testers joined. Contact us in Settings to change it again.");
    expect(criticalLine("description")).toBe("You've changed the steps 3 times since testers joined. Contact us in Settings to change it again.");
    expect(CRITICAL_KEYS).toEqual(["description", "questions", "languages", "devices", "buildUrl", "parts"]); // (batch 34 §15) never the NDA
  });

  it("each field has its own 3 changes; one that reaches 0 locks alone and the others stay editable; the NDA never counts; the listing poll carries the counts", async () => {
    const { dev, testId } = await setup();
    await joined(testId);
    expect((await edit(testId, dev.cookie, { description: "One", languages: ["English"], ndaText: "Secret one" })).status).toBe(200); // one change of each limited field
    expect(countsOf((await db.test.findUniqueOrThrow({ where: { id: testId } })).criticalCounts)).toEqual({ description: 1, questions: 0, languages: 1, devices: 0, buildUrl: 0, parts: 0 });
    for (const t of ["Two", "Three"]) expect((await edit(testId, dev.cookie, { description: t })).status).toBe(200);
    const fourth = await edit(testId, dev.cookie, { description: "Four", languages: ["German"] });
    expect(fourth.status).toBe(400);
    expect(fourth.body.error.message).toBe("You've changed the steps 3 times since testers joined. Contact us in Settings to change it again.");
    expect(fourth.body.error.critical).toEqual(["description"]);
    // Nothing saved from that press; the other fields still save on their own.
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).languages).toEqual(["English"]);
    expect((await edit(testId, dev.cookie, { languages: ["German"], questions: ["Sail on?"] })).status).toBe(200);
    // (Batch 34 §15) The NDA has no limit: any number of NDA saves go through and use no change.
    for (const t of ["Secret two", "Secret three", "Secret four", "Secret five"]) expect((await edit(testId, dev.cookie, { ndaText: t })).status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).ndaText).toBe("Secret five");
    expect(countsOf((await db.test.findUniqueOrThrow({ where: { id: testId } })).criticalCounts)).toEqual({ description: 3, questions: 1, languages: 2, devices: 0, buildUrl: 0, parts: 0 });
    const r = await json(await testGET(req(`/api/tests/${testId}/listing`, { cookie: dev.cookie }), { params: Promise.resolve({ id: testId, action: "listing" }) }));
    expect(r.body.criticalCounts).toEqual({ description: 3, questions: 1, languages: 2, devices: 0, buildUrl: 0, parts: 0 });
    // Edit: "Changes left: N of 3" next to each limited label, the lock note under a locked field, only that field disabled; nothing of the kind on the NDA.
    const form = src("app/app/tests/TestForm.tsx");
    for (const f of ["description", "questions", "languages", "devices"]) expect(form).toContain(`left("${f}")`);
    for (const f of ["description", "questions", "languages", "devices"]) expect(form).toContain(`lockNote("${f}")`);
    expect(form).toContain('disabled={fieldLocked("description")}');
    for (const t of ['left("ndaText")', 'lockNote("ndaText")', 'fieldLocked("ndaText")']) expect(form).not.toContain(t);
    expect(form).not.toContain("limitReached");
  });

  it("the admin's 'Allow 3 more' gives 3 more changes to every field at 0 and leaves the others", async () => {
    const { testId } = await setup();
    await db.test.update({ where: { id: testId }, data: { criticalCounts: { description: 3, devices: 3, questions: 2 } } });
    const a = await admin();
    expect((await adm("allow-critical-changes", a.cookie, { id: testId })).status).toBe(200);
    expect(countsOf((await db.test.findUniqueOrThrow({ where: { id: testId } })).criticalCounts)).toEqual({ description: 0, questions: 2, languages: 0, devices: 0, buildUrl: 0, parts: 0 });
  });

  it("the migration copies the old total into every field's count, then drops the old column", () => {
    const dir = path.resolve(__dirname, "../prisma/migrations");
    const name = fs.readdirSync(dir).find((d) => d.endsWith("_per_field_change_counts"))!;
    const sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8");
    for (const f of ["description", "ndaText", "questions", "languages", "devices"]) expect(sql).toContain(`'${f}', "criticalChanges"`); // the fields of batch 6 (batch 14 added two)
    expect(sql).toContain('DROP COLUMN "criticalChanges"');
    expect(sql.indexOf("UPDATE")).toBeLessThan(sql.indexOf("DROP COLUMN"));
  });
});

describe("batch 6 item 4: a paused test, what testers can do", () => {
  it("the paused notice says what still works (never why); the DEFAULTs live in one place", () => {
    // (Batch 10) The banner's wording: what works now, and what comes back when it resumes.
    expect(R.PAUSED_FOR_TESTERS).toContain("For now you can save drafts of your parts, charge or let go of work left unreviewed, dispute, rate, leave the test, and cancel booked calls.");
    expect(R.PAUSED_FOR_TESTERS).toContain("Sending work and requesting calls come back when it resumes."); // (batch 15 section 1: chat isn't paused by a paused test)
    expect(R.PAUSED_FOR_TESTERS).not.toMatch(/hold|suspend|fail|chargeback|chat/i);
    expect(R.PAUSE_DEFAULTS).toEqual({ draftsEditable: true, teamPauseSameRules: true, shiftDeadlines: true });
    expect(R.testerPaused({}, { adminPausedAt: new Date() })).toBe(true);
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("{pausedBanner}");
  });

  for (const kind of ["hold", "chargeback", "suspension", "team"] as const) {
    it(`(${kind}) Send is refused, drafts still upload; (batch 15) chat pauses only for a restricted person; dispute, rate and leave still work`, async () => {
      const { dev, testId, tester, sessionId } = await chargeOpen({ recordingCents: "5.00" });
      if (kind === "hold") await startHold(dev.user.id, "unpaid");
      if (kind === "chargeback") await startHold(dev.user.id, "chargeback");
      if (kind === "suspension") await db.user.update({ where: { id: dev.user.id }, data: { devSuspendedAt: new Date() } });
      if (kind === "team") await db.test.update({ where: { id: testId }, data: { adminPausedAt: new Date() } });
      const w = await sact(sessionId, "written", tester.cookie, { answers: ["c", "d"] });
      expect(w.status).toBe(409);
      expect(w.body.error.message).toBe("This test is paused right now. You can send this once it resumes.");
      expect((await sact(sessionId, "recording-send", tester.cookie, { seenAt: seen(), confirmed: true })).body.error.message).toBe("This test is paused right now. You can send this once it resumes.");
      // Drafts: a recording can still be uploaded (sent later).
      expect((await sact(sessionId, "recording-start", tester.cookie, { size: 1000, contentType: "video/mp4", filename: "a.mp4" })).status).toBe(200);
      const m = await sact(sessionId, "message", tester.cookie, { body: "Hello?" });
      if (kind === "team") {
        // (Batch 15 section 1) The team pausing a test never closes the chat, both ways.
        expect(m.status).toBe(200);
        expect((await act(testId, "message", dev.cookie, { contractId: sessionId, body: "Hi" })).status).toBe(200);
      } else {
        // The developer is restricted: the tester's Send is turned back neutrally (never why).
        expect(m.body.error.message).toBe(R.CHAT_NOT_SENT);
        expect(m.body.error.message).not.toMatch(/hold|suspend|fail/i);
      }
      expect(src("app/app/chat/[id]/page.tsx")).toContain("closedNote={!blocked && paused ? CHAT_PAUSED_NOTE : undefined}");
      // Leave still works.
      expect((await sact(sessionId, "leave", tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    });
  }

  it("a dispute can be filed while paused", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await review(dev.user, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Short answers here", payKey: randomUUID(), seenAt: seen(), confirmed: true });
    await startHold(dev.user.id, "unpaid");
    expect((await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question fully" })).status).toBe(200);
  });

  it("Charge during a payment hold: the tester's choice goes through, is added to what is owed, and the tester is paid when the developer pays it", async () => {
    const { dev, sub, tester, sessionId } = await chargeOpen();
    await startHold(dev.user.id, "unpaid");
    const c = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true });
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ status: "owed", message: "Charged $10.00. Payment may be delayed until the test resumes." });
    expect(c.body.message).not.toMatch(/hold/i);
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect(p).toMatchObject({ status: "owed", amountCents: 1000 });
    expect((await owedLines(dev.user.id)).map((l) => l.text)).toEqual(["Ana Silva's written answers $10.00 · charged by the tester while your tests were paused"]);
    expect(await liftHoldIfClear(dev.user.id)).toBe(false); // owed first
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("chargedDelayedLine(chargedOwed.get(sub.id)!)");
    const r = await payOwed(dev.user);
    expect(r).toMatchObject({ paid: 1, lifted: true });
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).not.toBe("owed");
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "Nora Lane paid $10.00 for your written answers" } })).toBe(1);
  });

  it("Charge during a chargeback hold is added to what is owed too", async () => {
    const { dev, sub, tester, sessionId } = await chargeOpen();
    await startHold(dev.user.id, "chargeback");
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true })).body.status).toBe("owed");
  });

  it("Charge during an admin suspension with no hold is charged at once; a declined card starts a payment hold and the amount is owed", async () => {
    const one = await chargeOpen();
    await db.user.update({ where: { id: one.dev.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    const c = await sact(one.sessionId, "choose", one.tester.cookie, { submissionId: one.sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true });
    expect(c.status).toBe(200);
    expect(["charged", "not_set_up"]).toContain(c.body.status);
    const two = await chargeOpen();
    await db.user.update({ where: { id: two.dev.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    await withCard(two.dev.user.id);
    decline();
    const d = await sact(two.sessionId, "choose", two.tester.cookie, { submissionId: two.sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true });
    expect(d.body.status).toBe("failed");
    expect((await db.user.findUniqueOrThrow({ where: { id: two.dev.user.id } })).holdStartedAt).not.toBeNull();
    expect((await owedLines(two.dev.user.id)).length).toBe(1);
  });

  it("the team's pause of one test with no hold: a Charge is charged at once", async () => {
    const { dev, testId, sub, tester, sessionId } = await chargeOpen();
    void dev;
    await db.test.update({ where: { id: testId }, data: { adminPausedAt: new Date() } });
    const c = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true });
    expect(["charged", "not_set_up"]).toContain(c.body.status);
  });

  it("after the 7-day close, Charge carries on and stays owed during the hold", async () => {
    const { dev, testId, sub, tester, sessionId } = await chargeOpen();
    await startHold(dev.user.id, "unpaid");
    await db.test.update({ where: { id: testId }, data: { status: "closed", pauseClosedAt: new Date() } });
    await db.contract.update({ where: { id: sessionId }, data: { status: "ended", endKind: "closed", endedAt: new Date() } });
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true })).body.status).toBe("owed");
  });

  it("a dispute decided for the tester during a hold is owed (paid when it is paid); during a suspension with no hold it charges at once, and a decline starts a hold", async () => {
    const held = await disputed();
    await startHold(held.dev.user.id, "unpaid");
    await decideDispute(held.a, held.d.id, { total: "10.00" });
    expect(await db.payment.findFirstOrThrow({ where: { disputeId: held.d.id } })).toMatchObject({ status: "owed", amountCents: 600 });
    expect(await db.notification.count({ where: { userId: held.tester.user.id, text: { contains: "was decided" } } })).toBe(1);
    expect((await payOwed(held.dev.user)).lifted).toBe(true);
    expect((await db.payment.findFirstOrThrow({ where: { disputeId: held.d.id } })).status).not.toBe("owed");

    const susp = await disputed();
    await db.user.update({ where: { id: susp.dev.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    await decideDispute(susp.a, susp.d.id, { total: "10.00" });
    expect(["charged", "not_set_up"]).toContain((await db.payment.findFirstOrThrow({ where: { disputeId: susp.d.id } })).status);

    const declined = await disputed();
    await db.user.update({ where: { id: declined.dev.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    await withCard(declined.dev.user.id);
    decline();
    await decideDispute(declined.a, declined.d.id, { total: "10.00" });
    expect(await db.payment.findFirstOrThrow({ where: { disputeId: declined.d.id } })).toMatchObject({ status: "failed", amountCents: 600 });
    expect((await db.dispute.findUniqueOrThrow({ where: { id: declined.d.id } })).status).toBe("decided");
    expect((await db.user.findUniqueOrThrow({ where: { id: declined.dev.user.id } })).holdStartedAt).not.toBeNull();
  });

  it("invites and applications wait: a suspension closes none; the join page says only 'This test is paused right now.'", async () => {
    const { dev, testId } = await setup();
    const ann = await makeUser({ tester: true });
    const app = await db.application.create({ data: { testId, testerId: ann.user.id, listing: {} } });
    const a = await admin();
    expect((await adm("suspend", a.cookie, { id: dev.user.id, note: "Check" })).status).toBe(200);
    expect((await db.application.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("pending");
    const ben = await makeUser({ tester: true });
    expect((await act(testId, "join", ben.cookie, { listingVersion: 1 })).body.error.message).toBe("This test is paused right now.");
    expect(src("app/app/find/[id]/page.tsx")).toContain('<p className="info" data-paused="">This test is paused right now.</p>');
    expect((await adm("unsuspend", a.cookie, { id: dev.user.id })).status).toBe(200);
    expect((await db.application.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("pending");
    expect((await act(testId, "join", ben.cookie, { listingVersion: 1 })).status).toBe(200);
  });

  it("(DEFAULT) deadlines and Open until move on by the pause; overlapping pauses count once", async () => {
    expect(R.pauseShiftMs(new Date(0), new Date(5 * DAY))).toBe(5 * DAY);
    expect(R.pauseShiftMs(new Date(0), new Date(5 * DAY), [new Date(2 * DAY)])).toBe(2 * DAY); // the rest counts when the other lifts
    expect(R.pauseShiftMs(new Date(2 * DAY), new Date(4 * DAY), [new Date(0)])).toBe(0); // inside another pause still on
    const { dev, testId } = await setup({ openUntil: new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10) });
    const { tester, sessionId } = await joined(testId);
    const due0 = (await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).dueAt;
    const ou0 = (await db.test.findUniqueOrThrow({ where: { id: testId } })).openUntil!;
    // Suspended 5 days ago, then a hold 3 days ago. (Batch 34 §4) The developer side isn't reinstated during the hold: the hold lifts first (the suspension
    // still pauses the tests, and covers the hold's days), then the reinstatement moves everything on by the whole pause.
    await db.user.update({ where: { id: dev.user.id }, data: { devSuspendedAt: new Date(Date.now() - 5 * DAY), holdStartedAt: new Date(Date.now() - 3 * DAY), holdReason: "unpaid", holdCount: 1 } });
    await expect(reinstateAccount(dev.user.id)).rejects.toMatchObject({ code: "on_hold" });
    const days = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / DAY);
    expect(await liftHoldIfClear(dev.user.id)).toBe(true);
    expect(days((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).dueAt, due0)).toBe(0);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "is running again" } } })).toBe(0); // still paused
    await reinstateAccount(dev.user.id);
    expect(days((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).dueAt, due0)).toBe(5);
    expect(days((await db.test.findUniqueOrThrow({ where: { id: testId } })).openUntil!, ou0)).toBe(5);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "is running again" } } })).toBe(1);
  });

  it("(DEFAULT) the team's unpause moves deadlines the same way", async () => {
    const { testId } = await setup();
    const { sessionId } = await joined(testId);
    const due0 = (await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).dueAt;
    await db.test.update({ where: { id: testId }, data: { adminPausedAt: new Date(Date.now() - 2 * DAY) } });
    const a = await admin();
    expect((await adm("unpause-test", a.cookie, { id: testId })).status).toBe(200);
    expect(Math.round(((await db.contract.findUniqueOrThrow({ where: { id: sessionId } })).dueAt.getTime() - due0.getTime()) / DAY)).toBe(2);
  });

  it("the old open question about sending during a hold is gone", () => {
    expect(src("app/api/sessions/[id]/[action]/route.ts")).not.toContain("testers keep sending work");
    expect(src("lib/server/restrictions.ts")).not.toContain("on a hold they can still send work");
    expect(src("components/OwedBox.tsx")).not.toContain("Testers can still send work");
  });
});
