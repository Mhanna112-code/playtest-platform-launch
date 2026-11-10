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

// (Owner, Nov 11, §375) "One refusal set, checked in every place": a refusal (pressing again can never help) always comes before any stop-once box, and is
// checked again under the test's lock, so a Save of new terms or the NDA, a pause, a Leave or a block that lands while a press waits for the lock refuses it
// (nothing is saved), and a press that waited while something moved never gets a box whose second press could only be refused. Typed text is never lost.
// The interleavings are forced with the press's hook between its checks and its lock (as in send-race-369.test.ts).

const Q = ["What did you like?", "Where did you get stuck?", "What would you change?", "Anything about the controls?"];
const Q3b = "What would you change first?";
const A1 = "The harbour level was clear and the boats handled well on the first try.";
type Res = { status: number; body: { error?: { code?: string; message?: string; changes?: { text: string }[] } } & Record<string, unknown> };
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
const leave = (w: W) => sact(w.sessionId, "leave", w.tester.cookie, { seenAt: seen(), confirmed: true });
/** A recording uploaded (not sent yet). */
async function upload(w: W, name = "run.mp4") {
  const up = await sact(w.sessionId, "recording-start", w.tester.cookie, { filename: name, size: 1000, contentType: "video/mp4" });
  expect((await sact(w.sessionId, "recording-done", w.tester.cookie, { recordingId: up.body.recordingId })).status).toBe(200);
}

describe("§375 Send Answers: what lands while the press waits for the lock refuses it (gap 1)", () => {
  it("(a) new terms saved while Send waits: \"Answer the new terms first: Switch or Keep.\"; nothing saved", async () => {
    const w = await world();
    pauseAt("written", async () => expect((await edit(w.testId, w.dev.cookie, { writtenCents: "12.00" })).body.offered).toBe(1));
    refused(await sendB(w), ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST);
    expect(await written(w)).toBeNull();
  });

  it("(b) an NDA change while Send waits: the NDA refusal; nothing saved", async () => {
    const w = await world();
    pauseAt("written", () => edit(w.testId, w.dev.cookie, { ndaText: "Keep everything about Harbor Run secret." }));
    refused(await sendB(w), NDA_BLOCK_CODE, NDA_BLOCK_FIRST);
    expect(await written(w)).toBeNull();
  });

  it("(c) the team pauses the test while Send waits: the paused refusal; nothing saved", async () => {
    const w = await world();
    const admin = await makeUser({ name: "Team Admin" });
    pauseAt("written", () => pauseTest(admin.user.id, w.testId, "Checking reports"));
    refused(await sendB(w), "paused", PAUSED("Send Answers"));
    expect(await written(w)).toBeNull();
  });

  it("(c) the developer's payment hold starting while Send waits: the paused refusal too", async () => {
    // A hold is written under the developer's own row lock, not the test's: one that commits before the press takes the test's lock is read there (this case);
    // one that commits while the press holds the lock counts as coming just after it (the answers are saved, then the test is paused).
    const w = await world();
    pauseAt("written", () => db.user.update({ where: { id: w.dev.user.id }, data: { holdStartedAt: new Date() } }));
    refused(await sendB(w), "paused", PAUSED("Send Answers"));
    expect(await written(w)).toBeNull();
  });
});

describe("§375 a press that waited while something moved: every refusal before the box (gap 2)", () => {
  it("(d) another tab's Send, then the tester leaves, while B waits: the part-ended refusal, NOT a box; nothing saved (part over is step 1)", async () => {
    const w = await world();
    pauseAt("written", async () => {
      expect((await sendA(w)).status).toBe(200);
      expect((await leave(w)).status).toBe(200);
    });
    refused(await sendB(w), "closed", PART_ENDED("Send Answers"));
    expect(carriedAnswers((await written(w))!, Q)).toEqual([A1, A1, null, null]);
    expect(await addDraft(w, 0)).toBeUndefined();
  });

  it("another tab's Send of every answer while B waits: \"already sent\" under the lock, and B's typed text kept as Add drafts first", async () => {
    const w = await world();
    pauseAt("written", async () => expect((await sendA(w, [A1, A1, A1, A1])).status).toBe(200));
    refused(await sendB(w), "locked", SENT_ANSWERS_LOCKED);
    for (const i of [0, 1, 2, 3]) expect(await addDraft(w, i)).toEqual({ text: B_TYPED[i] });
  });

  it("(d) another tab's Send, then the developer blocks the tester, while B waits: the part-ended refusal, NOT a box", async () => {
    const w = await world();
    pauseAt("written", async () => {
      expect((await sendA(w)).status).toBe(200);
      expect((await block(w.dev.cookie, w.tester.user.id)).status).toBe(200);
    });
    refused(await sendB(w), "closed", PART_ENDED("Send Answers"));
    expect(carriedAnswers((await written(w))!, Q)).toEqual([A1, A1, null, null]);
  });

  it("another tab's Send, then new terms, while B waits: the terms refusal, NOT a box", async () => {
    const w = await world();
    pauseAt("written", async () => {
      expect((await sendA(w)).status).toBe(200);
      await edit(w.testId, w.dev.cookie, { writtenCents: "12.00" });
    });
    refused(await sendB(w), ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST);
  });
});

describe("§375 typed text is kept first, then the refusal (gap 3)", () => {
  it("(e) an out-of-date page, every question answered by another tab: \"already sent\" AND the different typed text saved as Add drafts", async () => {
    const w = await world();
    expect((await sendA(w, [A1, A1, A1, A1])).status).toBe(200);
    await settle();
    const b = await sendB(w);
    refused(b, "locked", SENT_ANSWERS_LOCKED);
    for (const i of [0, 1, 2, 3]) expect(await addDraft(w, i)).toEqual({ text: B_TYPED[i] });
    expect(carriedAnswers((await written(w))!, Q)).toEqual([A1, A1, A1, A1]);
  });

  it("(e) the same text as was sent: \"already sent\", and no Add draft", async () => {
    const w = await world();
    expect((await sendA(w, [A1, A1, A1, A1])).status).toBe(200);
    await settle();
    refused(await sendB(w, { answers: [A1, A1, A1, A1] }), "locked", SENT_ANSWERS_LOCKED);
    for (const i of [0, 1, 2, 3]) expect(await addDraft(w, i)).toBeUndefined();
  });

  it("(Owner, Nov 11, §375) an Add draft already kept: the different typed text goes under it after a blank line; pressed twice, it is added once", async () => {
    const w = await world();
    expect((await sendA(w, [A1, A1, A1, A1])).status).toBe(200);
    const key = `add:${w.sessionId}:${questionKeys(itemsFor(Q))[0]}`;
    await db.keptForm.create({ data: { userId: w.tester.user.id, key, data: { text: "Already typed in the Add box." } } });
    refused(await sendB(w), "locked", SENT_ANSWERS_LOCKED);
    expect(await addDraft(w, 0)).toEqual({ text: `Already typed in the Add box.\n\n${B_TYPED[0]}` });
    expect(await addDraft(w, 1)).toEqual({ text: B_TYPED[1] });
    // The same press again: nothing doubles.
    refused(await sendB(w), "locked", SENT_ANSWERS_LOCKED);
    expect(await addDraft(w, 0)).toEqual({ text: `Already typed in the Add box.\n\n${B_TYPED[0]}` });
    expect(await addDraft(w, 1)).toEqual({ text: B_TYPED[1] });
  });

  it("(Owner, Nov 11, §375) the same text as was sent is never appended to an Add draft", async () => {
    const w = await world();
    expect((await sendA(w, [A1, A1, A1, A1])).status).toBe(200);
    const key = `add:${w.sessionId}:${questionKeys(itemsFor(Q))[0]}`;
    await db.keptForm.create({ data: { userId: w.tester.user.id, key, data: { text: "Already typed in the Add box." } } });
    refused(await sendB(w, { answers: [A1, A1, A1, A1] }), "locked", SENT_ANSWERS_LOCKED);
    expect(await addDraft(w, 0)).toEqual({ text: "Already typed in the Add box." });
  });
});

describe("(Owner, Nov 11, §375) the order: part over → keep typed text → refusals → the questions box → the form's mistakes → the gate", () => {
  const user = (w: W) => db.user.findUniqueOrThrow({ where: { id: w.tester.user.id } });
  const asRes = (p: Promise<unknown>) => p.then(() => ({ status: 200, body: {} }) as Res, (e: { status?: number; code?: string; message?: string; data?: Record<string, unknown> }) => ({ status: e.status ?? 500, body: { error: { code: e.code, message: e.message, ...e.data } } }) as Res);
  const withMin = async <T,>(min: string, f: () => Promise<T>) => {
    const was = process.env.ANSWER_MIN_CHARS;
    process.env.ANSWER_MIN_CHARS = min;
    try { return await f(); } finally { process.env.ANSWER_MIN_CHARS = was; }
  };

  it("part over comes first and saves nothing: an out-of-date page of a tester who left keeps no Add drafts", async () => {
    const w = await world();
    expect((await sendA(w, [A1, A1, A1, A1])).status).toBe(200);
    expect((await leave(w)).status).toBe(200);
    const { sendWritten } = await import("@/lib/server/tests");
    refused(await asRes(sendWritten(await user(w), w.sessionId, { answers: B_TYPED, for: Q, notes: "", seenAt: w.loaded })), "closed", PART_ENDED("Send Answers"));
    for (const i of [0, 1, 2, 3]) expect(await addDraft(w, i)).toBeUndefined();
  });

  it("a red mistake AND \"already sent\": \"already sent\" (never fix a mistake only to be refused)", async () => {
    const w = await world();
    expect((await sendA(w, [A1, A1, A1, A1])).status).toBe(200);
    await settle();
    refused(await sendB(w, { notes: "n".repeat(20_001) }), "locked", SENT_ANSWERS_LOCKED);
  });

  it("paused AND a red mistake: paused", async () => {
    const w = await world();
    const admin = await makeUser({ name: "Team Admin" });
    await pauseTest(admin.user.id, w.testId, "Checking reports");
    const { sendWritten } = await import("@/lib/server/tests");
    const r = await withMin("50", async () => asRes(sendWritten(await user(w), w.sessionId, { answers: ["Too short.", "", "", ""], for: Q, notes: "", seenAt: w.loaded })));
    refused(r, "paused", PAUSED("Send Answers"));
  });

  it("an upload still running AND a red mistake: wait for the upload", async () => {
    const w = await world();
    const r = await withMin("50", () => sendB(w, { answers: ["Too short [Uploading map.png]", "", "", ""] }));
    refused(r, "uploading", "Wait for the upload to finish before sending.");
  });

  it("the questions changed AND a red mistake: the questions box", async () => {
    const w = await world();
    await edit(w.testId, w.dev.cookie, { questions: [Q[0], Q[1], Q3b, Q[3]] });
    await settle();
    const r = await withMin("50", () => sendB(w, { answers: ["Too short.", "", "", ""] }));
    expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
    expect(r.body.error).toMatchObject({ questions: true });
  });

  it("Add: paused AND a too-short text: paused", async () => {
    const w = await world();
    expect((await sendA(w)).status).toBe(200);
    const admin = await makeUser({ name: "Team Admin" });
    await pauseTest(admin.user.id, w.testId, "Checking reports");
    const { addWritten } = await import("@/lib/server/tests");
    const r = await withMin("50", async () => asRes(addWritten(await user(w), w.sessionId, { question: questionKeys(itemsFor(Q))[0], text: "Short.", seenAt: seen() })));
    refused(r, "paused", PAUSED("Add"));
  });
});

describe("(Owner, Nov 11, §375) one Save changes the NDA AND the questions: the NDA refusal, nothing sent, the typed text kept", () => {
  const ndaAndQuestions = (w: W) => edit(w.testId, w.dev.cookie, { ndaText: "Keep everything about Harbor Run secret.", questions: [Q[0], Q[1], Q3b, Q[3]] });
  async function kept(w: W) {
    // Answered by A meanwhile: B's text in their Add drafts. Removed (Q3): in its Terms history entry's "Draft (not sent)". Still asked, unanswered (Q4): the form's draft.
    expect(await addDraft(w, 0)).toEqual({ text: B_TYPED[0] });
    expect(await addDraft(w, 1)).toEqual({ text: B_TYPED[1] });
    expect(JSON.stringify((await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } })).prevSets)).toContain(B_TYPED[2]);
    expect(JSON.stringify((await db.keptForm.findUnique({ where: { userId_key: { userId: w.tester.user.id, key: `written:${w.sessionId}` } } }))?.data ?? null)).toContain(B_TYPED[3]);
    expect(carriedAnswers((await written(w))!, Q)).toEqual([A1, A1, null, null]);
  }

  it("while B's Send waits for the lock (with A's Send too)", async () => {
    const w = await world();
    pauseAt("written", async () => {
      expect((await sendA(w)).status).toBe(200);
      await ndaAndQuestions(w);
    });
    refused(await sendB(w), NDA_BLOCK_CODE, NDA_BLOCK_FIRST);
    await kept(w);
  });

  it("with no race: B presses after A's Send and the Save", async () => {
    const w = await world();
    expect((await sendA(w)).status).toBe(200);
    await ndaAndQuestions(w);
    await settle();
    refused(await sendB(w), NDA_BLOCK_CODE, NDA_BLOCK_FIRST);
    await kept(w);
  });
});

describe("(Owner, Nov 11, §375) a block ends the session under the test's lock, like every other end", () => {
  const release = (body: Record<string, unknown>) => releasePOST(req("/api/test/race-release", { body }));
  afterEach(() => { delete process.env.RACE_HOLDS; });

  it("Send waits before the lock; the developer blocks the tester; Send takes the lock: the part-ended refusal, nothing saved, no drafts", async () => {
    process.env.RACE_HOLDS = "1";
    const w = await world();
    const pending = sendB(w, { raceHold: "B" });
    for (let i = 0; i < 200 && !(await (await release({ name: "B", peek: true })).json()).waiting; i++) await settle();
    expect((await block(w.dev.cookie, w.tester.user.id)).status).toBe(200);
    expect((await (await release({ name: "B" })).json()).released).toBe(true);
    refused(await pending, "closed", PART_ENDED("Send Answers"));
    expect(await written(w)).toBeNull();
    for (const i of [0, 1, 2, 3]) expect(await addDraft(w, i)).toBeUndefined();
  });

  it("the other order: Send saves first, then the block ends the session (the answers stay)", async () => {
    const w = await world();
    expect((await sendB(w)).status).toBe(200);
    expect((await block(w.dev.cookie, w.tester.user.id)).status).toBe(200);
    expect(carriedAnswers((await written(w))!, Q)).toEqual(B_TYPED);
    expect(await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } })).toMatchObject({ status: "ended", endKind: "blocked" });
  });
});

describe("§375 the race of recording 1 still gives ONE box, and keepStaleTyped no longer duplicates (gap 4)", () => {
  const release = (body: Record<string, unknown>) => releasePOST(req("/api/test/race-release", { body }));
  afterEach(() => { delete process.env.RACE_HOLDS; });

  it("(f) B waits; A sends Q1 and Q2; the developer changes Q3; B released: ONE box, nothing saved; Q1/Q2 text only in the Add drafts, Q4's in the form's draft", async () => {
    process.env.RACE_HOLDS = "1";
    const w = await world();
    const pending = sendB(w, { raceHold: "B" });
    for (let i = 0; i < 200 && !(await (await release({ name: "B", peek: true })).json()).waiting; i++) await settle();
    expect((await sendA(w)).status).toBe(200);
    await edit(w.testId, w.dev.cookie, { questions: [Q[0], Q[1], Q3b, Q[3]] });
    await settle();
    expect((await (await release({ name: "B" })).json()).released).toBe(true);
    const b = await pending;
    expect(b.body.error?.code, JSON.stringify(b.body)).toBe("stop_once");
    expect(b.body.error?.changes?.length).toBeGreaterThan(0);
    expect(carriedAnswers((await written(w))!, Q)).toEqual([A1, A1, null, null]);
    expect(await db.submission.count({ where: { contractId: w.sessionId } })).toBe(1);
    // Q1 and Q2 (answered by A): B's text is their Add drafts, and NOT also in the form's draft.
    expect(await addDraft(w, 0)).toEqual({ text: B_TYPED[0] });
    expect(await addDraft(w, 1)).toEqual({ text: B_TYPED[1] });
    const form = JSON.stringify((await db.keptForm.findUnique({ where: { userId_key: { userId: w.tester.user.id, key: `written:${w.sessionId}` } } }))?.data ?? null);
    expect(form).not.toContain(B_TYPED[0]);
    expect(form).not.toContain(B_TYPED[1]);
    // Q4 (still asked, unanswered) is in the form's draft; Q3 (removed) in its Terms history entry's draft snapshot: nothing typed is lost.
    expect(form).toContain(B_TYPED[3]);
    expect(JSON.stringify((await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } })).prevSets)).toContain(B_TYPED[2]);
  });
});

describe("§375 Add to this answer: the same refusals while it waits", () => {
  const sent = async () => {
    const w = await world();
    expect((await sendA(w)).status).toBe(200);
    await settle();
    return { ...w, loaded: seen() };
  };
  const add = (w: W, tab: string, text: string) => addTo(w.sessionId, w.tester.cookie, { text, seenAt: w.loaded, tab }) as Promise<Res>;
  const additions = async (w: W) => ((await written(w))!.additions as unknown[] | null)?.length ?? 0;

  it("(a) new terms saved while Add waits: the terms refusal; nothing added", async () => {
    const w = await sent();
    await settle();
    pauseAt("written-add", () => edit(w.testId, w.dev.cookie, { writtenCents: "12.00" }));
    refused(await add(w, "B", "B adds a different note about the first level."), ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST);
    expect(await additions(w)).toBe(0);
  });

  it("(c) the team pauses the test while Add waits: the paused refusal", async () => {
    const w = await sent();
    await settle();
    const admin = await makeUser({ name: "Team Admin" });
    pauseAt("written-add", () => pauseTest(admin.user.id, w.testId, "Checking reports"));
    refused(await add(w, "B", "B adds a different note about the first level."), "paused", PAUSED("Add"));
    expect(await additions(w)).toBe(0);
  });

  it("(d) another tab's Add, then the tester leaves, while B waits: the part-ended refusal, NOT a box", async () => {
    const w = await sent();
    await settle();
    pauseAt("written-add", async () => {
      expect((await add(w, "A", "A adds a little more about the first level here.")).status).toBe(200);
      expect((await leave(w)).status).toBe(200);
    });
    refused(await add(w, "B", "B adds a different note about the first level."), "closed", PART_ENDED("Add"));
    expect(await additions(w)).toBe(1);
  });
});

describe("§375 a recording's Send / Add: the same refusals while it waits", () => {
  const send = (w: W, tab: string, extra: Record<string, unknown> = {}) => sact(w.sessionId, "recording-send", w.tester.cookie, { seenAt: w.loaded, tab, ...extra }) as Promise<Res>;
  const recs = (w: W) => db.submission.count({ where: { contractId: w.sessionId, kind: "recording" } });

  it("(a) new terms saved while Send waits: the terms refusal; nothing sent", async () => {
    const w = await world();
    await upload(w);
    pauseAt("recording-send", () => edit(w.testId, w.dev.cookie, { recordingCents: "12.00" }));
    refused(await send(w, "B"), ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST);
    expect(await recs(w)).toBe(0);
  });

  it("(b) an NDA change while Send waits: the NDA refusal", async () => {
    const w = await world();
    await upload(w);
    pauseAt("recording-send", () => edit(w.testId, w.dev.cookie, { ndaText: "Keep everything about Harbor Run secret." }));
    refused(await send(w, "B"), NDA_BLOCK_CODE, NDA_BLOCK_FIRST);
    expect(await recs(w)).toBe(0);
  });

  it("(d) another tab's Send, then the tester leaves, while B waits: the part-ended refusal, NOT a box", async () => {
    const w = await world();
    await upload(w);
    pauseAt("recording-send", async () => {
      expect((await send(w, "A")).status).toBe(200);
      await upload(w, "second.mp4");
      expect((await leave(w)).status).toBe(200);
    });
    refused(await send(w, "B"), "closed", PART_ENDED("Send"));
    expect(await recs(w)).toBe(1);
  });

  it("(d) an Add: another tab's Add, then the tester is blocked, while B waits: the part-ended refusal naming Add", async () => {
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
    refused(await send(v, "B", { add: true }), "closed", PART_ENDED("Add"));
  });
});

describe("§375 Dispute: new terms or an NDA change while it waits refuse it (it stays allowed while paused)", () => {
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

  it("(a) new terms saved while Dispute waits: the terms refusal; no dispute", async () => {
    const w = await paid();
    pauseAt("dispute", () => edit(w.testId, w.dev.cookie, { writtenCents: "12.00" }));
    refused(await dispute(w), ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST);
    expect(await db.dispute.count({ where: { submissionId: w.sub.id } })).toBe(0);
  });

  it("(b) an NDA change while Dispute waits: the NDA refusal; no dispute", async () => {
    const w = await paid();
    pauseAt("dispute", () => edit(w.testId, w.dev.cookie, { ndaText: "Keep everything about Harbor Run secret." }));
    refused(await dispute(w), NDA_BLOCK_CODE, NDA_BLOCK_FIRST);
    expect(await db.dispute.count({ where: { submissionId: w.sub.id } })).toBe(0);
  });

  it("a team pause while Dispute waits refuses nothing: the dispute is made", async () => {
    const w = await paid();
    const admin = await makeUser({ name: "Team Admin" });
    pauseAt("dispute", () => pauseTest(admin.user.id, w.testId, "Checking reports"));
    const r = await dispute(w);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await db.dispute.count({ where: { submissionId: w.sub.id } })).toBe(1);
  });
});
