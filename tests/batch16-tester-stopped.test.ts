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
    expect(R.workOverLine({ ...stopped, endKind: "early" }, "Nora Lane", fmt, "Cancel call")).toBe("Your part in this test has ended, so your Cancel call didn't go through."); // (§364 item 3)
    expect(R.workOverPress("key-broken")).toBe(""); // (Owner, Nov 6, §304) "This key doesn't work" is gone
    expect(["terms", "written", "recording-send", "answer-request", "cancel-set"].map((a) => R.workOverPress(a, a === "terms" ? { choice: "keep" } : a === "answer-request" ? { action: "withdraw" } : {}))).toEqual(["Keep", "Send Answers", "Send", "Withdraw", "Cancel the remaining calls"]); // (Nov 9 small fixes) the buttons' real labels
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
      expect(r.body.error.message, action).toBe(`This test was stopped, so your ${press} didn't go through.`); // (Owner, Nov 9, §363; no name, date or tail)
    };
    await refused("written", { answers: ["a", "b"] }, "Send Answers");
    await refused("recording-send", {}, "Send");
    await refused("recording-start", { filename: "a.webm", size: 10, contentType: "video/webm" }, "upload");
    await refused("recording-done", { recordingId: "x" }, "upload");
    await refused("recording-remove", { recordingId: "x" }, "Remove");
    // (Batch 35 §118) Switch / Keep after the part ended: the offer closed, one plain line (not the stopped line naming the press).
    for (const choice of ["switch", "keep"]) {
      const t = await sact(sessionId, "terms", tester.cookie, { seenAt: opened, offerId: offer.id, choice });
      expect(t.status).toBe(409);
      expect(t.body.error.message).toBe(`This test was stopped, so your ${choice === "keep" ? "Keep" : "Switch"} didn't go through.`); // (§363 / §364)
    }
    await refused("request-time", { startsAt: atHours(100) }, "Request a time");
    await refused("answer-request", { requestId: reqRow.id, action: "accept" }, "Accept");
    await refused("answer-request", { requestId: reqRow.id, action: "decline" }, "Decline");
    await refused("answer-request", { requestId: reqRow.id, action: "withdraw" }, "Withdraw");
    // (Batch 17 section 12; Owner, Nov 9, §363) Cancel call: the stop already cancelled the calls ahead; the one stopped line names the press.
    // (Owner, Nov 11, §380) Cancel call on a call the stop already cancelled: silent (already what it wanted). A set that isn't hers keeps the stopped line.
    const cc = await sact(sessionId, "cancel-call", tester.cookie, { seenAt: opened, callId: call.id });
    expect([cc.status, cc.body.already]).toEqual([200, true]);
    const cs = await sact(sessionId, "cancel-set", tester.cookie, { seenAt: opened, setId: "x" });
    expect(cs.body.error).toMatchObject({ code: "work_over", message: "This test was stopped, so your Cancel the remaining calls didn't go through." });
    // Final: pressing again never goes ahead.
    await refused("written", { answers: ["a", "b"], confirmed: true }, "Send Answers");
  });

  // (Batch 29 section 11) The stop itself is a change like any other: Dispute stops once naming it (never for the stop's own cancellations), then goes through.
  it("after a stop: Dispute stops once for the stop alone (the stop's own cancellations never stop it); chat and Rate go through", async () => {
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
    const d0 = await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question in full.", seenAt: opened });
    expect(d0.body.error.changes.map((x: { text: string }) => x.text), JSON.stringify(d0.body)).toEqual([expect.stringMatching(/^Nora Lane stopped this test at /)]);
    const d = await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question in full.", seenAt: opened, confirmed: true, boxAt: seen() });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    const m = await sact(sessionId, "message", tester.cookie, { body: "Thanks for testing with me.", seenAt: opened });
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    const r = await sact(sessionId, "rate", tester.cookie, { stars: 4, comment: "Clear test.", seenAt: opened });
    expect(r.body.error?.code, JSON.stringify(r.body)).not.toBe("stop_once");
  });

  it("Let it go goes through on the first press from a page opened before End early", async () => {
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
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // A page opened after it: straight through.
    const sub2 = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date(), payBy: new Date(Date.now() - 86_400_000), choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * 86_400_000) } });
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub2.id, choice: "letgo", seenAt: seen() })).status).toBe(200);
  });
});

describe("the session page after the work is over (source)", () => {
  it("the key box, Leave, the offer, Send and the call tools are gone; the top line names a refused press; the page goes to its top", () => {
    const page = src("app/app/sessions/[id]/page.tsx");
    expect(page).toContain('const key = c.status === "working" ? await keyOf(c.id) : null;'); // no key box
    expect(page).toContain('{c.status === "working" && !meOff && ('); // Leave
    expect(page).toContain("offer={offer && !refusal ?");
    expect(page).toContain("canSend={!refusal && canSendAgain(recording) && !meOff && draftsShown}"); // (batch 30 §2) a paid recording can be sent again
    expect(page).toContain("joinable: !paused && !refusal && callJoinable(x, now)");
    expect(page).toContain("(pendingReqs.length > 0 && !paused && !refusal)");
    expect(page).toContain("over ? stillWorksLine({ ...c, teamTime: c.endedAt ? stopTimeIn(c.endedAt, u.timeZone, now) : undefined }, dev, fmtDate, stillWorks) : refusal"); // (batch 26 section 3) a team Stop never names who; (§380 KR) the refused press is its own short line above
    expect(page).toContain('"data-work-over-failed": failedPress');
    expect(page).toContain("(!over || stillWorks.charge || stillWorks.dispute || stillWorks.rate) && <TesterAlertsToggle");
    expect(page).not.toContain("This test is stopped. You can still");
    expect(src("app/app/sessions/[id]/TesterCallPanel.tsx")).toContain("!m.cancelled && !m.started && !p.refusal && <CancelMenu");
    const client = src("lib/client.ts");
    expect(client).toContain('data?.error?.code === "work_over"');
    expect(client).toContain("window.location.href = `/app/sessions/${m[1]}?failed=${encodeURIComponent(data.error.failed)}`");
  });
});
