import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { carriedAnswers, questionKeys } from "@/lib/additions";
import { itemsFor } from "@/lib/answerSets";
import { ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST } from "@/lib/answerTerms";
import { NDA_BLOCK_CODE, NDA_BLOCK_FIRST } from "@/lib/ndaNotice";
import { SENT_ANSWERS_LOCKED } from "@/lib/rules";
import { pauseTest } from "@/lib/server/restrictions";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { POST as releasePOST } from "@/app/api/test/race-release/route";
import { act, addTo, joined, sact, seen, settle, setup } from "./fixtures";
import { json, makeUser, req } from "./helpers";

// (Owner, Nov 11, §375) Send Answers, Add to this answer and a recording's Send / Add make ONE pass under the test's lock, in the owner's order: 1 the drafts
// (an out-of-date page's typed text) → 2 part over → 3a the final refusals (rejected, $0, already sent) → 3b paused → NDA → new terms → upload still running →
// 4 the questions box → 5 the form's mistakes → 6 the stop-once gate → 7 the save. Nothing is checked before the lock or again after it, so a Save, a pause, a
// Leave, a block or another tab's press is either wholly before the pass or wholly after it. The interleavings are forced with the press's hook just before
// its lock (`pauseAt`, as in send-race-369.test.ts) or the test-only race hold (RACE_HOLDS=1).

const Q = ["What did you like?", "Where did you get stuck?", "What would you change?", "Anything about the controls?"];
const Q3b = "What would you change first?";
const A1 = "The harbour level was clear and the boats handled well on the first try.";
type Res = { status: number; body: { error?: { code?: string; message?: string; changes?: { text: string }[]; questions?: boolean; failed?: string; top?: boolean } } & Record<string, unknown> };
const hooks = () => ((globalThis as { __pressHooks?: Record<string, () => Promise<void>> }).__pressHooks ??= {});
/** Runs `during` once, the first time a press reaches its lock (just before it takes it). */
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

/** A refusal (never a stop-once box). */
function refused(r: Res, code: string, message: string) {
  expect(r.body.error?.code, JSON.stringify(r.body)).toBe(code);
  expect(r.body.error?.message).toBe(message);
}
const PART_ENDED = (press: string) => `Your part in this test has ended, so your ${press} didn't go through.`;
const PAUSED = (press: string) => `This test is paused right now, so your ${press} didn't go through.`;

const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  const r = await act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r;
};
const block = (cookie: string, userId: string) => blocksPOST(req("/api/blocks", { cookie, body: { userId } })).then(json);
const teamPause = async (testId: string) => pauseTest((await makeUser({ name: "Team Admin" })).user.id, testId, "Checking reports");
const withMin = async <T,>(min: string, f: () => Promise<T>) => {
  const was = process.env.ANSWER_MIN_CHARS;
  process.env.ANSWER_MIN_CHARS = min;
  try { return await f(); } finally { process.env.ANSWER_MIN_CHARS = was; }
};

async function world(over: Record<string, unknown> = {}) {
  const s = await setup({ questions: Q, recordingCents: "10.00", ...over });
  const j = await joined(s.testId);
  const loaded = seen(); // both tabs' pages
  await settle();
  return { ...s, ...j, loaded };
}
type W = Awaited<ReturnType<typeof world>>;
/** Tab A's Send: Q1 and Q2 answered. */
const sendA = (w: W, answers = [A1, A1, "", ""]) => sact(w.sessionId, "written", w.tester.cookie, { answers, for: Q, notes: "", seenAt: w.loaded, tab: "A" }) as Promise<Res>;
const B_TYPED = ["B's own take on what was good about it all.", "B's view on where things got stuck for a while.", "B would change the tutorial first of all things.", "B found the controls a little slow to respond."];
const sendB = (w: W, extra: Record<string, unknown> = {}) => sact(w.sessionId, "written", w.tester.cookie, { answers: B_TYPED, for: Q, notes: "", seenAt: w.loaded, tab: "B", ...extra }) as Promise<Res>;
const written = (w: W) => db.submission.findUnique({ where: { contractId_kind: { contractId: w.sessionId, kind: "written" } } });
const addDraft = async (w: W, i: number) => (await db.keptForm.findUnique({ where: { userId_key: { userId: w.tester.user.id, key: `add:${w.sessionId}:${questionKeys(itemsFor(Q))[i]}` } } }))?.data;
const formDraft = async (w: W) => JSON.stringify((await db.keptForm.findUnique({ where: { userId_key: { userId: w.tester.user.id, key: `written:${w.sessionId}` } } }))?.data ?? null);
const termsHistory = async (w: W) => JSON.stringify((await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } })).prevSets);
const texts = (r: Res) => (r.body.error?.changes ?? []).map((c) => c.text);
const leave = (w: W) => sact(w.sessionId, "leave", w.tester.cookie, { seenAt: seen(), confirmed: true });
/** A recording uploaded (not sent yet). */
async function upload(w: W, name = "run.mp4") {
  const up = await sact(w.sessionId, "recording-start", w.tester.cookie, { filename: name, size: 1000, contentType: "video/mp4" });
  expect((await sact(w.sessionId, "recording-done", w.tester.cookie, { recordingId: up.body.recordingId })).status).toBe(200);
}

describe("§375 Send Answers: what lands just before the pass refuses it; nothing saved", () => {
  it("new terms: \"Answer the new terms first: Switch or Keep.\"", async () => {
    const w = await world();
    pauseAt("written", async () => expect((await edit(w.testId, w.dev.cookie, { writtenCents: "12.00" })).body.offered).toBe(1));
    refused(await sendB(w), ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST);
    expect(await written(w)).toBeNull();
  });

  it("an NDA change: the NDA refusal", async () => {
    const w = await world();
    pauseAt("written", () => edit(w.testId, w.dev.cookie, { ndaText: "Keep everything about Harbor Run secret." }));
    refused(await sendB(w), NDA_BLOCK_CODE, NDA_BLOCK_FIRST);
    expect(await written(w)).toBeNull();
  });

  it("the team's pause: the paused refusal", async () => {
    const w = await world();
    pauseAt("written", () => teamPause(w.testId));
    refused(await sendB(w), "paused", PAUSED("Send Answers"));
    expect(await written(w)).toBeNull();
  });

  it("the developer's payment hold: the paused refusal too", async () => {
    // A hold is written under the developer's own row lock, not the test's: one committed before the pass takes the test's lock is read there (this case); one
    // committed while the pass holds the lock counts as coming just after it (the answers are saved, then the test is paused).
    const w = await world();
    pauseAt("written", () => db.user.update({ where: { id: w.dev.user.id }, data: { holdStartedAt: new Date() } }));
    refused(await sendB(w), "paused", PAUSED("Send Answers"));
    expect(await written(w)).toBeNull();
  });
});

describe("§375 each clash: the earlier step wins", () => {
  it("part over + another tab's Send + new terms: part over (never a box); the out-of-date page's text is still kept as Add drafts (step 1)", async () => {
    const w = await world();
    pauseAt("written", async () => {
      expect((await sendA(w)).status).toBe(200);
      await edit(w.testId, w.dev.cookie, { writtenCents: "12.00" });
      expect((await leave(w)).status).toBe(200);
    });
    refused(await sendB(w), "gone", PART_ENDED("Send Answers"));
    expect(carriedAnswers((await written(w))!, Q)).toEqual([A1, A1, null, null]);
    expect(await addDraft(w, 0)).toEqual({ text: B_TYPED[0] });
  });

  it("blocked + another tab's Send: part over, never a box", async () => {
    const w = await world();
    pauseAt("written", async () => {
      expect((await sendA(w)).status).toBe(200);
      expect((await block(w.dev.cookie, w.tester.user.id)).status).toBe(200);
    });
    refused(await sendB(w), "gone", PART_ENDED("Send Answers"));
    expect(carriedAnswers((await written(w))!, Q)).toEqual([A1, A1, null, null]);
  });

  it("already sent + an NDA change: \"already sent\"", async () => {
    const w = await world();
    expect((await sendA(w, [A1, A1, A1, A1])).status).toBe(200);
    await edit(w.testId, w.dev.cookie, { ndaText: "Keep everything about Harbor Run secret." });
    await settle();
    refused(await sendB(w), "locked", SENT_ANSWERS_LOCKED);
  });

  it("already sent + a red mistake (over 20,000 characters in all): \"already sent\" (never fix a mistake only to be refused)", async () => {
    const w = await world();
    expect((await sendA(w, [A1, A1, A1, A1])).status).toBe(200);
    await settle();
    refused(await sendB(w, { notes: "n".repeat(20_001) }), "locked", SENT_ANSWERS_LOCKED);
  });

  it("paused + a red mistake: paused", async () => {
    const w = await world();
    await teamPause(w.testId);
    refused(await withMin("50", () => sendB(w, { answers: ["Too short.", "", "", ""] })), "paused", PAUSED("Send Answers"));
  });

  it("an upload still running + a red mistake: wait for the upload", async () => {
    const w = await world();
    refused(await withMin("50", () => sendB(w, { answers: ["Too short [Uploading map.png]", "", "", ""] })), "uploading", "Wait for the upload to finish before sending.");
  });

  it("the questions changed + a red mistake: the questions box", async () => {
    const w = await world();
    await edit(w.testId, w.dev.cookie, { questions: [Q[0], Q[1], Q3b, Q[3]] });
    await settle();
    const r = await withMin("50", () => sendB(w, { answers: ["Too short.", "", "", ""] }));
    expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
    expect(r.body.error?.questions).toBe(true);
    expect(await written(w)).toBeNull();
  });

  // (Owner, Nov 11, §380 D2; replaces §375's "the red mistake before the gate's box") Send Answers is pressable with the form incomplete: the box comes first (the
  // page keeps its own red notes with it); the red mistake is the safety net after it, and nothing is sent.
  it("a red mistake + another tab's Send: the gate's box first, then the red mistake; nothing sent", async () => {
    const w = await world();
    expect((await sendA(w)).status).toBe(200);
    await settle();
    const r = await withMin("50", () => sendB(w, { answers: ["", "", "Too short.", ""] }));
    expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
    await settle();
    const again = await withMin("50", () => sendB(w, { answers: ["", "", "Too short.", ""], confirmed: true, boxAt: new Date().toISOString() }));
    expect(again.body.error?.code, JSON.stringify(again.body)).toBe("bad_answers");
    expect(carriedAnswers((await written(w))!, Q)).toEqual([A1, A1, null, null]);
  });

  for (const race of [true, false]) {
    it(`one Save changes the NDA AND the questions ${race ? "just before B's pass (with A's Send)" : "before B presses"}: the NDA refusal, nothing sent, every typed text kept`, async () => {
      const w = await world();
      const save = async () => {
        expect((await sendA(w)).status).toBe(200);
        await edit(w.testId, w.dev.cookie, { ndaText: "Keep everything about Harbor Run secret.", questions: [Q[0], Q[1], Q3b, Q[3]] });
      };
      if (race) pauseAt("written", save);
      else {
        await save();
        await settle();
      }
      refused(await sendB(w), NDA_BLOCK_CODE, NDA_BLOCK_FIRST);
      expect(carriedAnswers((await written(w))!, Q)).toEqual([A1, A1, null, null]);
      // Answered by A: B's text in their Add drafts (not in the form's draft). Removed (Q3): its Terms history "Draft (not sent)". Still asked (Q4): the form's draft.
      expect(await addDraft(w, 0)).toEqual({ text: B_TYPED[0] });
      expect(await addDraft(w, 1)).toEqual({ text: B_TYPED[1] });
      expect(await formDraft(w)).not.toContain(B_TYPED[0]);
      expect(await termsHistory(w)).toContain(B_TYPED[2]);
      expect(await formDraft(w)).toContain(B_TYPED[3]);
    });
  }
});

describe("§375 typed text (step 1)", () => {
  it("an out-of-date page, every question answered by another tab: \"already sent\" AND the different typed text saved as Add drafts", async () => {
    const w = await world();
    expect((await sendA(w, [A1, A1, A1, A1])).status).toBe(200);
    await settle();
    refused(await sendB(w), "locked", SENT_ANSWERS_LOCKED);
    for (const i of [0, 1, 2, 3]) expect(await addDraft(w, i)).toEqual({ text: B_TYPED[i] });
    expect(carriedAnswers((await written(w))!, Q)).toEqual([A1, A1, A1, A1]);
  });

  it("the same text as was sent: \"already sent\", and no Add draft", async () => {
    const w = await world();
    expect((await sendA(w, [A1, A1, A1, A1])).status).toBe(200);
    await settle();
    refused(await sendB(w, { answers: [A1, A1, A1, A1] }), "locked", SENT_ANSWERS_LOCKED);
    for (const i of [0, 1, 2, 3]) expect(await addDraft(w, i)).toBeUndefined();
  });

  it("(Owner, Nov 11, §376; reverses §375's appending) an Add draft already kept: the most recent typed text REPLACES it; pressed again, it stays that text", async () => {
    const w = await world();
    expect((await sendA(w, [A1, A1, A1, A1])).status).toBe(200);
    const key = `add:${w.sessionId}:${questionKeys(itemsFor(Q))[0]}`;
    await db.keptForm.create({ data: { userId: w.tester.user.id, key, data: { text: "Already typed in the Add box." } } });
    refused(await sendB(w), "locked", SENT_ANSWERS_LOCKED);
    expect(await addDraft(w, 0)).toEqual({ text: B_TYPED[0] });
    expect(await addDraft(w, 1)).toEqual({ text: B_TYPED[1] });
    refused(await sendB(w), "locked", SENT_ANSWERS_LOCKED);
    expect(await addDraft(w, 0)).toEqual({ text: B_TYPED[0] });
    // A later out-of-date press with other text: only the most recent stays (no stacking).
    const later = [`${B_TYPED[0]} And one more thought.`, B_TYPED[1], B_TYPED[2], B_TYPED[3]];
    refused(await sendB(w, { answers: later }), "locked", SENT_ANSWERS_LOCKED);
    expect(await addDraft(w, 0)).toEqual({ text: later[0] });
  });

  it("(Owner, Nov 11, §375) the same text as was sent never touches an Add draft", async () => {
    const w = await world();
    expect((await sendA(w, [A1, A1, A1, A1])).status).toBe(200);
    const key = `add:${w.sessionId}:${questionKeys(itemsFor(Q))[0]}`;
    await db.keptForm.create({ data: { userId: w.tester.user.id, key, data: { text: "Already typed in the Add box." } } });
    refused(await sendB(w, { answers: [A1, A1, A1, A1] }), "locked", SENT_ANSWERS_LOCKED);
    expect(await addDraft(w, 0)).toEqual({ text: "Already typed in the Add box." });
  });
});

describe("§375 the race of recording 1, and a block, in one pass (RACE_HOLDS=1)", () => {
  const release = (body: Record<string, unknown>) => releasePOST(req("/api/test/race-release", { body }));
  const waiting = async (name: string) => { for (let i = 0; i < 200 && !(await (await release({ name, peek: true })).json()).waiting; i++) await settle(); };
  afterEach(() => { delete process.env.RACE_HOLDS; });

  it("B waits; A sends Q1 and Q2; the developer changes Q3; B goes: ONE box, nothing saved; Q1/Q2 text only in the Add drafts, Q4's in the form's draft", async () => {
    process.env.RACE_HOLDS = "1";
    const w = await world();
    const pending = sendB(w, { raceHold: "B" });
    await waiting("B");
    expect((await sendA(w)).status).toBe(200);
    await edit(w.testId, w.dev.cookie, { questions: [Q[0], Q[1], Q3b, Q[3]] });
    await settle();
    expect((await (await release({ name: "B" })).json()).released).toBe(true);
    const b = await pending;
    expect(b.body.error?.code, JSON.stringify(b.body)).toBe("stop_once");
    expect(b.body.error?.changes?.length).toBeGreaterThan(0);
    expect(carriedAnswers((await written(w))!, Q)).toEqual([A1, A1, null, null]);
    expect(await db.submission.count({ where: { contractId: w.sessionId } })).toBe(1);
    expect(await addDraft(w, 0)).toEqual({ text: B_TYPED[0] });
    expect(await addDraft(w, 1)).toEqual({ text: B_TYPED[1] });
    expect(await formDraft(w)).not.toContain(B_TYPED[0]);
    expect(await formDraft(w)).not.toContain(B_TYPED[1]);
    expect(await formDraft(w)).toContain(B_TYPED[3]);
    expect(await termsHistory(w)).toContain(B_TYPED[2]);
  });

  it("(Owner, Nov 11, §375) Send waits; the developer blocks the tester; Send goes: the part-ended refusal, nothing saved, no drafts", async () => {
    process.env.RACE_HOLDS = "1";
    const w = await world();
    const pending = sendB(w, { raceHold: "B" });
    await waiting("B");
    expect((await block(w.dev.cookie, w.tester.user.id)).status).toBe(200);
    expect((await (await release({ name: "B" })).json()).released).toBe(true);
    refused(await pending, "gone", PART_ENDED("Send Answers"));
    expect(await written(w)).toBeNull();
    for (const i of [0, 1, 2, 3]) expect(await addDraft(w, i)).toBeUndefined();
  });

  it("(Owner, Nov 11, §375) the other order: Send saves first, then the block ends the session (the answers stay)", async () => {
    const w = await world();
    expect((await sendB(w)).status).toBe(200);
    expect((await block(w.dev.cookie, w.tester.user.id)).status).toBe(200);
    expect(carriedAnswers((await written(w))!, Q)).toEqual(B_TYPED);
    expect(await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } })).toMatchObject({ status: "ended", endKind: "blocked" });
  });
});

describe("§375 Add to this answer: the same pass", () => {
  const sent = async () => {
    const w = await world();
    expect((await sendA(w)).status).toBe(200);
    await settle();
    const loaded = seen();
    await settle();
    return { ...w, loaded };
  };
  const add = (w: W, tab: string, text: string) => addTo(w.sessionId, w.tester.cookie, { text, seenAt: w.loaded, tab }) as Promise<Res>;
  const additions = async (w: W) => ((await written(w))!.additions as unknown[] | null)?.length ?? 0;

  it("new terms just before the pass: the terms refusal; nothing added", async () => {
    const w = await sent();
    pauseAt("written-add", () => edit(w.testId, w.dev.cookie, { writtenCents: "12.00" }));
    refused(await add(w, "B", "B adds a different note about the first level."), ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST);
    expect(await additions(w)).toBe(0);
  });

  it("the team's pause just before the pass: the paused refusal", async () => {
    const w = await sent();
    pauseAt("written-add", () => teamPause(w.testId));
    refused(await add(w, "B", "B adds a different note about the first level."), "paused", PAUSED("Add"));
    expect(await additions(w)).toBe(0);
  });

  it("paused + a too-short text: paused", async () => {
    const w = await sent();
    await teamPause(w.testId);
    refused(await withMin("50", () => add(w, "B", "Short.")), "paused", PAUSED("Add"));
  });

  it("another tab's Add, then the tester leaves: part over, NOT a box", async () => {
    const w = await sent();
    pauseAt("written-add", async () => {
      expect((await add(w, "A", "A adds a little more about the first level here.")).status).toBe(200);
      expect((await leave(w)).status).toBe(200);
    });
    refused(await add(w, "B", "B adds a different note about the first level."), "gone", PART_ENDED("Add"));
    expect(await additions(w)).toBe(1);
  });
});

describe("§375 a recording's Send / Add: the same pass", () => {
  const send = (w: W, tab: string, extra: Record<string, unknown> = {}) => sact(w.sessionId, "recording-send", w.tester.cookie, { seenAt: w.loaded, tab, ...extra }) as Promise<Res>;
  const recs = (w: W) => db.submission.count({ where: { contractId: w.sessionId, kind: "recording" } });

  it("new terms just before the pass: the terms refusal; nothing sent", async () => {
    const w = await world();
    await upload(w);
    pauseAt("recording-send", () => edit(w.testId, w.dev.cookie, { recordingCents: "12.00" }));
    refused(await send(w, "B"), ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST);
    expect(await recs(w)).toBe(0);
  });

  it("an NDA change just before the pass: the NDA refusal", async () => {
    const w = await world();
    await upload(w);
    pauseAt("recording-send", () => edit(w.testId, w.dev.cookie, { ndaText: "Keep everything about Harbor Run secret." }));
    refused(await send(w, "B"), NDA_BLOCK_CODE, NDA_BLOCK_FIRST);
    expect(await recs(w)).toBe(0);
  });

  it("another tab's Send, then the tester leaves: part over, NOT a box", async () => {
    const w = await world();
    await upload(w);
    pauseAt("recording-send", async () => {
      expect((await send(w, "A")).status).toBe(200);
      await upload(w, "second.mp4");
      expect((await leave(w)).status).toBe(200);
    });
    refused(await send(w, "B"), "gone", PART_ENDED("Send"));
    expect(await recs(w)).toBe(1);
  });

  it("an Add: another tab's Add, then the tester is blocked: part over, naming Add", async () => {
    const w = await world();
    await upload(w);
    expect((await send(w, "A", { confirmed: true, seenAt: seen() })).status).toBe(200);
    await upload(w, "second.mp4");
    await settle();
    const v = { ...w, loaded: seen() };
    await settle();
    pauseAt("recording-send", async () => {
      expect((await send(v, "A", { add: true })).status).toBe(200);
      expect((await block(w.dev.cookie, w.tester.user.id)).status).toBe(200);
    });
    refused(await send(v, "B", { add: true }), "gone", PART_ENDED("Add"));
  });
});

describe("§375 Dispute: new terms or an NDA change just before its lock refuse it (it stays allowed while paused)", () => {
  async function paid() {
    const w = await world();
    expect((await sendA(w)).status).toBe(200);
    const sub = (await written(w))!;
    const { pay } = await import("./b15");
    expect((await pay(w.dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful" })).status).toBe(200);
    await settle();
    const loaded = seen();
    await settle();
    return { ...w, sub, loaded };
  }
  const dispute = (w: Awaited<ReturnType<typeof paid>>) => sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.sub.id, reason: "I answered every question fully and in detail.", seenAt: w.loaded, loadedAt: w.loaded, tab: "B" }) as Promise<Res>;

  it("new terms: the terms refusal; no dispute", async () => {
    const w = await paid();
    pauseAt("dispute", () => edit(w.testId, w.dev.cookie, { writtenCents: "12.00" }));
    refused(await dispute(w), ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST);
    expect(await db.dispute.count({ where: { submissionId: w.sub.id } })).toBe(0);
  });

  it("an NDA change: the NDA refusal; no dispute", async () => {
    const w = await paid();
    pauseAt("dispute", () => edit(w.testId, w.dev.cookie, { ndaText: "Keep everything about Harbor Run secret." }));
    refused(await dispute(w), NDA_BLOCK_CODE, NDA_BLOCK_FIRST);
    expect(await db.dispute.count({ where: { submissionId: w.sub.id } })).toBe(0);
  });

  it("a team pause refuses nothing: the dispute is made", async () => {
    const w = await paid();
    pauseAt("dispute", () => teamPause(w.testId));
    const r = await dispute(w);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await db.dispute.count({ where: { submissionId: w.sub.id } })).toBe(1);
  });
});

describe("(Owner, Nov 11, §375) starting an upload counts and creates under the test's lock", () => {
  // (The test database runs these starts one after another, so this checks the outcome, not the interleaving itself: without the lock it passes here too.)
  it("tabs start recordings at the same moment with 4 already: one is made, the others refused", async () => {
    const w = await world();
    for (let i = 0; i < 4; i++) await upload(w, `r${i}.mp4`);
    const start = (name: string) => sact(w.sessionId, "recording-start", w.tester.cookie, { filename: name, size: 1000, contentType: "video/mp4" }) as Promise<Res>;
    const all = await Promise.all(["a", "b", "c", "d", "e", "f"].map((n) => start(`${n}.mp4`)));
    expect(all.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of all.filter((x) => x.status !== 200)) expect(r.body.error?.message).toBe("You can add at most 5 recordings. Remove one first.");
    expect(await db.recording.count({ where: { contractId: w.sessionId, part: "recording" } })).toBe(5);
  });
});

describe("(Owner, Nov 11, §375) Add on a question no longer asked: the questions box every time, like Send's stale questions", () => {
  it("removed after the page loaded: the box (forced, `questions`), the text kept as its Add draft, nothing saved; a confirmed press with the box shown: the box again", async () => {
    const w = await world();
    expect((await sendA(w)).status).toBe(200);
    await settle();
    const loaded = seen();
    await settle();
    await edit(w.testId, w.dev.cookie, { questions: [Q[1], Q[2], Q[3]] });
    const body = { text: "B adds a different note about the first level.", question: questionKeys(itemsFor(Q))[0], seenAt: loaded };
    const r = await sact(w.sessionId, "written-add", w.tester.cookie, body) as Res;
    expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
    expect(r.body.error?.questions).toBe(true);
    expect(texts(r)).toContain(`Nora Lane removed the question “${Q[0]}”`);
    expect(await addDraft(w, 0)).toEqual({ text: body.text });
    const again = await sact(w.sessionId, "written-add", w.tester.cookie, { ...body, confirmed: true, boxAt: seen(), shownIds: (r.body.error as { changes: { sid?: string }[] }).changes.map((c) => c.sid) }) as Res;
    expect(again.body.error?.code).toBe("stop_once");
    expect(again.body.error?.questions).toBe(true);
    expect(((await written(w))!.additions as unknown[] | null)?.length ?? 0).toBe(0);
  });

  it("removed before the page loaded: the same box, with the line for that question (Send's fallback)", async () => {
    const w = await world();
    expect((await sendA(w)).status).toBe(200);
    await edit(w.testId, w.dev.cookie, { questions: [Q[1], Q[2], Q[3]] });
    await settle();
    const r = await sact(w.sessionId, "written-add", w.tester.cookie, { text: "More.", question: questionKeys(itemsFor(Q))[0], seenAt: seen() }) as Res;
    expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
    expect(texts(r)).toEqual([`Nora Lane removed the question “${Q[0]}”`]);
  });
});

describe("(Owner, Nov 11, §375) a recording's Send: an upload still running is something to send", () => {
  it("another tab sent everything; this tab has one upload running: wait for it, not \"nothing to add\"", async () => {
    const w = await world();
    await upload(w);
    expect((await sact(w.sessionId, "recording-send", w.tester.cookie, { seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    // B's upload started, not finished (its page says it's still going).
    expect((await sact(w.sessionId, "recording-start", w.tester.cookie, { filename: "b.mp4", size: 1000, contentType: "video/mp4" })).status).toBe(200);
    const r = await sact(w.sessionId, "recording-send", w.tester.cookie, { add: true, seenAt: seen(), tab: "B" }) as Res;
    refused(r, "uploading", "Wait for the upload to finish before sending."); // (§379 item 3) one wording
  });
});

describe("(Owner, Nov 11, §375) starting an upload: one pass under the lock", () => {
  it("part over: the tester left → \"Your part in this test has ended, so your upload didn't go through.\"; no row", async () => {
    const w = await world();
    expect((await leave(w)).status).toBe(200);
    refused(await sact(w.sessionId, "recording-start", w.tester.cookie, { filename: "a.mp4", size: 1000, contentType: "video/mp4" }) as Res, "gone", PART_ENDED("upload"));
    expect(await db.recording.count({ where: { contractId: w.sessionId } })).toBe(0);
  });
});
