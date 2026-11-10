import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { carriedAnswers, questionKeys } from "@/lib/additions";
import { itemsFor } from "@/lib/answerSets";
import { sendWritten } from "@/lib/server/tests";
/** (§369) The old "meanwhile" refusal (gone since §375's one pass): never the answer. */
const QUESTIONS_CHANGED_MEANWHILE = "Your questions changed just now: nothing was sent. Check your answers and press Send Answers again.";
import { SENT_ANSWERS_LOCKED } from "@/lib/rules";
import { act, addTo, atHours, joined, sact, seen, settle, setup } from "./fixtures";
import { payMore } from "./b15";
import { POST as releasePOST } from "@/app/api/test/race-release/route";
import { req } from "./helpers";

// (Owner, Nov 10, §369) "The result must never depend on timing." (Owner, Nov 11, §375) A press makes ONE pass under the test's lock (no check before it, none
// again after it), so whatever lands while it waits for the lock is simply before the pass, and the press ends exactly as a later press would: ONE normal
// stop-once box, never "Your questions changed just now" or "Your answers were already sent". The interleavings are forced with the press's hook just before its lock.

const Q = ["What did you like?", "Where did you get stuck?", "What would you change?", "Anything about the controls?"];
const Q3b = "What would you change first?";
const A1 = "The harbour level was clear and the boats handled well on the first try.";
type Res = { status: number; body: { error?: { code?: string; message?: string; questions?: boolean; now?: string; changes?: { text: string; forced?: boolean }[] } } & Record<string, unknown> };
const hooks = () => ((globalThis as { __pressHooks?: Record<string, () => Promise<void>> }).__pressHooks ??= {});
/** Runs `during` once, the first time a press reaches its lock (the pressing tab paused between its checks and its lock). */
function pauseAt(name: string, during: () => Promise<unknown>) {
  let fired = false;
  hooks()[name] = async () => {
    if (fired) return;
    fired = true;
    await during();
    await settle();
  };
}
afterEach(() => { delete (globalThis as { __pressHooks?: unknown }).__pressHooks; });
const texts = (r: Res) => (r.body.error?.changes ?? []).map((c) => c.text);
/** ONE stop-once box, never a refusal caused by timing. */
function oneBox(r: Res) {
  expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
  expect(r.body.error?.message).not.toBe(QUESTIONS_CHANGED_MEANWHILE);
  expect(r.body.error?.message).not.toBe(SENT_ANSWERS_LOCKED);
  expect(r.body.error?.changes?.length).toBeGreaterThan(0);
}
const editQuestions = async (testId: string, cookie: string, questions: string[]) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  const r = await act(testId, "edit", cookie, { version: v, fields: { questions }, seenAt: seen(), confirmed: true });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
};

async function world() {
  const s = await setup({ questions: Q, recordingCents: "10.00" });
  const j = await joined(s.testId);
  const loaded = seen(); // both tabs' pages
  await settle();
  return { ...s, ...j, loaded };
}
type W = Awaited<ReturnType<typeof world>>;
/** Tab A's Send: Q1 and Q2 answered. */
const sendA = (w: W) => sact(w.sessionId, "written", w.tester.cookie, { answers: [A1, A1, "", ""], for: Q, notes: "", seenAt: w.loaded, tab: "A" }) as Promise<Res>;
/** Tab B's Send: all four typed (its page is the first form). */
const B_TYPED = ["B's own take on what was good about it all.", "B's view on where things got stuck for a while.", "B would change the tutorial first of all things.", "B found the controls a little slow to respond."];
const sendB = (w: W, extra: Record<string, unknown> = {}) => sact(w.sessionId, "written", w.tester.cookie, { answers: B_TYPED, for: Q, notes: "", seenAt: w.loaded, tab: "B", ...extra }) as Promise<Res>;
const written = (w: W) => db.submission.findUnique({ where: { contractId_kind: { contractId: w.sessionId, kind: "written" } } });
const OWN_SENT = "You sent your written answers in another tab";

describe("§369 Send Answers in two tabs, and a questions Save, never depend on timing", () => {
  it("(a) A and B press Send together: A saves; B stops ONCE (\"You sent your written answers in another tab\"); B's second press adds Q3 and Q4", async () => {
    const w = await world();
    pauseAt("written", async () => expect((await sendA(w)).status).toBe(200));
    const b = await sendB(w);
    oneBox(b);
    expect(texts(b)).toEqual([OWN_SENT]);
    // A's answers were saved once and untouched; nothing of B's was written.
    const sub = (await written(w))!;
    expect(carriedAnswers(sub, Q)).toEqual([A1, A1, null, null]);
    expect(await db.submission.count({ where: { contractId: w.sessionId } })).toBe(1);
    // What B typed into Q1 and Q2 (answered by A) is kept as their "Add to this answer" drafts.
    const keys = questionKeys(itemsFor(Q));
    for (const i of [0, 1]) expect((await db.keptForm.findUnique({ where: { userId_key: { userId: w.tester.user.id, key: `add:${w.sessionId}:${keys[i]}` } } }))?.data).toEqual({ text: B_TYPED[i] });
    // B's second press: the form below holds Q3 and Q4 (with B's typed answers): they are added as first answers.
    await settle();
    const second = await sact(w.sessionId, "written", w.tester.cookie, { answers: B_TYPED.slice(2), for: Q.slice(2), notes: "", seenAt: w.loaded, tab: "B", confirmed: true, boxAt: b.body.error!.now });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(carriedAnswers((await written(w))!, Q)).toEqual([A1, A1, B_TYPED[2], B_TYPED[3]]);
  });

  it("(b) A sends, the developer changes Q3, then B presses: ONE box with both; the second press sends Q4 and Q3'", async () => {
    const w = await world();
    expect((await sendA(w)).status).toBe(200);
    await editQuestions(w.testId, w.dev.cookie, [Q[0], Q[1], Q3b, Q[3]]);
    await settle();
    const b = await sendB(w);
    oneBox(b);
    expect(b.body.error?.questions).toBe(true);
    expect(texts(b)).toEqual(expect.arrayContaining([OWN_SENT, `Nora Lane added the question “${Q3b}”`, `Nora Lane removed the question “${Q[2]}”`]));
    expect(carriedAnswers((await written(w))!, Q)).toEqual([A1, A1, null, null]);
    await settle();
    const second = await sact(w.sessionId, "written", w.tester.cookie, { answers: ["B on the changed question, typed after the box.", B_TYPED[3]], for: [Q3b, Q[3]], notes: "", seenAt: w.loaded, tab: "B", confirmed: true, boxAt: b.body.error!.now });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(carriedAnswers((await written(w))!, [Q[0], Q[1], Q3b, Q[3]])).toEqual([A1, A1, "B on the changed question, typed after the box.", B_TYPED[3]]);
  });

  it("(c) the developer's Save lands while B waits for its lock: the question-change stop-once, not QUESTIONS_CHANGED_MEANWHILE", async () => {
    const w = await world();
    pauseAt("written", () => editQuestions(w.testId, w.dev.cookie, [Q[0], Q[1], Q3b, Q[3]]));
    const b = await sendB(w);
    oneBox(b);
    expect(b.body.error?.questions).toBe(true);
    expect(texts(b)).toEqual(expect.arrayContaining([`Nora Lane added the question “${Q3b}”`, `Nora Lane removed the question “${Q[2]}”`]));
    expect(await written(w)).toBeNull();
  });

  it("(d) A's Send and the developer's Save both land in B's window: ONE box with both", async () => {
    const w = await world();
    pauseAt("written", async () => {
      expect((await sendA(w)).status).toBe(200);
      await editQuestions(w.testId, w.dev.cookie, [Q[0], Q[1], Q3b, Q[3]]);
    });
    const b = await sendB(w);
    oneBox(b);
    expect(texts(b)).toEqual(expect.arrayContaining([OWN_SENT, `Nora Lane added the question “${Q3b}”`]));
    expect(carriedAnswers((await written(w))!, Q)).toEqual([A1, A1, null, null]);
    expect(await db.submission.count({ where: { contractId: w.sessionId } })).toBe(1);
  });

  it("the own-action line commits with the save: a Send made outside the route still stops the other tab; the route logs it once", async () => {
    const w = await world();
    const user = await db.user.findUniqueOrThrow({ where: { id: w.tester.user.id } });
    // (The window the old after-success log left: the save visible, its line not yet written.) The library call alone writes both.
    await sendWritten(user, w.sessionId, { answers: [A1, A1, "", ""], for: Q, notes: "", seenAt: w.loaded, tab: "A" });
    expect(await db.actionLog.count({ where: { userId: user.id, testId: w.testId, text: "sent your written answers" } })).toBe(1);
    const b = await sendB(w);
    expect(texts(b)).toEqual([OWN_SENT]);
    // Through the route: still one line (never again after the save).
    const v = await world();
    expect((await sendA(v)).status).toBe(200);
    expect(await db.actionLog.count({ where: { userId: v.tester.user.id, testId: v.testId, text: "sent your written answers" } })).toBe(1);
  });
});

describe("§369 the same race for Add to this answer and a recording's Send", () => {
  it("Add to this answer in two tabs: A's addition saves; B stops once naming it; B's second press adds", async () => {
    const w = await world();
    expect((await sendA(w)).status).toBe(200);
    await settle(); // (Windows' clock can lag ~15 ms: the page loads clearly after the last press)
    const loaded = seen();
    await settle();
    const add = (tab: string, text: string, extra: Record<string, unknown> = {}) => addTo(w.sessionId, w.tester.cookie, { text, seenAt: loaded, tab, ...extra }) as Promise<Res>;
    pauseAt("written-add", async () => expect((await add("A", "A adds a little more about the first level here.")).status).toBe(200));
    const b = await add("B", "B adds a different note about the first level.");
    oneBox(b);
    expect(texts(b)).toEqual([`You added to your answer to “${Q[0]}” in another tab`]);
    const sub = (await written(w))!;
    expect((sub.additions as unknown[]).length).toBe(1);
    expect(carriedAnswers(sub, Q).slice(0, 2)).toEqual([A1, A1]);
    await settle();
    expect((await add("B", "B adds a different note about the first level.", { confirmed: true, boxAt: b.body.error!.now })).status).toBe(200);
    expect(((await written(w))!.additions as unknown[]).length).toBe(2);
  });

  it("a recording's Send in two tabs: one piece; B ends as a later press would (nothing new to add)", async () => {
    const w = await world();
    const up = await sact(w.sessionId, "recording-start", w.tester.cookie, { filename: "run.mp4", size: 1000, contentType: "video/mp4" });
    expect((await sact(w.sessionId, "recording-done", w.tester.cookie, { recordingId: up.body.recordingId })).status).toBe(200);
    const send = (tab: string) => sact(w.sessionId, "recording-send", w.tester.cookie, { seenAt: w.loaded, tab }) as Promise<Res>;
    pauseAt("recording-send", async () => expect((await send("A")).status).toBe(200));
    const b = await send("B");
    const later = await send("B");
    expect([b.status, b.body.error?.code, b.body.error?.message]).toEqual([later.status, later.body.error?.code, later.body.error?.message]);
    expect(await db.submission.count({ where: { contractId: w.sessionId, kind: "recording" } })).toBe(1);
    expect(await db.recording.count({ where: { contractId: w.sessionId, submissionId: { not: null } } })).toBe(1);
  });

  it("a recording Add while the developer pays the recording in its window: the §362 stop-once, never an add past it", async () => {
    const w = await world();
    const upload = async () => {
      const up = await sact(w.sessionId, "recording-start", w.tester.cookie, { filename: `r-${randomUUID().slice(0, 4)}.mp4`, size: 1000, contentType: "video/mp4" });
      expect((await sact(w.sessionId, "recording-done", w.tester.cookie, { recordingId: up.body.recordingId })).status).toBe(200);
    };
    await upload();
    expect((await sact(w.sessionId, "recording-send", w.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    const rec = await db.submission.findFirstOrThrow({ where: { contractId: w.sessionId, kind: "recording" } });
    const { pay } = await import("./b15");
    expect((await pay(w.dev.cookie, { kind: "submission", id: rec.id, amount: "5.00", tickedCents: 500, reason: "Half of it" })).status).toBe(200);
    await upload();
    await settle(); // (Windows' clock can lag ~15 ms: the page loads clearly after the last press)
    const loaded = seen();
    await settle();
    pauseAt("recording-send", async () => expect((await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: rec.id, amount: "2.00", tickedCents: 200 })).status).toBe(200));
    const b = await sact(w.sessionId, "recording-send", w.tester.cookie, { add: true, seenAt: loaded, loadedAt: loaded, tab: "B" }) as Res;
    oneBox(b);
    expect(texts(b)).toEqual(["Nora Lane paid you $2.00 more for your recording"]);
    expect(((await db.submission.findUniqueOrThrow({ where: { id: rec.id } })).additions as unknown[]).length).toBe(0);
  });

  it("Dispute while the developer pays more on that part in its window: the §362 stop-once, never a dispute made past it", async () => {
    const w = await world();
    expect((await sendA(w)).status).toBe(200);
    const sub = (await written(w))!;
    const { pay } = await import("./b15");
    expect((await pay(w.dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful" })).status).toBe(200);
    await settle(); // (Windows' clock can lag ~15 ms: the page loads clearly after the last press)
    const loaded = seen();
    await settle();
    pauseAt("dispute", async () => expect((await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: sub.id, amount: "2.00", tickedCents: 200 })).status).toBe(200));
    const b = await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question fully and in detail.", seenAt: loaded, loadedAt: loaded, tab: "B" }) as Res;
    oneBox(b);
    expect(texts(b)).toEqual(["Nora Lane paid you $2.00 more for your written answers"]);
    expect(await db.dispute.count({ where: { submissionId: sub.id } })).toBe(0);
  });

});

describe("§369 a final refusal stays one (§375: in the one pass under the lock)", () => {
  it("a too-short answer is refused in the pass (one pass, no second look): nothing saved", async () => {
    const w = await world();
    let reached = 0;
    hooks().written = async () => { reached++; };
    const was = process.env.ANSWER_MIN_CHARS;
    process.env.ANSWER_MIN_CHARS = "50";
    try {
      const r = await sact(w.sessionId, "written", w.tester.cookie, { answers: ["Too short.", "", "", ""], for: Q, notes: "", seenAt: w.loaded }) as Res;
      expect(r.body.error?.code).toBe("bad_answers");
    } finally {
      process.env.ANSWER_MIN_CHARS = was;
    }
    expect(reached).toBe(1); // (Owner, Nov 11, §375) every press makes its one pass under the lock; the mistake is found there
    expect(await written(w)).toBeNull();
  });
});

describe("§369 the test-only race hold (RACE_HOLDS=1)", () => {
  const release = (body: Record<string, unknown>) => releasePOST(req("/api/test/race-release", { body }));
  afterEach(() => { delete process.env.RACE_HOLDS; });

  it("B waits before its lock; A saves; the developer changes Q3; B released: ONE box with the question lines and A's Send", async () => {
    process.env.RACE_HOLDS = "1";
    const w = await world();
    const pending = sendB(w, { raceHold: "B" });
    // 1. B's first look runs and it waits before the lock.
    for (let i = 0; i < 200 && !(await (await release({ name: "B", peek: true })).json()).waiting; i++) await settle();
    expect((await (await release({ name: "B", peek: true })).json()).waiting).toBe(true);
    // 2. A presses and saves. 3. The developer saves the question change.
    expect((await sendA(w)).status).toBe(200);
    await editQuestions(w.testId, w.dev.cookie, [Q[0], Q[1], Q3b, Q[3]]);
    await settle();
    // 4. Release B.
    expect((await (await release({ name: "B" })).json()).released).toBe(true);
    const b = await pending;
    oneBox(b);
    expect(b.body.error?.questions).toBe(true);
    expect(texts(b)).toEqual(expect.arrayContaining([OWN_SENT, `Nora Lane added the question “${Q3b}”`, `Nora Lane removed the question “${Q[2]}”`]));
    expect(carriedAnswers((await written(w))!, Q)).toEqual([A1, A1, null, null]);
    expect(await db.submission.count({ where: { contractId: w.sessionId } })).toBe(1);
  });

  it("RACE_HOLDS unset: raceHold is ignored completely and the release route doesn't exist", async () => {
    const w = await world();
    const r = await sendB(w, { raceHold: "B" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await release({ name: "B" })).status).toBe(404);
  });
});

describe("§369 the race with the developer's ordinary changes too (RACE_HOLDS=1)", () => {
  const release = (body: Record<string, unknown>) => releasePOST(req("/api/test/race-release", { body }));
  afterEach(() => { delete process.env.RACE_HOLDS; });

  for (const alertsOff of [false, true]) {
    it(`Alerts ${alertsOff ? "Off: only the always-stop lines" : "On: ONE box with all four, oldest first"}; nothing saved; the second press goes ahead`, async () => {
      process.env.RACE_HOLDS = "1";
      const s = await setup({ questions: Q, recordingCents: "10.00" });
      const j = await joined(s.testId);
      // Her recording, sent before the page loaded (the developer pays it during the race).
      const up = await sact(j.sessionId, "recording-start", j.tester.cookie, { filename: "run.mp4", size: 1000, contentType: "video/mp4" });
      expect((await sact(j.sessionId, "recording-done", j.tester.cookie, { recordingId: up.body.recordingId })).status).toBe(200);
      expect((await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
      const rec = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "recording" } });
      await db.user.update({ where: { id: j.tester.user.id }, data: { testerAlertsOff: alertsOff } });
      await settle();
      const w = { ...s, ...j, loaded: seen() };
      await settle();
      const pending = sendB(w, { raceHold: "B" });
      for (let i = 0; i < 200 && !(await (await release({ name: "B", peek: true })).json()).waiting; i++) await settle();
      // While B waits before its lock, in order: A sends; the developer changes Q3; requests a call with her; pays her recording.
      expect((await sendA(w)).status).toBe(200);
      await settle();
      await editQuestions(w.testId, w.dev.cookie, [Q[0], Q[1], Q3b, Q[3]]);
      await settle();
      expect((await act(w.testId, "request-time", w.dev.cookie, { minutes: "30", contractIds: [w.sessionId], rows: [{ startsAt: atHours(72), repeat: "once", count: 1 }], seenAt: seen(), confirmed: true })).status).toBe(200);
      await settle();
      const { pay } = await import("./b15");
      expect((await pay(w.dev.cookie, { kind: "submission", id: rec.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
      await settle();
      const before = await written(w);
      expect((await (await release({ name: "B" })).json()).released).toBe(true);
      const b = await pending;
      oneBox(b);
      expect(b.body.error?.questions).toBe(true);
      const QUESTION_LINES = [`Nora Lane removed the question “${Q[2]}”`, `Nora Lane added the question “${Q3b}”`];
      // Oldest first: A's Send (another tab), the question change (with Alerts on, also its ordinary listing line), the call request, the payment.
      if (alertsOff) expect(texts(b)).toEqual([OWN_SENT, ...QUESTION_LINES]);
      else expect(texts(b)).toEqual([OWN_SENT, ...QUESTION_LINES, "Nora Lane edited the listing", expect.stringMatching(/^Nora Lane requested a call for .+$/), "Nora Lane paid $10.00 for your recording"]);
      // Nothing of B's was saved: A's answers only, untouched.
      expect((await written(w))!.updatedAt).toEqual(before!.updatedAt);
      expect(carriedAnswers((await written(w))!, Q)).toEqual([A1, A1, null, null]);
      // The page took the new questions: the second press (its form: the unanswered ones) goes ahead.
      await settle();
      const second = await sact(w.sessionId, "written", w.tester.cookie, { answers: ["B's answer to the changed question, after the box.", B_TYPED[3]], for: [Q3b, Q[3]], notes: "", seenAt: w.loaded, tab: "B", confirmed: true, boxAt: b.body.error!.now });
      expect(second.status, JSON.stringify(second.body)).toBe(200);
      expect(carriedAnswers((await written(w))!, [Q[0], Q[1], Q3b, Q[3]])).toEqual([A1, A1, "B's answer to the changed question, after the box.", B_TYPED[3]]);
    });
  }
});
