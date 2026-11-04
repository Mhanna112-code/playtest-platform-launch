import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { TEAM_CLOSED_NO_CHANGE } from "@/lib/moneyLines";
import { PAYMENT_RULES } from "@/lib/termsOfUse";
import { pay, payMore } from "./b15";
import { addTo, joined, sact, seen, settle, setup } from "./fixtures";
import { makeUser } from "./helpers";

// (Owner, Nov 4, §183) A tester's press that sends more to a part already sent (Add to this answer, a Send of the answers to changed questions, adding
// recordings) always stops once, whatever her Alerts, when the developer made a payment on THAT part since her page loaded (Pay, Pay more, the $0 answer to her
// update, a delayed payment going through). A payment on her other part keeps following her Alerts. A press that could only be refused is refused at once.

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

describe("§183 Add to this answer after a payment on the written answers", () => {
  it("Pay more on them after her page loaded: the first Add stops once, the payment line forced (Alerts Off); the second press goes", async () => {
    const w = await world();
    const loaded = seen();
    await settle();
    expect((await more(w, w.written.id)).status).toBe(200);
    await settle();
    const first = await addTo(w.sessionId, w.tester.cookie, { text: "One more thing about the boats.", seenAt: loaded, loadedAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(lines(first)).toEqual([expect.objectContaining({ text: "Nora Lane paid you $2.00 more for your written answers", forced: true })]);
    await settle();
    const second = await addTo(w.sessionId, w.tester.cookie, { text: "One more thing about the boats.", seenAt: loaded, boxAt: seen(), confirmed: true });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
  });

  it("the developer's $0 answer to her update stops the next Add once, forced", async () => {
    const w = await world();
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
    expect(lines(first)).toEqual([expect.objectContaining({ text: "Nora Lane paid $0 more for what you added to your written answers", forced: true })]);
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
    expect(closed.body.error, JSON.stringify(closed.body)).toMatchObject({ code: "paid", message: TEAM_CLOSED_NO_CHANGE });
  });
});

describe("§183 adding recordings after a payment on the recording", () => {
  it("Pay more on the recording after her page loaded: the add stops once, forced (Alerts Off); the second press goes", async () => {
    const w = await world();
    await addRecording(w.sessionId, w.tester.cookie);
    const loaded = seen();
    await settle();
    expect((await more(w, w.rec.id)).status).toBe(200);
    await settle();
    const first = await sact(w.sessionId, "recording-send", w.tester.cookie, { seenAt: loaded, loadedAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(lines(first)).toEqual([expect.objectContaining({ text: "Nora Lane paid you $2.00 more for your recording", forced: true })]);
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
  it("“Changes while you pay” says a payment on the part a tester is adding to stops her press once", () => {
    const c = PAYMENT_RULES.find((r) => r.heading === "Changes while you pay")!;
    expect(c.text).toContain("A payment by the developer on a part the tester is sending more to (Send, Add to this answer, adding recordings) since the tester's page showed it also stops that press once, whatever the tester's Alerts.");
  });
});
