import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as liveGET } from "@/app/api/live/route";
import { boxKeeps, liveRuleOf, type LiveRule } from "@/lib/live";
import { devGate } from "@/lib/server/tests";
import { logEvent } from "@/lib/server/live";
import type { Change } from "@/components/ChangesBox";
import { pay, payMore } from "./b15";
import { addTo, joined, sact, seen, settle, setup } from "./fixtures";
import { json, req } from "./helpers";

/**
 * (Owner, Nov 10, §373; recording race-371 2) A tester with Alerts Off pressed Send Answers: the server's box held only the always-stop lines, then the page
 * ADDED "Nora Lane paid $10.00 for your recording" from the live feed 1.2 s later (a developer payment on another part). An open stop box now takes in a live
 * line only if the server would have put it in that box: the box carries the rule it was built under (`liveRule`), the live line what that rule reads.
 */

const ANS = "The harbour level was clear and the boats handled well on the first try.";
type Err = { code?: string; changes?: Change[]; liveRule?: unknown; alertsOff?: boolean };
type Res = { status: number; body: { error?: Err } & Record<string, unknown> };

async function addRecording(sessionId: string, cookie: string) {
  const r = await sact(sessionId, "recording-start", cookie, { filename: "run.mp4", size: 1000, contentType: "video/mp4" });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect((await sact(sessionId, "recording-done", cookie, { recordingId: r.body.recordingId })).status).toBe(200);
}

/** Ana sent her written answers and a recording, both paid by Nora. */
async function world(alertsOff: boolean) {
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
const more = (w: W, submissionId: string, amount: string) => payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId, amount, tickedCents: Math.round(Number(amount) * 100) });
/** The live feed of a page, as LiveTop polls it. */
const live = async (scope: string, cookie: string, since: string, tab = "t-page") =>
  (await json(await liveGET(req(`/api/live?scope=${scope}&since=${encodeURIComponent(since)}`, { cookie, method: "GET", headers: { "x-tab": tab } })))).body.changes as Change[];
const line = (lines: Change[], text: string) => {
  const l = lines.find((c) => c.text === text);
  expect(l, `${text}\n in: ${JSON.stringify(lines.map((c) => c.text))}`).toBeTruthy();
  return l!;
};

/** Ana's Add to her written answers, stopped once by Nora's Pay more on that very part (forced, §362): the box and the rule it was built under. */
async function addStopped(w: W, loaded: string) {
  expect((await more(w, w.written.id, "2.00")).status).toBe(200);
  await settle();
  const r = (await addTo(w.sessionId, w.tester.cookie, { text: "An addition after payment.", seenAt: loaded, loadedAt: loaded, tab: "t-page" })) as Res;
  expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
  return r.body.error!;
}

describe("§373 tester: a line the page picks up joins an open stop box only by the rule the box was built under", () => {
  it("Alerts Off (recording race-371 2): a payment on another part never joins; one on the press's own part and an always-stop line do", async () => {
    const w = await world(true);
    const loaded = seen();
    await settle();
    const box = await addStopped(w, loaded);
    expect(box.alertsOff).toBe(true);
    expect(box.liveRule).toEqual({ off: true, part: w.written.id });
    const rule = liveRuleOf(box as Record<string, unknown>);
    expect(rule).toEqual({ off: true, part: w.written.id });
    // While the box is open: Nora pays the RECORDING (another part), then more on the written answers (this press's part); Ana sends from another tab.
    await settle();
    expect((await more(w, w.rec.id, "10.00")).status).toBe(200);
    expect((await more(w, w.written.id, "3.00")).status).toBe(200);
    expect((await addTo(w.sessionId, w.tester.cookie, { text: "Sent from my other tab.", seenAt: seen(), confirmed: true, tab: "t-other" })).status).toBe(200);
    await settle();
    const lines = await live(`session:${w.sessionId}`, w.tester.cookie, loaded);
    const other = line(lines, "Nora Lane paid you $10.00 more for your recording");
    const samePart = line(lines, "Nora Lane paid you $3.00 more for your written answers");
    const own = lines.find((c) => c.text.endsWith("in another tab"));
    expect(own, JSON.stringify(lines.map((c) => c.text))).toBeTruthy();
    // What the live feed says about each: the part, and whether it stops whatever the press.
    expect(other).toMatchObject({ part: w.rec.id });
    expect(other.forced).toBeUndefined();
    expect(samePart).toMatchObject({ part: w.written.id });
    expect(own!.forced).toBe(true);
    expect(boxKeeps(other, rule)).toBe(false);
    expect(boxKeeps(samePart, rule)).toBe(true);
    expect(boxKeeps(own!, rule)).toBe(true);
    // The server agrees: the second press (its box's time) stops again for the same-part payment and the other tab's add, never for the recording's payment.
    const again = (await addTo(w.sessionId, w.tester.cookie, { text: "An addition after payment.", seenAt: loaded, loadedAt: loaded, boxAt: (box as { now?: string }).now, confirmed: true, tab: "t-page" })) as Res;
    expect(again.body.error?.code, JSON.stringify(again.body)).toBe("stop_once");
    const texts = (again.body.error?.changes ?? []).map((c) => c.text);
    expect(texts).toContain("Nora Lane paid you $3.00 more for your written answers");
    expect(texts).not.toContain("Nora Lane paid you $10.00 more for your recording");
  });

  it("Alerts On: the box has no rule and every line joins, as before", async () => {
    const w = await world(false);
    const loaded = seen();
    await settle();
    const box = await addStopped(w, loaded);
    expect(box.alertsOff).toBe(false);
    expect(box.liveRule).toBeUndefined();
    const rule = liveRuleOf(box as Record<string, unknown>);
    expect(rule).toBeNull();
    await settle();
    expect((await more(w, w.rec.id, "10.00")).status).toBe(200);
    await settle();
    const other = line(await live(`session:${w.sessionId}`, w.tester.cookie, loaded), "Nora Lane paid you $10.00 more for your recording");
    expect(boxKeeps(other, rule)).toBe(true);
  });

  it("a press about no part (Alerts Off): only the always-stop lines join", () => {
    const rule: LiveRule = { off: true };
    expect(boxKeeps({ text: "Nora Lane paid $10.00 for your recording", at: "2026-11-10T06:13:33.770Z", part: "rec1" }, rule)).toBe(false);
    expect(boxKeeps({ text: "You sent your written answers in another tab", at: "2026-11-10T06:13:21.000Z", forced: true }, rule)).toBe(true);
    // A line the feed sends with no facts (the site was down…) isn't one the server lists: it doesn't join either.
    expect(boxKeeps({ text: "The site was down from 3:00 AM to 3:20 AM", at: "2026-11-10T06:13:21.000Z" }, rule)).toBe(false);
    expect(boxKeeps({ text: "The site was down from 3:00 AM to 3:20 AM", at: "2026-11-10T06:13:21.000Z" }, null)).toBe(true);
  });
});

describe("§373 developer: the same, by the test's Alerts ticks and what the press is about", () => {
  async function devBox(ignored: string[], press: { acts: string[]; keys: string[]; stopCheck?: string }) {
    const s = await setup({});
    const ana = await joined(s.testId);
    await db.test.update({ where: { id: s.testId }, data: { ignoredAlerts: ignored } });
    const loaded = seen();
    await settle();
    // A change with no Alerts type (always stops): the press stops once.
    await logEvent(s.testId, "info", "Mia Chen changed the description");
    await settle();
    const err = await devGate(db as never, s.testId, { seenAt: loaded, loadedAt: loaded }, {}, [], undefined, press).then(() => null, (e) => e as { code: string; data: Record<string, unknown> });
    expect(err?.code).toBe("stop_once");
    return { s, ana, loaded, data: err!.data, rule: liveRuleOf(err!.data) };
  }

  it("Disputes ticked off: a dispute about the press's tester joins (it always stops a press about them); one about another tester doesn't", async () => {
    const ben = { name: "Ben Ito" };
    const first = await devBox(["disputes"], { acts: ["end-early"], keys: [] });
    const { s, ana, loaded } = first;
    const other = await joined(s.testId, ben.name, "he");
    // The same press, now about Ana (End early on her).
    const err = await devGate(db as never, s.testId, { seenAt: loaded, loadedAt: loaded }, {}, [], undefined, { acts: ["end-early"], keys: [`c:${ana.sessionId}`] }).then(() => null, (e) => e as { data: Record<string, unknown> });
    const rule = liveRuleOf(err!.data);
    expect(rule).toMatchObject({ ignored: ["disputes"], press: { acts: ["end-early"], keys: [`c:${ana.sessionId}`] } });
    await logEvent(s.testId, "dispute", "Ana Silva disputed your rejection of the written answers", ana.sessionId);
    await logEvent(s.testId, "dispute", "Ben Ito disputed your rejection of the written answers", other.sessionId);
    await logEvent(s.testId, "joined", "Cleo Park joined");
    await settle();
    const lines = await live(`test:${s.testId}`, s.dev.cookie, loaded);
    const anas = line(lines, "Ana Silva disputed your rejection of the written answers");
    const bens = line(lines, "Ben Ito disputed your rejection of the written answers");
    expect(anas).toMatchObject({ alert: "disputes", facts: { kind: "dispute", contractId: ana.sessionId } });
    expect(boxKeeps(anas, rule)).toBe(true);
    expect(boxKeeps(bens, rule)).toBe(false);
    // A type not ticked off, and a line with no Alerts type, join as before.
    expect(boxKeeps(line(lines, "Cleo Park joined"), rule)).toBe(true);
    expect(boxKeeps(line(lines, "Mia Chen changed the description"), rule)).toBe(true);
    // The box the first press got (about nobody): neither dispute joins.
    expect(boxKeeps(anas, first.rule)).toBe(false);
  });

  it("nothing ticked off: the box has no rule and every line joins, as before", async () => {
    const { s, loaded, data, rule } = await devBox([], { acts: ["end-early"], keys: [] });
    expect(data.liveRule).toBeUndefined();
    expect(rule).toBeNull();
    await logEvent(s.testId, "joined", "Cleo Park joined");
    await settle();
    expect(boxKeeps(line(await live(`test:${s.testId}`, s.dev.cookie, loaded), "Cleo Park joined"), rule)).toBe(true);
  });
});
