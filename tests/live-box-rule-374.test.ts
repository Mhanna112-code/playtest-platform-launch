import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as liveGET } from "@/app/api/live/route";
import { boxKeeps, liveRuleOf } from "@/lib/live";
import type { Change } from "@/components/ChangesBox";
import { pay, payMore } from "./b15";
import { act, atHours, bookCall, joined, sact, seen, settle, setup } from "./fixtures";
import { json, req } from "./helpers";

/**
 * (Owner, Nov 10, §374) §373's gaps. Every tester stop box carries the rule it was built under (the stop-moment box too, with Dispute's part; Switch / Keep's
 * "changed the terms again" box), so with Alerts Off an open box takes in a live line only if the server would have listed it: an always-stop line, or a
 * developer payment on the part the press is about; never a payment on another part. And the top box never greys a line that always stops.
 */

const ANS = "The harbour level was clear and the boats handled well on the first try.";
const WHY = "I answered every question in full and on time.";
type Err = { code?: string; changes?: Change[]; liveRule?: unknown; alertsOff?: boolean; now?: string };
type Res = { status: number; body: { error?: Err } & Record<string, unknown> };

/** Ana sent her written answers and a recording, both paid by Nora, and disputed nothing yet. */
async function world(alertsOff: boolean) {
  const s = await setup({ recordingCents: "10.00" });
  const j = await joined(s.testId);
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: [ANS, ANS], seenAt: seen(), confirmed: true })).status).toBe(200);
  const r = await sact(j.sessionId, "recording-start", j.tester.cookie, { filename: "run.mp4", size: 1000, contentType: "video/mp4" });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect((await sact(j.sessionId, "recording-done", j.tester.cookie, { recordingId: r.body.recordingId })).status).toBe(200);
  expect((await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
  const written = await db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: j.sessionId, kind: "written" } } });
  const rec = await db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: j.sessionId, kind: "recording" } } });
  for (const id of [written.id, rec.id]) expect((await pay(s.dev.cookie, { kind: "submission", id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  await db.user.update({ where: { id: j.tester.user.id }, data: { testerAlertsOff: alertsOff } });
  await settle();
  return { ...s, ...j, written, rec };
}
type W = Awaited<ReturnType<typeof world>>;
const more = (w: W, submissionId: string, amount: string) => payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId, amount, tickedCents: Math.round(Number(amount) * 100) });
const stopTest = async (w: W) => expect((await act(w.testId, "stop", w.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
/** Ana's recording was disputed before the page loaded; Nora adding her side to it is a dispute change (it always stops, §171 A2). */
const disputeRecording = async (w: W) => expect((await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.rec.id, reason: WHY, seenAt: seen(), confirmed: true })).status).toBe(200);
const devSide = (w: W) => db.dispute.updateMany({ where: { submissionId: w.rec.id }, data: { devSide: "The recording skipped the second level.", devSideAt: new Date() } });
const DEV_SIDE = "Nora Lane added her side to your dispute about your recording";
/** The live feed of a page, as LiveTop polls it. */
const live = async (w: W, since: string) =>
  (await json(await liveGET(req(`/api/live?scope=session:${w.sessionId}&since=${encodeURIComponent(since)}`, { cookie: w.tester.cookie, method: "GET", headers: { "x-tab": "t-page" } })))).body.changes as Change[];
const line = (lines: Change[], text: string | RegExp) => {
  const l = lines.find((c) => (typeof text === "string" ? c.text === text : text.test(c.text)));
  expect(l, `${text}\n in: ${JSON.stringify(lines.map((c) => c.text))}`).toBeTruthy();
  return l!;
};
const texts = (e?: Err) => (e?.changes ?? []).map((c) => c.text);

describe("§374 the stop-moment box (Dispute on a page opened before the stop) carries its rule, with the Dispute's part", () => {
  it("Alerts Off, the gate adds nothing: another part's payment doesn't join; the Dispute's own part's payment and an always-stop line do", async () => {
    const w = await world(true);
    await settle();
    const loaded = seen();
    await settle();
    await stopTest(w);
    await settle();
    const d0 = (await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.written.id, reason: WHY, seenAt: loaded })) as Res;
    expect(d0.body.error?.code, JSON.stringify(d0.body)).toBe("stop_once");
    expect(texts(d0.body.error)).toEqual([expect.stringMatching(/^Nora Lane stopped this test at /)]);
    // It used to carry neither: with Alerts Off it took in every live line (and offered "Turn off alerts" though they were Off).
    expect(d0.body.error!.alertsOff).toBe(true);
    expect(d0.body.error!.liveRule).toEqual({ off: true, part: w.written.id });
    const rule = liveRuleOf(d0.body.error as Record<string, unknown>);
    // While it is open: Nora pays more on the recording (another part) and on the written answers (the part disputed).
    await settle();
    expect((await more(w, w.rec.id, "1.00")).status).toBe(200);
    expect((await more(w, w.written.id, "1.00")).status).toBe(200);
    await settle();
    const lines = await live(w, loaded);
    const other = line(lines, "Nora Lane paid you $1.00 more for your recording");
    const samePart = line(lines, "Nora Lane paid you $1.00 more for your written answers");
    const ended = line(lines, "Nora Lane stopped the test");
    expect(boxKeeps(other, rule)).toBe(false);
    expect(boxKeeps(samePart, rule)).toBe(true);
    expect(ended.forced).toBe(true);
    expect(boxKeeps(ended, rule)).toBe(true);
    // The server agrees: the second press (the box's time) stops for the payment on the part disputed, never for the recording's.
    const d1 = (await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.written.id, reason: WHY, seenAt: loaded, confirmed: true, boxAt: d0.body.error!.now })) as Res;
    expect(d1.body.error?.code, JSON.stringify(d1.body)).toBe("stop_once");
    expect(texts(d1.body.error)).toContain("Nora Lane paid you $1.00 more for your written answers");
    expect(texts(d1.body.error)).not.toContain("Nora Lane paid you $1.00 more for your recording");
    expect(d1.body.error!.liveRule).toEqual({ off: true, part: w.written.id });
  });

  it("Alerts Off, a payment on the Dispute's part came before the press: the stop-moment box lists it (Dispute's own gate would) and not another part's", async () => {
    const w = await world(true);
    await settle();
    const loaded = seen();
    await settle();
    expect((await more(w, w.written.id, "1.00")).status).toBe(200);
    expect((await more(w, w.rec.id, "1.00")).status).toBe(200);
    await settle();
    await stopTest(w);
    await settle();
    const d0 = (await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.written.id, reason: WHY, seenAt: loaded })) as Res;
    expect(d0.body.error?.code, JSON.stringify(d0.body)).toBe("stop_once");
    const t = texts(d0.body.error);
    expect(t).toContain("Nora Lane paid you $1.00 more for your written answers");
    expect(t).not.toContain("Nora Lane paid you $1.00 more for your recording");
    expect(t.some((x) => /^Nora Lane stopped this test at /.test(x))).toBe(true);
    expect(d0.body.error!.liveRule).toEqual({ off: true, part: w.written.id });
  });

  it("Alerts On: the stop-moment box has no rule and every line joins, as before", async () => {
    const w = await world(false);
    await settle();
    const loaded = seen();
    await settle();
    await stopTest(w);
    await settle();
    const d0 = (await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.written.id, reason: WHY, seenAt: loaded })) as Res;
    expect(d0.body.error?.code, JSON.stringify(d0.body)).toBe("stop_once");
    expect(d0.body.error!.alertsOff).toBe(false);
    expect(d0.body.error!.liveRule).toBeUndefined();
    await settle();
    expect((await more(w, w.rec.id, "1.00")).status).toBe(200);
    await settle();
    expect(boxKeeps(line(await live(w, loaded), "Nora Lane paid you $1.00 more for your recording"), liveRuleOf(d0.body.error as Record<string, unknown>))).toBe(true);
  });
});

describe("§374 call presses and Switch / Keep with Alerts Off: about no part, so no payment joins their box", () => {
  it("Cancel call and Accept: stopped by a dispute change; a payment on any part doesn't join, the dispute change does", async () => {
    const w = await world(true);
    await disputeRecording(w);
    const call = await bookCall(w.testId, w.dev.cookie, w.sessionId, w.tester.cookie, 72);
    expect((await act(w.testId, "request-time", w.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [w.sessionId], startsAt: atHours(120) })).status).toBe(200);
    const ask = await db.callRequest.findFirstOrThrow({ where: { contractId: w.sessionId, fromSide: "developer", status: "pending" } });
    const callId = call.id;
    await settle();
    const loaded = seen();
    await settle();
    await devSide(w);
    await settle();
    const cancel = (await sact(w.sessionId, "cancel-call", w.tester.cookie, { callId, reason: "Something came up at work.", seenAt: loaded, loadedAt: loaded })) as Res;
    const accept = (await sact(w.sessionId, "answer-request", w.tester.cookie, { requestId: ask.id, action: "accept", seenAt: loaded, loadedAt: loaded })) as Res;
    for (const [name, r] of [["Cancel call", cancel], ["Accept", accept]] as const) {
      expect(r.body.error?.code, `${name}: ${JSON.stringify(r.body)}`).toBe("stop_once");
      expect(texts(r.body.error), name).toContain(DEV_SIDE);
      expect(r.body.error!.liveRule, name).toEqual({ off: true });
    }
    const rule = liveRuleOf(cancel.body.error as Record<string, unknown>);
    await settle();
    expect((await more(w, w.written.id, "1.00")).status).toBe(200);
    await settle();
    const lines = await live(w, loaded);
    expect(boxKeeps(line(lines, "Nora Lane paid you $1.00 more for your written answers"), rule)).toBe(false);
    expect(boxKeeps(line(lines, DEV_SIDE), rule)).toBe(true);
  });

  it("Switch / Keep's \"changed the terms again\" box carries the rule too", async () => {
    const w = await world(true);
    const edit = async (fields: Record<string, unknown>) => {
      const v = (await db.test.findUniqueOrThrow({ where: { id: w.testId } })).version;
      expect((await act(w.testId, "edit", w.dev.cookie, { version: v, fields, confirmed: true })).status).toBe(200);
    };
    await edit({ writtenCents: "12.00" });
    const old = await db.termsOffer.findFirstOrThrow({ where: { contractId: w.sessionId } });
    await edit({ writtenCents: "14.00" });
    const r = (await sact(w.sessionId, "terms", w.tester.cookie, { offerId: old.id, choice: "switch" })) as Res;
    expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
    expect(texts(r.body.error)[0]).toMatch(/changed the terms again/);
    expect(r.body.error!.alertsOff).toBe(true);
    expect(r.body.error!.liveRule).toEqual({ off: true });
  });
});

describe("§374 the top box (Alerts Off) never greys a line that always stops", () => {
  it("the end of her work and a dispute change are forced and not greyed; payments stay greyed (they stop only a press about their part)", async () => {
    const w = await world(true);
    await disputeRecording(w);
    await settle();
    const loaded = seen();
    await settle();
    expect((await more(w, w.written.id, "1.00")).status).toBe(200);
    await devSide(w);
    await settle();
    await stopTest(w);
    await settle();
    const lines = await live(w, loaded);
    for (const text of [DEV_SIDE, "Nora Lane stopped the test"]) {
      const l = line(lines, text);
      expect(l.forced, text).toBe(true);
      expect(l.ignored, text).toBeUndefined();
    }
    const paid = line(lines, "Nora Lane paid you $1.00 more for your written answers");
    expect(paid.forced).toBeUndefined();
    expect(paid.ignored).toBe(true);
  });

  it("Alerts On: nothing is greyed", async () => {
    const w = await world(false);
    await settle();
    const loaded = seen();
    await settle();
    expect((await more(w, w.written.id, "1.00")).status).toBe(200);
    await settle();
    await stopTest(w);
    await settle();
    expect((await live(w, loaded)).filter((l) => l.ignored)).toEqual([]);
  });
});
