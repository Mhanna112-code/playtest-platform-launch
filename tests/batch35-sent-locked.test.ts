import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { SentWork } from "@/components/SentWork";
import { ADDED_LABEL, additionsOf, latestItems, pieceTime } from "@/lib/additions";
import { ANSWER_NEW_QUESTIONS, NOTHING_TO_ADD, NO_RECORDING_TO_ADD, SENT_ANSWERS_LOCKED, SENT_RECORDING_LOCKED, workOverPress } from "@/lib/rules";
import { ALL_RECORDINGS_SENT } from "@/lib/server/recordings";
import { testV } from "@/lib/server/pulseV";
import { act, joined, sact, seen, settle, setup } from "./fixtures";
import { json, req } from "./helpers";

// (Owner, Nov 3, batch 35 §136) Sent work is locked: what was sent can't be removed or replaced, only added to. Each part reads as one list: what was sent
// first, then each addition headed "Added" (no time: the part's header line carries the latest one).
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const send = (sessionId: string, cookie: string, answers: string[], notes = "") => sact(sessionId, "written", cookie, { answers, notes, seenAt: seen(), confirmed: true });
const add = (sessionId: string, cookie: string, text: string) => sact(sessionId, "written-add", cookie, { text, seenAt: seen(), confirmed: true });
async function upload(sessionId: string, cookie: string, part: "recording" | "written", filename = "run.mp4", contentType = "video/mp4") {
  const r = await sact(sessionId, "recording-start", cookie, { filename, size: 1000, contentType, part });
  expect(r.status).toBe(200);
  await sact(sessionId, "recording-done", cookie, { recordingId: r.body.recordingId });
  return { id: r.body.recordingId as string, tag: r.body.tag as string };
}
const pay = (cookie: string, id: string, amount: string) => reviewPOST(req("/api/review", { cookie, body: { kind: "submission", id, payKey: randomUUID(), amount, tickedCents: Math.round(Number(amount) * 100), seenAt: seen(), confirmed: true } })).then(json);
const written = (sessionId: string) => db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: sessionId, kind: "written" } } });
const events = (testId: string) => db.testEvent.findMany({ where: { testId }, orderBy: { createdAt: "asc" } }).then((e) => e.map((x) => x.text));

describe("written answers: locked once sent, only added to", () => {
  it("a second Send of the same questions is refused; Add more adds text under what was sent, which never changes", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, ["first answer", "second answer"], "notes")).status).toBe(200);
    const sent = await written(j.sessionId);
    // An older page's "Send my updated answers": refused, nothing changes.
    const again = await send(j.sessionId, j.tester.cookie, ["edited answer", "second answer"], "notes");
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe(SENT_ANSWERS_LOCKED);
    // Nothing to add: refused.
    expect((await add(j.sessionId, j.tester.cookie, "   ")).body.error.message).toBe(NOTHING_TO_ADD);
    const r = await add(j.sessionId, j.tester.cookie, "One more thing: the map button overlaps the sail toggle.");
    expect(r.status).toBe(200);
    const after = await written(j.sessionId);
    expect(after.answers).toEqual(sent.answers);
    expect(after.notes).toBe("notes");
    const adds = additionsOf(after.additions);
    expect(adds).toHaveLength(1);
    expect(adds[0].text).toBe("One more thing: the map button overlaps the sail toggle.");
    // The header line's time is the latest addition's.
    expect(pieceTime(after).getTime()).toBe(new Date(adds[0].at).getTime());
    expect(after.updatedAt.getTime()).toBeGreaterThan(sent.updatedAt.getTime());
    // The developer is told the same way a send does: a live line and a bell.
    expect((await events(testId)).at(-1)).toBe("Ana Silva added to her written answers");
    const bell = await db.notification.findFirst({ where: { userId: dev.user.id }, orderBy: { createdAt: "desc" } });
    expect(bell?.text).toContain("Ana Silva added to her written answers for “Harbor Run”");
  });

  it("a file sent with the answers can't be removed; a file placed in an addition goes with it", async () => {
    const { testId } = await setup();
    const j = await joined(testId);
    const f = await upload(j.sessionId, j.tester.cookie, "written", "map.png", "image/png");
    await send(j.sessionId, j.tester.cookie, [`see [📎 map.png #${f.tag}]`, ""]);
    // The sent file is kept, whatever an older page asks (it stays with what was sent).
    const rm = await sact(j.sessionId, "recording-remove", j.tester.cookie, { recordingId: f.id, written: true });
    expect(rm.body.retained).toBe(true);
    expect(await db.recording.count({ where: { id: f.id } })).toBe(1);
    const g = await upload(j.sessionId, j.tester.cookie, "written", "crash.txt", "text/plain");
    expect((await add(j.sessionId, j.tester.cookie, `the log: [📎 crash.txt #${g.tag}]`)).status).toBe(200);
    const sub = await written(j.sessionId);
    expect(additionsOf(sub.additions)[0].files).toEqual([g.id]);
    expect((await db.recording.findUniqueOrThrow({ where: { id: g.id } })).submissionId).toBe(sub.id);
  });

  it("adding follows Send's windows: never while the test is paused, never after the work ended", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    await send(j.sessionId, j.tester.cookie, ["a", "b"]);
    await db.test.update({ where: { id: testId }, data: { adminPausedAt: new Date() } });
    expect((await add(j.sessionId, j.tester.cookie, "more")).body.error.code).toBe("paused");
    await db.test.update({ where: { id: testId }, data: { adminPausedAt: null } });
    await settle();
    expect((await act(testId, "stop", dev.cookie, { reason: "We have enough feedback now, thanks all.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const late = await add(j.sessionId, j.tester.cookie, "more");
    expect(late.status).toBe(409);
    expect(workOverPress("written-add")).toBe("Add");
    expect(additionsOf((await written(j.sessionId)).additions)).toHaveLength(0);
  });

  it("after a Pay the payment stays; what's added waits in Needs you with Pay more (worded as an addition)", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    await send(j.sessionId, j.tester.cookie, ["a", "b"]);
    const sub = await written(j.sessionId);
    expect((await pay(dev.cookie, sub.id, "10.00")).status).toBe(200);
    await settle();
    expect((await add(j.sessionId, j.tester.cookie, "and one more bug")).status).toBe(200);
    const after = await db.submission.findUniqueOrThrow({ where: { id: sub.id }, include: { review: true } });
    expect(after.review?.amountCents).toBe(1000);
    expect(after.paidUpdateAt).not.toBeNull();
    expect((await events(testId)).at(-1)).toBe("Ana Silva added to her written answers after you paid");
  });

  it("after a switch to changed questions, the new answers are ADDED under the first ones (no previous-set pair for the developer)", async () => {
    const { testId } = await setup();
    const j = await joined(testId);
    await send(j.sessionId, j.tester.cookie, ["liked", "stuck"]);
    // The developer's offer changed a question and the tester switched.
    await db.contract.update({ where: { id: j.sessionId }, data: { questions: ["What did you like?", "What would you change?"] } });
    await db.submission.update({ where: { contractId_kind: { contractId: j.sessionId, kind: "written" } }, data: { setUntil: new Date() } });
    expect((await add(j.sessionId, j.tester.cookie, "more")).body.error.message).toBe(ANSWER_NEW_QUESTIONS);
    expect((await send(j.sessionId, j.tester.cookie, ["liked", "the map"])).status).toBe(200);
    const sub = await written(j.sessionId);
    expect((sub.answers as { answer: string }[]).map((x) => x.answer)).toEqual(["liked", "stuck"]);
    expect(additionsOf(sub.additions)[0].items?.map((x) => x.answer)).toEqual(["liked", "the map"]);
    expect(latestItems(sub).map((x) => x.question)).toEqual(["What did you like?", "What would you change?"]);
    expect(sub.prevSets).toEqual([]);
    expect(sub.setUntil).toBeNull();
  });
});

describe("recordings: sent ones are locked, more can be added", () => {
  it("Remove on a sent recording is refused; Add sends only the new ones, within the 5", async () => {
    const { dev, testId } = await setup({ recordingCents: "8.00" });
    const j = await joined(testId);
    const r1 = await upload(j.sessionId, j.tester.cookie, "recording");
    expect((await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    const rm = await sact(j.sessionId, "recording-remove", j.tester.cookie, { recordingId: r1.id });
    expect(rm.status).toBe(409);
    expect(rm.body.error.message).toBe(SENT_RECORDING_LOCKED);
    // Nothing new: nothing to add.
    expect((await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true, add: true })).body.error.message).toBe(NO_RECORDING_TO_ADD);
    const r2 = await upload(j.sessionId, j.tester.cookie, "recording");
    const r3 = await upload(j.sessionId, j.tester.cookie, "recording");
    // One not sent yet can still be removed.
    expect((await sact(j.sessionId, "recording-remove", j.tester.cookie, { recordingId: r3.id })).status).toBe(200);
    const sentAgain = await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true, add: true });
    expect(sentAgain.status).toBe(200);
    expect(sentAgain.body.added).toBe(1);
    const sub = await db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: j.sessionId, kind: "recording" } } });
    expect(additionsOf(sub.additions).map((a) => a.files)).toEqual([[r2.id]]);
    expect(await db.recording.count({ where: { contractId: j.sessionId, submissionId: sub.id } })).toBe(2);
    expect((await events(testId)).at(-1)).toBe("Ana Silva added a recording");
    expect((await db.notification.findFirst({ where: { userId: dev.user.id }, orderBy: { createdAt: "desc" } }))?.text).toContain("Ana Silva added a recording for “Harbor Run”");
    // Fill to 5 (all sent): the 6th is refused without "Remove one first".
    for (let i = 0; i < 3; i++) await upload(j.sessionId, j.tester.cookie, "recording");
    await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true, add: true });
    const sixth = await sact(j.sessionId, "recording-start", j.tester.cookie, { filename: "x.mp4", size: 1000, contentType: "video/mp4", part: "recording" });
    expect(sixth.body.error.message).toBe(ALL_RECORDINGS_SENT);
    expect(workOverPress("recording-send", { add: true })).toBe("Add");
  });
});

describe("one list per part, with Added", () => {
  const files = [
    { id: "f1aaaa", filename: "first.mp4", contentType: "video/mp4", sizeBytes: 10, part: "recording" },
    { id: "f2bbbb", filename: "second.mp4", contentType: "video/mp4", sizeBytes: 10, part: "recording" },
  ];
  it("a recording piece: the first recordings, then each addition under a plain \"Added\" (no time, no before / after)", () => {
    const h = renderToStaticMarkup(createElement(SentWork, { kind: "recording", answers: [], notes: "", additions: [{ at: "2026-11-03T21:14:00.000Z", files: ["f2bbbb"] }], files }));
    expect(h.indexOf("first.mp4")).toBeLessThan(h.indexOf(`>${ADDED_LABEL}</p>`));
    expect(h.indexOf(`>${ADDED_LABEL}</p>`)).toBeLessThan(h.indexOf("second.mp4"));
    expect(h).toContain('data-added-label="">Added</p>');
    expect(h).not.toMatch(/Added [A-Z][a-z]{2} \d/); // no time after it
    expect(h).not.toMatch(/Before|Previous|updated version/i);
  });

  it("written answers: the first answers, then the added text and the answers to new questions, each under Added", () => {
    const h = renderToStaticMarkup(createElement(SentWork, {
      kind: "written", answers: [{ question: "Q1", required: false, answer: "first answer" }], notes: "",
      additions: [{ at: "2026-11-03T21:14:00.000Z", text: "added text", files: [] }, { at: "2026-11-03T22:00:00.000Z", items: [{ question: "Q2", required: false, answer: "new answer" }], files: [] }], files: [],
    }));
    const at = (s: string) => h.indexOf(s);
    expect(at("first answer")).toBeLessThan(at("added text"));
    expect(at("added text")).toBeLessThan(at("new answer"));
    expect(h.match(/data-added-label="">Added<\/p>/g)).toHaveLength(2);
  });

  it("every place sent work is read uses the one list; the old previous-set pair and 'updated version' wording are gone", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page.match(/<SentWork /g)).toHaveLength(3); // Needs you, the update row, the tester row
    expect(src("app/admin/DisputeWork.tsx")).toContain("<SentWork ");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain('<SentWork kind="written"');
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("<PrevSetFolds draftsOnly");
    for (const f of ["lib/moneyLines.ts", "lib/server/paidUpdates.ts", "lib/server/tests.ts", "lib/server/recordings.ts", "app/app/page.tsx"]) expect(src(f)).not.toContain("updated version");
    expect(src("app/app/sessions/[id]/RecordingUpload.tsx")).not.toContain("It stays with what you sent until you send again");
  });

  it("an addition shows live: the test page's fingerprint moves, so its panels redraw in place (height, scroll and folds kept)", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    await send(j.sessionId, j.tester.cookie, ["a", "b"]);
    const before = await testV(dev.user.id, testId);
    await settle();
    await add(j.sessionId, j.tester.cookie, "more");
    expect(await testV(dev.user.id, testId)).not.toBe(before);
    // The redraw keeps the panel's own height state and the folds' DOM (no key change, no remount).
    expect(src("components/Panel.tsx")).toContain("const [height, setHeight] = useState<number | null>(null);");
    expect(src("app/app/tests/[id]/page.tsx")).toContain('<Fold id={`needs-part-${x.id}`}');
  });
});
