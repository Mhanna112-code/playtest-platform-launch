import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { teamClosedNoChange } from "@/lib/moneyLines";
import { PAYMENT_RULES } from "@/lib/termsOfUse";
import { pay, payMore } from "./b15";
import { addTo, joined, sact, seen, settle, setup } from "./fixtures";
import { makeUser } from "./helpers";
import { testerGate } from "@/lib/server/testerGate";

// (§362) Developer payments on the part a Send / Add / Dispute is about stop it once whatever the Alerts (forced); final refusals still apply.

const ANS = "The harbour level was clear and the boats handled well on the first try.";
type Res = { status: number; body: { error?: { code?: string; message?: string; changes?: { text: string; forced?: boolean }[] } } & Record<string, unknown> };
const lines = (r: Res) => r.body.error?.changes ?? [];

async function addRecording(sessionId: string, cookie: string) {
  const r = await sact(sessionId, "recording-start", cookie, { filename: "run.mp4", size: 1000, contentType: "video/mp4" });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect((await sact(sessionId, "recording-done", cookie, { recordingId: r.body.recordingId })).status).toBe(200);
}

/** Ana sent her written answers and a recording, both paid; her Alerts are Off. */
async function world(alertsOff = true) {
  const s = await setup({ recordingCents: "10.00" });
  const j = await joined(s.testId);
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: [ANS, ANS], seenAt: seen(), confirmed: true })).status).toBe(200);
  await addRecording(j.sessionId, j.tester.cookie);
  expect((await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
  const written = await db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: j.sessionId, kind: "written" } } });
  const rec = await db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: j.sessionId, kind: "recording" } } });
  for (const id of [written.id, rec.id]) expect((await pay(s.dev.cookie, { kind: "submission", id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  await db.user.update({ where: { id: j.tester.user.id }, data: { testerAlertsOff: alertsOff } });
  await settle();
  return { ...s, ...j, written, rec };
}
type W = Awaited<ReturnType<typeof world>>;
const more = (w: W, submissionId: string, amount = "2.00") => payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId, amount, tickedCents: Math.round(Number(amount) * 100) });

// (Owner, Nov 9, §362; restores §183 and batch 35 §68 after Codex 343018a9) A developer payment on the part a Send / Add (written answers or a recording) or a
// Dispute is about stops that press once WHATEVER the tester's Alerts, marked forced; the second press goes ahead. Payments on her other parts follow Alerts, and
// Charge / Let it go's owed rule stays removed (it follows Alerts).
const forcedLines = (r: Res) => lines(r).filter((x) => x.forced);
const dispute = (w: W, id: string, body: Record<string, unknown>) => sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id, reason: "I answered every question fully and in detail.", ...body });

describe("§362 a payment on the same part stops Send / Add / Dispute once, whatever the Alerts", () => {
  it.each([true, false])("the gate: Dispute's part forced (Alerts Off=%s); Charge's owed part follows Alerts", async (off) => {
    const w = await world(off);
    const loaded = seen();
    await settle();
    expect((await more(w, w.written.id)).status).toBe(200);
    await settle();
    await expect(testerGate(w.tester.user.id, w.sessionId, w.testId, { seenAt: loaded, loadedAt: loaded }, undefined, { piece: w.written.id })).rejects.toMatchObject({ code: "stop_once", data: { changes: [expect.objectContaining({ forced: true })] } });
    const charge = testerGate(w.tester.user.id, w.sessionId, w.testId, { seenAt: loaded, loadedAt: loaded }, undefined, { owedPiece: w.written.id });
    if (off) await expect(charge).resolves.toBeUndefined();
    else await expect(charge).rejects.toMatchObject({ code: "stop_once" });
  });

  it.each(["written", "recording", "zero"])("Alerts Off: a same-part %s payment stops the add once (forced); the second press goes ahead", async (kind) => {
    const w = await world();
    if (kind === "recording") await addRecording(w.sessionId, w.tester.cookie);
    if (kind === "zero") expect((await addTo(w.sessionId, w.tester.cookie, { text: "An initial addition.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const loaded = seen();
    await settle();
    expect((await more(w, kind === "recording" ? w.rec.id : w.written.id, kind === "zero" ? "0" : "2.00")).status).toBe(200);
    await settle();
    const press = (extra: Record<string, unknown>) => kind === "recording"
      ? sact(w.sessionId, "recording-send", w.tester.cookie, { add: true, ...extra })
      : addTo(w.sessionId, w.tester.cookie, { text: "An addition after payment.", ...extra });
    const first = await press({ seenAt: loaded, loadedAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(lines(first).length).toBe(1);
    expect(forcedLines(first)).toEqual([expect.objectContaining({ text: kind === "zero" ? "Nora Lane paid $0 more for what you added to your written answers" : `Nora Lane paid you $2.00 more for your ${kind === "recording" ? "recording" : "written answers"}` })]);
    expect(first.body.error).toMatchObject({ alertsOff: true });
    await settle();
    const second = await press({ seenAt: loaded, boxAt: seen(), confirmed: true });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
  });

  it("Alerts Off: a payment on ANOTHER part stops neither the written Add nor the recording add", async () => {
    const w = await world();
    await addRecording(w.sessionId, w.tester.cookie);
    const loaded = seen();
    await settle();
    expect((await more(w, w.rec.id)).status).toBe(200);
    await settle();
    expect((await addTo(w.sessionId, w.tester.cookie, { text: "Added with Alerts Off.", seenAt: loaded, loadedAt: loaded })).status).toBe(200);
    const v = await world();
    await addRecording(v.sessionId, v.tester.cookie);
    const loaded2 = seen();
    await settle();
    expect((await more(v, v.written.id)).status).toBe(200);
    await settle();
    expect((await sact(v.sessionId, "recording-send", v.tester.cookie, { add: true, seenAt: loaded2, loadedAt: loaded2 })).status).toBe(200);
  });

  it("Alerts Off: a Pay more on the disputed part stops Dispute once (forced), the second goes ahead; one on another part doesn't stop it", async () => {
    const w = await world();
    const loaded = seen();
    await settle();
    expect((await more(w, w.written.id)).status).toBe(200);
    await settle();
    const first = await dispute(w, w.written.id, { seenAt: loaded, loadedAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(forcedLines(first)).toEqual([expect.objectContaining({ text: "Nora Lane paid you $2.00 more for your written answers" })]);
    await settle();
    const second = await dispute(w, w.written.id, { seenAt: loaded, boxAt: seen(), confirmed: true });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    const v = await world();
    const loaded2 = seen();
    await settle();
    expect((await more(v, v.rec.id)).status).toBe(200);
    await settle();
    const other = await dispute(v, v.written.id, { seenAt: loaded2, loadedAt: loaded2 });
    expect(other.status, JSON.stringify(other.body)).toBe(200);
  });

  it("every Send / Add route passes its sent part to the gate (Send Answers' resend, Add to this answer, a recording's Send or Add)", () => {
    const tests = fs.readFileSync(path.resolve(__dirname, "../src/lib/server/tests.ts"), "utf8");
    expect(tests).toContain("await testerSendGate(tx, contractId, body, sent?.id, { stale: [] });"); // Send Answers (a resend; §375: in its one pass)
    expect(tests).toContain("await testerSendGate(tx, contractId, body, before?.id, { stale: [] });"); // Add to this answer
    expect(fs.readFileSync(path.resolve(__dirname, "../src/lib/server/recordings.ts"), "utf8")).toContain("await testerSendGate(tx, contractId, body, sent?.id);"); // a recording's Send / Add
  });
});

describe("§183 Add to this answer after a payment on the written answers", () => {
  it("Pay more on them after her page loaded: the first Add stops once (forced, §362); the second press goes", async () => {
    const w = await world(false);
    const loaded = seen();
    await settle();
    expect((await more(w, w.written.id)).status).toBe(200);
    await settle();
    const first = await addTo(w.sessionId, w.tester.cookie, { text: "One more thing about the boats.", seenAt: loaded, loadedAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(lines(first).every((line) => line.forced)).toBe(true); // (§362) forced whatever the Alerts
    expect(lines(first)).toEqual([expect.objectContaining({ text: "Nora Lane paid you $2.00 more for your written answers" })]);
    await settle();
    const second = await addTo(w.sessionId, w.tester.cookie, { text: "One more thing about the boats.", seenAt: loaded, boxAt: seen(), confirmed: true });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
  });

  it("the developer's $0 answer to her update stops the next Add once (forced, §362)", async () => {
    const w = await world(false);
    expect((await addTo(w.sessionId, w.tester.cookie, { text: "First addition after the Pay.", seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const loaded = seen();
    await settle();
    const zero = await more(w, w.written.id, "0");
    expect(zero.status, JSON.stringify(zero.body)).toBe(200);
    expect((await db.submission.findUniqueOrThrow({ where: { id: w.written.id } })).paidUpdateZeroAt).not.toBeNull();
    await settle();
    const first = await addTo(w.sessionId, w.tester.cookie, { text: "Second addition.", seenAt: loaded, loadedAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(lines(first).every((line) => line.forced)).toBe(true); // (§362) forced whatever the Alerts
    expect(lines(first)).toEqual([expect.objectContaining({ text: "Nora Lane paid $0 more for what you added to your written answers" })]);
  });

  it("a payment on her recording does NOT stop an Add on the written answers with Alerts Off; with Alerts on it stops, not forced", async () => {
    const off = await world();
    const loaded = seen();
    await settle();
    expect((await more(off, off.rec.id)).status).toBe(200);
    await settle();
    const r = await addTo(off.sessionId, off.tester.cookie, { text: "Added with Alerts Off.", seenAt: loaded, loadedAt: loaded });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const on = await world(false);
    const loaded2 = seen();
    await settle();
    expect((await more(on, on.rec.id)).status).toBe(200);
    await settle();
    const s = await addTo(on.sessionId, on.tester.cookie, { text: "Added with Alerts on.", seenAt: loaded2, loadedAt: loaded2 });
    expect(s.body.error?.code, JSON.stringify(s.body)).toBe("stop_once");
    expect(lines(s).map((x) => [x.text, !!x.forced])).toEqual([["Nora Lane paid you $2.00 more for your recording", false]]);
  });

  it("a press that could only be refused is refused at once: the team closed the part at $0 since the page loaded; a Send with the same questions", async () => {
    const w = await world();
    const loaded = seen();
    await settle();
    expect((await more(w, w.written.id)).status).toBe(200);
    await settle();
    const locked = await sact(w.sessionId, "written", w.tester.cookie, { answers: [ANS, ANS], seenAt: loaded, loadedAt: loaded });
    expect(locked.body.error?.code, JSON.stringify(locked.body)).toBe("locked");

    const t = await world();
    const admin = await makeUser({ name: "Team Admin" });
    const loaded2 = seen();
    await settle();
    // A Pay more (a forced line for this Add) and then the team's closure: the Add can only be refused, so it is, with no stop first.
    expect((await more(t, t.written.id)).status).toBe(200);
    await db.review.update({ where: { submissionId: t.written.id }, data: { teamClosedById: admin.user.id } });
    const closed = await addTo(t.sessionId, t.tester.cookie, { text: "Too late to add.", seenAt: loaded2, loadedAt: loaded2 });
    expect(closed.body.error, JSON.stringify(closed.body)).toMatchObject({ code: "paid", message: teamClosedNoChange("Add") }); // (§386 B)
  });
});

describe("§183 adding recordings after a payment on the recording", () => {
  it("Pay more on the recording after her page loaded: the add stops once (forced, §362); the second press goes", async () => {
    const w = await world(false);
    await addRecording(w.sessionId, w.tester.cookie);
    const loaded = seen();
    await settle();
    expect((await more(w, w.rec.id)).status).toBe(200);
    await settle();
    const first = await sact(w.sessionId, "recording-send", w.tester.cookie, { seenAt: loaded, loadedAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(lines(first).every((line) => line.forced)).toBe(true); // (§362) forced whatever the Alerts
    expect(lines(first)).toEqual([expect.objectContaining({ text: "Nora Lane paid you $2.00 more for your recording" })]);
    await settle();
    const second = await sact(w.sessionId, "recording-send", w.tester.cookie, { seenAt: loaded, boxAt: seen(), confirmed: true });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({ sent: true, added: 1 });
  });

  it("a payment on her written answers does NOT stop a recording add with Alerts Off", async () => {
    const w = await world();
    await addRecording(w.sessionId, w.tester.cookie);
    const loaded = seen();
    await settle();
    expect((await more(w, w.written.id)).status).toBe(200);
    await settle();
    const r = await sact(w.sessionId, "recording-send", w.tester.cookie, { seenAt: loaded, loadedAt: loaded });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it("nothing new to add after a payment on it: refused at once, never a stop first", async () => {
    const w = await world();
    const loaded = seen();
    await settle();
    expect((await more(w, w.rec.id)).status).toBe(200);
    await settle();
    const r = await sact(w.sessionId, "recording-send", w.tester.cookie, { seenAt: loaded, loadedAt: loaded });
    expect(r.body.error?.code, JSON.stringify(r.body)).toBe("none");
  });
});

describe("§183 the Terms", () => {
  it("“Changes while you pay” says a payment on the part a tester is adding to or disputing stops their press once whatever their Alerts (§362)", () => {
    const c = PAYMENT_RULES.find((r) => r.heading === "Changes while you pay")!;
    expect(c.text).toContain("A developer payment on a part the tester is adding to or disputing (written answers or a recording) always stops their Send, Add or Dispute press once, whatever their Alerts; other developer payment updates follow the tester’s Alerts.");
    expect(c.text).not.toContain("Ordinary developer payments follow the tester’s Alerts, even on that part.");
    expect(c.text).toContain("Unavailable actions are refused immediately, including Charge or Let it go after the developer pays.");
    expect(c.text).toContain("a team decision or the developer adding their side to the tester’s dispute forces a stop on applicable buttons.");
  });
});
