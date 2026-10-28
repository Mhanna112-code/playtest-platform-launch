import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, req } from "./helpers";
import { act, atHours, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 16 section 24: the tester's page after the test stops, closes, or their work is ended early.
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);

describe("the stopped line and the press names (section 24)", () => {
  const at = new Date("2026-11-03T15:00:00Z");
  const stopped = { status: "ended", endKind: "stopped", endedAt: at };
  it("lists what still works, built from what's available; names a refused press", () => {
    expect(R.stillWorksLine(stopped, "Nora Lane", fmt, { charge: true, dispute: true, rate: true, chat: true }))
      .toBe("Nora Lane stopped the test on Nov 3. You can still charge or let go of unreviewed work, dispute, rate and chat. Work you sent is still reviewed.");
    expect(R.stillWorksLine(stopped, "Nora Lane", fmt, { rate: true, chat: true })).toBe("Nora Lane stopped the test on Nov 3. You can still rate and chat. Work you sent is still reviewed.");
    expect(R.stillWorksLine(stopped, "Nora Lane", fmt, {})).toBe("Nora Lane stopped the test on Nov 3. Work you sent is still reviewed.");
    expect(R.stillWorksLine({ ...stopped, endKind: "closed" }, "Nora Lane", fmt, { chat: true }, "Send")).toBe("This test ended on Nov 3, so your Send didn't go through. You can still chat. Work you sent is still reviewed.");
    expect(R.workOverLine({ ...stopped, endKind: "early" }, "Nora Lane", fmt, "Cancel call")).toBe("Nora Lane ended your session early on Nov 3, so your Cancel call didn't go through. Work you sent is still reviewed.");
    expect(R.workOverLine(stopped, "Nora Lane", fmt, R.workOverPress("key-broken"))).toBe("Nora Lane stopped the test on Nov 3, so your “This key doesn't work” didn't go through. Work you sent is still reviewed.");
    expect(["terms", "written", "recording-send", "answer-request", "cancel-set"].map((a) => R.workOverPress(a, a === "terms" ? { choice: "keep" } : a === "answer-request" ? { action: "withdraw" } : {}))).toEqual(["Keep", "Send", "Send", "Withdraw", "Cancel call"]);
    // A block, a rating or a leave aren't "the work is over" here (a block keeps its neutral line).
    expect(R.workOver({ status: "ended", endKind: "blocked", endedAt: at })).toBe(false);
    expect(R.workOver({ status: "left", endKind: "", endedAt: at })).toBe(false);
    expect(R.workOver({ status: "ended", endKind: "early", endedAt: at })).toBe(true);
  });
});

describe("after a stop: what's gone is refused and names the press; what still works goes through on the first press", () => {
  it("each hidden press from an old page is refused with the line naming it and the move to the top (no stop box)", async () => {
    const { dev, testId } = await setup({ accessKeys: "K1\nK2\nK3" });
    const { tester, sessionId } = await joined(testId);
    await bookCall(testId, dev.cookie, sessionId, tester.cookie, 72);
    const call = await db.call.findFirstOrThrow({ where: { contractId: sessionId, status: "booked" } });
    await act(testId, "edit", dev.cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields: { writtenCents: "12.00" }, seenAt: seen(), confirmed: true });
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: sessionId } });
    await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: atHours(90) });
    const reqRow = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId, status: "pending" } });
    const opened = seen();
    await settle();
    expect((await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const refused = async (action: string, body: Record<string, unknown>, press: string) => {
      const r = await sact(sessionId, action, tester.cookie, { seenAt: opened, ...body });
      expect(r.status, action).toBe(409);
      expect(r.body.error.code, action).toBe("work_over");
      expect(r.body.error.failed, action).toBe(press);
      expect(r.body.error.top, action).toBe(true);
      expect(r.body.error.changes, action).toBeUndefined(); // never a stop box
      expect(r.body.error.message, action).toMatch(new RegExp(`^Nora Lane stopped the test on [A-Z][a-z]{2} \\d{1,2}, \\d{4}, so your ${press.replace(/[“”]/g, ".")} didn't go through\\. Work you sent is still reviewed\\.$`));
    };
    await refused("written", { answers: ["a", "b"] }, "Send");
    await refused("recording-send", {}, "Send");
    await refused("recording-start", { filename: "a.webm", size: 10, contentType: "video/webm" }, "upload");
    await refused("recording-done", { recordingId: "x" }, "upload");
    await refused("recording-remove", { recordingId: "x" }, "Remove");
    await refused("terms", { offerId: offer.id, choice: "switch" }, "Switch");
    await refused("terms", { offerId: offer.id, choice: "keep" }, "Keep");
    await refused("request-time", { startsAt: atHours(100) }, "Request a time");
    await refused("answer-request", { requestId: reqRow.id, action: "accept" }, "Accept");
    await refused("answer-request", { requestId: reqRow.id, action: "decline" }, "Decline");
    await refused("answer-request", { requestId: reqRow.id, action: "withdraw" }, "Withdraw");
    // (Batch 17 section 12) Cancel call: the stop already cancelled the calls ahead.
    for (const [action, body] of [["cancel-call", { callId: call.id }], ["cancel-set", { setId: "x" }]] as const) {
      const r = await sact(sessionId, action, tester.cookie, { seenAt: opened, ...body });
      expect(r.body.error, action).toMatchObject({ code: "call_cancelled", message: "This call was cancelled when the test stopped." });
    }
    await refused("key-broken", {}, "“This key doesn't work”");
    // Final: pressing again never goes ahead.
    await refused("written", { answers: ["a", "b"], confirmed: true }, "Send");
  });

  it("Dispute, chat and Rate go through on the first press after a stop (the stop's own cancellations never stop them)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Short answers" })).status).toBe(200);
    await bookCall(testId, dev.cookie, sessionId, tester.cookie, 72);
    await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: atHours(90) });
    await settle();
    const opened = seen();
    await settle();
    expect((await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await db.call.count({ where: { contractId: sessionId, status: "cancelled", cancelledBy: "system" } })).toBe(1);
    const d = await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question in full.", seenAt: opened });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    const m = await sact(sessionId, "message", tester.cookie, { body: "Thanks for testing with me.", seenAt: opened });
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    const r = await sact(sessionId, "rate", tester.cookie, { stars: 4, comment: "Clear test.", seenAt: opened });
    expect(r.body.error?.code, JSON.stringify(r.body)).not.toBe("stop_once");
  });

  it("Charge / Let it go after an early end: from a page opened before it, it stops once with the early end (batch 17 section 12), then goes through", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await bookCall(testId, dev.cookie, sessionId, tester.cookie, 72);
    await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * 86_400_000), payBy: new Date(Date.now() - 86_400_000) } });
    await settle();
    const opened = seen();
    await settle();
    expect((await act(testId, "end-early", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], reason: "We have enough" })).status).toBe(200);
    const r = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "letgo", seenAt: opened });
    expect(r.body.error.changes.map((x: { text: string }) => x.text), JSON.stringify(r.body)).toEqual([expect.stringMatching(/^Nora Lane ended your work early at /)]);
    await settle();
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "letgo", seenAt: opened, confirmed: true, boxAt: seen() })).status).toBe(200);
    // A page opened after it: straight through.
    const sub2 = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date(), payBy: new Date(Date.now() - 86_400_000), choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * 86_400_000) } });
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub2.id, choice: "letgo", seenAt: seen() })).status).toBe(200);
  });
});

describe("the session page after the work is over (source)", () => {
  it("the key box, Leave, the offer, Send and the call tools are gone; the top line names a refused press; the page goes to its top", () => {
    const page = src("app/app/sessions/[id]/page.tsx");
    expect(page).toContain('const key = c.status === "working" ? await keyOf(c.id) : null;'); // no key box, so no "This key doesn't work"
    expect(page).toContain('{c.status === "working" && !meOff && ('); // Leave
    expect(page).toContain("offer={offer && !refusal ?");
    expect(page).toContain("canSend={!refusal && !recording?.review && !meOff && draftsShown}");
    expect(page).toContain("joinable: !paused && !refusal && callJoinable(x, now)");
    expect(page).toContain("(pendingReqs.length > 0 && !paused && !refusal)");
    expect(page).toContain("over ? stillWorksLine(c, dev, fmtDate, stillWorks, failedPress) : refusal");
    expect(page).toContain('"data-work-over-failed": failedPress');
    expect(page).toContain("(!over || stillWorks.charge || stillWorks.dispute || stillWorks.rate) && <TesterAlertsToggle");
    expect(page).not.toContain("This test is stopped. You can still");
    expect(src("app/app/sessions/[id]/TesterCallPanel.tsx")).toContain("!m.cancelled && !m.started && !p.refusal && <CancelMenu");
    const client = src("lib/client.ts");
    expect(client).toContain('data?.error?.code === "work_over"');
    expect(client).toContain("window.location.href = `/app/sessions/${m[1]}?failed=${encodeURIComponent(data.error.failed)}`");
  });
});
