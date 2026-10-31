import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as excerptsPOST } from "@/app/api/excerpts/route";
import { closedForSuspended } from "@/lib/closedPages";
import { json, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 16 sections 25 and 28, the tester's side: what still works goes through on the first press; a suspended tester's limited view of tests they were removed from.
const DAY = 86_400_000;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const ex = (cookie: string, body: Record<string, unknown>) => excerptsPOST(req("/api/excerpts", { cookie, body })).then(json);
const ANSWER = "The harbour level felt great, but the second boss was far too hard for me.";

type State = "stopped" | "ended early" | "left" | "removed" | "paused";

/** Ana sent written answers (paid $4 before the page loaded, or left unreviewed with Charge open) and a recording (paid by the developer AFTER the page loaded). */
async function scene(state: State, written: "paid" | "charge-open") {
  const { dev, testId } = await setup({ recordingCents: "15.00" });
  const { tester, sessionId } = await joined(testId);
  await sact(sessionId, "written", tester.cookie, { answers: [ANSWER, "Nowhere really, it was smooth."], seenAt: seen(), confirmed: true });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId, kind: "written" } });
  if (written === "paid") expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Short answers" })).status).toBe(200);
  else await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY), payBy: new Date(Date.now() - DAY) } });
  const rec = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 1500, sentAt: new Date(), updatedAt: new Date(), payBy: new Date(Date.now() + 7 * DAY), devMarks: [] } });
  // The state, then the page loads.
  if (state === "stopped") expect((await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
  if (state === "ended early") expect((await act(testId, "end-early", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], reason: "We have enough" })).status).toBe(200);
  if (state === "left") expect((await sact(sessionId, "leave", tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
  if (state === "removed") {
    await db.contract.update({ where: { id: sessionId }, data: { status: "left", endKind: "suspended", endedAt: new Date() } });
    await db.user.update({ where: { id: tester.user.id }, data: { testerSuspendedAt: new Date() } });
  }
  if (state === "paused") await db.test.update({ where: { id: testId }, data: { adminPausedAt: new Date() } });
  await settle();
  const opened = seen();
  await settle();
  // Something the developer did after the page loaded (it would stop a press once in a normal session).
  expect((await pay(dev.cookie, { kind: "submission", id: rec.id, amount: "15.00", tickedCents: 1500 })).status).toBe(200);
  await settle();
  return { dev, testId, tester, sessionId, sub, rec, opened };
}

// (Owner, Oct 29, batch 29 section 11) Section 25's "goes through on the first press" is replaced: what still works follows the running test's stop-once rules.
describe("what still works follows the running test's stop-once rules (batch 29 section 11, tester)", () => {
  for (const state of ["stopped", "ended early", "left", "removed", "paused"] as const) {
    it(`${state}: Dispute and Charge / Let it go stop once for a payment made after the page loaded, then go ahead`, async () => {
      const a = await scene(state, "paid");
      const d0 = await sact(a.sessionId, "dispute", a.tester.cookie, { kind: "submission", id: a.sub.id, reason: "I answered every question in full.", seenAt: a.opened });
      expect(d0.body.error?.changes.map((x: { text: string }) => x.text), JSON.stringify(d0.body)).toEqual(["Nora Lane paid $15.00 for your recording"]);
      const d = await sact(a.sessionId, "dispute", a.tester.cookie, { kind: "submission", id: a.sub.id, reason: "I answered every question in full.", seenAt: a.opened, confirmed: true, boxAt: seen() });
      expect(d.status, JSON.stringify(d.body)).toBe(200);
      // Refusals stay: a second dispute on the same piece.
      const again = await sact(a.sessionId, "dispute", a.tester.cookie, { kind: "submission", id: a.sub.id, reason: "I answered every question in full.", seenAt: a.opened });
      expect(again.status).toBe(409);
      const b = await scene(state, "charge-open");
      const c = await sact(b.sessionId, "choose", b.tester.cookie, { submissionId: b.sub.id, choice: "letgo", seenAt: b.opened });
      if (state === "removed") {
        // (Batch 17 section 10) In the suspended tester's limited view Dispute is the only press: Charge and Let it go wait for the reinstatement.
        expect(c.body.error.message).toBe("You can do this once your account is active again.");
        return;
      }
      expect(c.body.error?.code, JSON.stringify(c.body)).toBe("stop_once");
      const c2 = await sact(b.sessionId, "choose", b.tester.cookie, { submissionId: b.sub.id, choice: "letgo", seenAt: b.opened, confirmed: true, boxAt: seen() });
      expect(c2.status, JSON.stringify(c2.body)).toBe(200);
      expect((await sact(b.sessionId, "choose", b.tester.cookie, { submissionId: b.sub.id, choice: "letgo", seenAt: b.opened })).body.error.message).toBe("You already chose for this.");
    }, 60_000);
  }

  it("Rate: the one exception, it stops once for a payment that arrived since the page loaded, then goes through", async () => {
    const a = await scene("stopped", "paid");
    const r1 = await sact(a.sessionId, "rate", a.tester.cookie, { stars: 4, comment: "Clear test.", seenAt: a.opened });
    expect(r1.body.error?.code, JSON.stringify(r1.body)).toBe("stop_once");
    expect(r1.body.error.changes.some((x: { text: string }) => /paid \$15\.00/.test(x.text))).toBe(true);
    const r2 = await sact(a.sessionId, "rate", a.tester.cookie, { stars: 4, comment: "Clear test.", seenAt: a.opened, confirmed: true, boxAt: r1.body.error.now ?? new Date().toISOString() });
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
  }, 60_000);

  it("Rate with nothing about the work since the page loaded: the stop itself stops it once (batch 17 section 12), then it goes through", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: [ANSWER, "Smooth."], seenAt: seen(), confirmed: true });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    await bookCall(testId, dev.cookie, sessionId, tester.cookie, 72);
    await settle();
    const opened = seen();
    await settle();
    expect((await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200); // cancels the call: not news for Rate
    const r = await sact(sessionId, "rate", tester.cookie, { stars: 5, comment: "", seenAt: opened });
    expect(r.body.error.changes.map((x: { text: string }) => x.text), JSON.stringify(r.body)).toEqual([expect.stringMatching(/^Nora Lane stopped this test at /)]);
    await settle();
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 5, comment: "", seenAt: opened, confirmed: true, boxAt: seen() })).status).toBe(200);
  });

  it("paused: Cancel call stops once for a payment since the page loaded (batch 29 section 11); Leave stops once too (batch 35 §59)", async () => {
    const { dev, testId } = await setup({ recordingCents: "15.00" });
    const { tester, sessionId } = await joined(testId);
    await bookCall(testId, dev.cookie, sessionId, tester.cookie, 72);
    const call = await db.call.findFirstOrThrow({ where: { contractId: sessionId, status: "booked" } });
    const rec = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 1500, sentAt: new Date(), updatedAt: new Date(), payBy: new Date(Date.now() + 7 * DAY), devMarks: [] } });
    await db.test.update({ where: { id: testId }, data: { adminPausedAt: new Date() } });
    await settle();
    const opened = seen();
    await settle();
    expect((await pay(dev.cookie, { kind: "submission", id: rec.id, amount: "15.00", tickedCents: 1500 })).status).toBe(200);
    const c0 = await sact(sessionId, "cancel-call", tester.cookie, { callId: call.id, reason: "Something came up at work.", seenAt: opened });
    expect(c0.body.error?.code, JSON.stringify(c0.body)).toBe("stop_once");
    const c = await sact(sessionId, "cancel-call", tester.cookie, { callId: call.id, reason: "Something came up at work.", seenAt: opened, confirmed: true, boxAt: seen() });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    // (Batch 35 §59) Leave stops once too (the payment since the page loaded); confirmed, it leaves.
    const l0 = await sact(sessionId, "leave", tester.cookie, { seenAt: opened });
    expect(l0.body.error?.code, JSON.stringify(l0.body)).toBe("stop_once");
    const l = await sact(sessionId, "leave", tester.cookie, { seenAt: opened, confirmed: true });
    expect(l.status, JSON.stringify(l.body)).toBe(200);
  });

  it("a normal working session still stops once (nothing changed for it)", async () => {
    const { dev, testId } = await setup({ recordingCents: "15.00" });
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: [ANSWER, "Smooth."], seenAt: seen(), confirmed: true });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Short answers" })).status).toBe(200);
    const rec = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 1500, sentAt: new Date(), updatedAt: new Date(), payBy: new Date(Date.now() + 7 * DAY), devMarks: [] } });
    await settle();
    const opened = seen();
    await settle();
    expect((await pay(dev.cookie, { kind: "submission", id: rec.id, amount: "15.00", tickedCents: 1500 })).status).toBe(200);
    const d = await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question in full.", seenAt: opened });
    expect(d.body.error?.code).toBe("stop_once");
  });
});

describe("a suspended tester's limited view of tests they were removed from (section 28)", () => {
  it("only Dispute, Charge, Let it go and Rate work; everything else and excerpt requests are refused while suspended; excerpts work after reinstating", async () => {
    const a = await scene("removed", "paid");
    // Allowed (the dispute and the rate are covered above too; batch 29 section 11: after its stop once for the payment).
    expect((await sact(a.sessionId, "dispute", a.tester.cookie, { kind: "submission", id: a.sub.id, reason: "I answered every question in full.", seenAt: a.opened, confirmed: true, boxAt: seen() })).status).toBe(200);
    // Everything else stays refused while suspended.
    for (const [action, body] of [["message", { body: "hi" }], ["written", { answers: ["a", "b"] }], ["request-time", { startsAt: new Date(Date.now() + 3 * DAY).toISOString() }], ["leave", {}]] as const) {
      const r = await sact(a.sessionId, action, a.tester.cookie, { seenAt: a.opened, ...body });
      expect(r.status, action).toBe(403);
      expect(r.body.error.code, action).toBe("suspended");
    }
    const ask = () => ex(a.tester.cookie, { action: "request", submissionId: a.sub.id, index: 0, text: "the second boss was far too hard" });
    expect((await ask()).status).toBe(403);
    await db.user.update({ where: { id: a.tester.user.id }, data: { testerSuspendedAt: null } });
    expect((await ask()).status).toBe(200); // after reinstating, from a test they were removed from
    // A tester who was NOT removed (another test) and is suspended: Dispute stays refused there.
    const b = await scene("stopped", "paid");
    await db.user.update({ where: { id: b.tester.user.id }, data: { testerSuspendedAt: new Date() } });
    expect((await sact(b.sessionId, "dispute", b.tester.cookie, { kind: "submission", id: b.sub.id, reason: "I answered every question in full.", seenAt: b.opened })).status).toBe(403);
  }, 60_000);

  it("excerpt requests from a test the tester left work (not suspended)", async () => {
    const a = await scene("left", "paid");
    const r = await ex(a.tester.cookie, { action: "request", submissionId: a.sub.id, index: 0, text: "the second boss was far too hard" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }, 60_000);

  it("the page: open for a suspended tester only as the limited view; the dashboard row opens it", () => {
    const u = { isDeveloper: false, isTester: true, side: "tester", testerSuspendedAt: new Date() };
    expect(closedForSuspended("/app/sessions/abc", u, "tester")).toBe(false); // the page decides
    expect(closedForSuspended("/app/find", u, "tester")).toBe(true); // Find stays closed
    expect(closedForSuspended("/app/testers/x", u, "tester")).toBe(true); // profiles too
    expect(R.LIMITED_VIEW_LINE).toBe("Your account is paused. You can still dispute a payment."); // (batch 17 section 10)
    const page = src("app/app/sessions/[id]/page.tsx");
    expect(page).toContain('const limited = !!u.testerSuspendedAt && c.status !== "working" && c.endKind === "suspended";');
    expect(page).toContain('if (u.testerSuspendedAt && !limited) redirect("/app");');
    expect(page).toContain('{limited && <p className="info" data-limited-view="">{LIMITED_VIEW_LINE}</p>}');
    expect(page).toContain("{!limited && (c.calls.length > 0 || canRequestCall || pendingReqs.length > 0) && (");
    expect(page).toContain('{(rateState.kind === "open" || rateState.kind === "disabled") && !meOff && ('); // (batch 17 section 2) no Rate there
    expect(page).toContain("const canChoose = !meOff;"); // (batch 17 section 10) no Charge / Let it go there
    expect(page).toContain("off={meOff && !limited}");
    // Hidden there: chat, the key box (not working), Leave (not working), excerpt requests (excerptPicks need an active tester side).
    expect(page).toContain("!excerptPending && !u.testerSuspendedAt ? await excerptChoices(written)");
    expect(src("app/app/page.tsx")).toContain("href={`/app/sessions/${c.id}`} className=\"text-white\" data-removed-open={c.id}");
  });
});
