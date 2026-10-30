import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as excerptsPOST } from "@/app/api/excerpts/route";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { LIMITS } from "@/lib/limits";
import { carryOver, itemsOf, prevSetsOf } from "@/lib/answerSets";
import { plainText } from "@/lib/markdown";
import * as X from "@/lib/server/excerpts";
import { deleteAccount } from "@/lib/server/restrictions";
import { setKept } from "@/lib/server/kept";
import { decideTerms } from "@/lib/server/terms";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 13 (owner, Oct 29): excerpt requests, Rate while suspended, the NDA card, the Recording part's 5 recordings sent together, whole sets of questions and answers,
// and long text handled the same way everywhere.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const ex = (cookie: string, body: Record<string, unknown>) => excerptsPOST(req("/api/excerpts", { cookie, body })).then(json);
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true });
};
const ANSWER = "The harbour level felt great, but the second boss was far too hard for me.";

/** A test with written answers sent and paid (`amount`), by Ana. */
async function paidWork(amount = "10.00", over: Record<string, unknown> = {}) {
  const s = await setup(over);
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: [ANSWER, "Nowhere **really**, it was smooth."] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  const cents = Math.round(Number(amount) * 100);
  expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount, tickedCents: cents, ...(cents < 1000 ? { reason: "Partly useful" } : {}) })).status).toBe(200);
  return { ...s, ...j, sub };
}
const ask = (cookie: string, submissionId: string, over: Record<string, unknown> = {}) => ex(cookie, { action: "request", submissionId, index: 0, text: "the second boss was far too hard", ...over });

describe("batch 13 sections 1-3: excerpt requests", () => {
  it("only paid written answers (above $0), trimmed from the answer, 10 to 500 characters, (batch 18 section 7) always naming the test", async () => {
    const s = await paidWork();
    expect((await ask(s.tester.cookie, s.sub.id, { text: "too short" })).body.error.message).toBe(X.excerptLength);
    expect((await ask(s.tester.cookie, s.sub.id, { text: "the second boss was easy and I loved it" })).body.error.message).toContain("Trim the excerpt from your answer");
    const r = await ask(s.tester.cookie, s.sub.id);
    expect(r.status).toBe(200);
    const row = await db.excerpt.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(row).toMatchObject({ status: "pending", hideProduct: false, question: "What did you like?", text: "the second boss was far too hard" });
    expect(await db.notification.count({ where: { userId: s.dev.user.id, text: "Ana Silva asked to show an excerpt from “Harbor Run” on their profile" } })).toBe(1);
    // One pending request per part.
    expect((await ask(s.tester.cookie, s.sub.id)).body.error.message).toBe(X.ONE_PENDING);
    // Paid $0: nothing to show.
    const zero = await paidWork("0");
    expect((await ask(zero.tester.cookie, zero.sub.id)).body.error.message).toBe("Only written answers the developer paid for can be shown as excerpts.");
    expect(plainText("**Bold** and *it*\n```\ncode\n```")).toBe("Bold and it\ncode");
  });

  it("at most 3 shown or pending; a 4th is refused", async () => {
    const tester = await makeUser({ tester: true, name: "Ben Ward" });
    for (let i = 0; i < 4; i++) {
      const s = await setup({ title: `Run ${i}` });
      const test = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
      const j = await act(s.testId, "join", tester.cookie, { listingVersion: test.listingVersion });
      await sact(j.body.sessionId, "written", tester.cookie, { answers: [ANSWER, "Fine"] });
      await settle();
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.body.sessionId } });
      await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
      const r = await ask(tester.cookie, sub.id);
      if (i < 3) expect(r.status).toBe(200);
      else expect(r.body.error.message).toBe("You can show at most 3 excerpts. Remove one first.");
    }
  });

  it("Allow and Deny tell the tester by bell only; decided twice is refused; only the tester removes a shown one", async () => {
    const s = await paidWork();
    const id = (await ask(s.tester.cookie, s.sub.id, { hideProduct: false })).body.id;
    expect((await X.pendingForDeveloper(s.dev.user.id, s.testId)).map((x) => x.id)).toEqual([id]);
    expect((await ex(s.dev.cookie, { action: "decide", excerptId: id, decision: "allow" })).status).toBe(200);
    expect(await db.notification.count({ where: { userId: s.tester.user.id, text: "Your excerpt from Harbor Run is now on your profile." } })).toBe(1);
    expect((await ex(s.dev.cookie, { action: "decide", excerptId: id, decision: "deny" })).body.error.message).toBe("You already allowed this excerpt."); // (batch 16 section 21) the same item already decided: says how
    expect(await X.pendingForDeveloper(s.dev.user.id, s.testId)).toEqual([]);
    expect(await X.shownExcerpts(s.tester.user.id)).toEqual([{ id, text: "the second boss was far too hard", question: "What did you like?", source: "Harbor Run" }]);
    // (Batch 29 section 30) Only the tester removes it: the developer's Take down (from an older page) is refused; the tester's Remove sends no line.
    expect((await ex(s.dev.cookie, { action: "remove", excerptId: id })).body.error.message).toBe("Only the tester can remove an excerpt from their profile.");
    expect((await ex(s.tester.cookie, { action: "remove", excerptId: id })).status).toBe(200);
    expect((await ex(s.tester.cookie, { action: "remove", excerptId: id })).body.error.message).toBe("This excerpt was already taken down.");
    // Deny, then a new request allowed and taken down by the tester: the developer is told.
    const id2 = (await ask(s.tester.cookie, s.sub.id)).body.id;
    await ex(s.dev.cookie, { action: "decide", excerptId: id2, decision: "deny" });
    expect(await db.notification.count({ where: { userId: s.tester.user.id, text: "Nora Lane prefers that work from Harbor Run isn't shown on profiles." } })).toBe(1);
    expect((await X.myExcerpts(s.tester.user.id))[0]).toMatchObject({ id: id2, state: "Not allowed by the developer", source: "Harbor Run" }); // (batch 18 section 7) always "From <test>"
    const id3 = (await ask(s.tester.cookie, s.sub.id)).body.id;
    await ex(s.dev.cookie, { action: "decide", excerptId: id3, decision: "allow" });
    await ex(s.tester.cookie, { action: "remove", excerptId: id3 });
    expect(await db.notification.count({ where: { userId: s.dev.user.id, text: { contains: "took down" } } })).toBe(0);
    // Where it shows.
    expect(src("app/app/tests/[id]/page.tsx")).toContain("<b className=\"text-white\">Excerpt request</b>");
    expect(src("app/app/tests/[id]/page.tsx")).not.toContain('label="Take down"');
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("<ExcerptPicker submissionId={written.id} choices={excerptPicks} />");
    expect(src("components/Excerpts.tsx")).toContain("Show an excerpt on your profile");
    expect(src("app/app/testers/[id]/page.tsx")).toContain("<MyExcerpts items={await myExcerpts(p.id)} />");
    // (Batch 16 section 30) Not on Settings any more; a suspended tester side removes them from the dashboard.
    expect(src("app/app/account/page.tsx")).not.toContain("<MyExcerpts");
    expect(src("app/app/page.tsx")).toContain("{suspended && await myExcerpts(userId).then((items) => (items.length ? <MyExcerpts items={items} /> : null))}");
    // (Batch 16 section 23) Not on the hover card any more.
    expect(src("app/app/tests/[id]/TestersJoined.tsx")).not.toContain("data-hover-excerpt");
    expect(src("app/app/tests/[id]/page.tsx")).not.toContain("excerpts: (await shownExcerpts(c.testerId))");
  });

  it("no stop-once, blocks change nothing, a restricted developer decides from the dashboard box, a suspended tester can only Remove", async () => {
    const s = await paidWork();
    const id = (await ask(s.tester.cookie, s.sub.id)).body.id;
    // A block either way: the request stays and can be decided.
    expect((await blocksPOST(req("/api/blocks", { cookie: s.tester.cookie, body: { userId: s.dev.user.id } })).then(json)).status).toBe(200);
    expect(await X.pendingForDeveloper(s.dev.user.id)).toHaveLength(1);
    await db.user.update({ where: { id: s.dev.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    expect(src("app/app/page.tsx")).toContain("const excerptBox = devOff ? await pendingForDeveloper(u.id) : [];");
    expect((await ex(s.dev.cookie, { action: "decide", excerptId: id, decision: "allow" })).status).toBe(200);
    // A suspended tester: no new request, Remove still works.
    await db.user.update({ where: { id: s.tester.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    expect((await ask(s.tester.cookie, s.sub.id)).status).toBe(403);
    expect((await ex(s.tester.cookie, { action: "remove", excerptId: id })).status).toBe(200);
  });

  it("stopping keeps requests; deleting: a tester's go, a developer's pending ones close (shown ones stay)", async () => {
    const s = await paidWork();
    const id = (await ask(s.tester.cookie, s.sub.id)).body.id;
    await act(s.testId, "stop", s.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true });
    expect((await db.excerpt.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
    const t2 = await paidWork();
    const shown = (await ask(t2.tester.cookie, t2.sub.id)).body.id;
    await ex(t2.dev.cookie, { action: "decide", excerptId: shown, decision: "allow" });
    // The developer of the first test deletes: its pending request closes.
    await deleteAccount(s.dev.user.id, "self");
    expect(await db.excerpt.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "closed", closedReason: "Harbor Run's developer deleted their account, so this request was closed" });
    // The developer of the second deletes: the shown excerpt stays.
    await deleteAccount(t2.dev.user.id, "self");
    expect((await db.excerpt.findUniqueOrThrow({ where: { id: shown } })).status).toBe("shown");
    // The tester deletes: their excerpts go.
    await deleteAccount(t2.tester.user.id, "self");
    expect(await db.excerpt.count({ where: { testerId: t2.tester.user.id } })).toBe(0);
  });
});

describe("batch 13 section 4: Rate and suspensions", () => {
  it("a suspended tester's Rate is refused (to the dashboard top) and hidden; back once the suspension lifts", async () => {
    const s = await paidWork();
    await act(s.testId, "stop", s.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true });
    await db.user.update({ where: { id: s.tester.user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    const r = await sact(s.sessionId, "rate", s.tester.cookie, { stars: 4 });
    // (Batch 17 section 2) Refused with its own line; hidden while suspended (the limited view too).
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "inactive", message: "You can rate once your account is active again." });
    expect(src("app/app/sessions/[id]/page.tsx")).toContain('{(rateState.kind === "open" || rateState.kind === "disabled") && !meOff && (');
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("const canAct = !meOff || limited;");
    await db.user.update({ where: { id: s.tester.user.id }, data: { devSuspendedAt: null, testerSuspendedAt: null } });
    expect((await sact(s.sessionId, "rate", s.tester.cookie, { stars: 4 })).status).toBe(200);
  });
});

describe("batch 13 sections 5 and 6: the NDA card, and an NDA added later", () => {
  it("the card's heading, bullets and box text", () => {
    const f = src("app/app/tests/TestForm.tsx");
    expect(f).toContain("<ShieldCheck");
    expect(f).toContain("Keep it confidential? (NDA, optional)");
    expect(f).toContain("An NDA stops testers sharing your build or what they saw. They must accept it before joining.");
    expect(f).toContain("you can always use the feedback you receive</strong> to improve your product.");
    expect(f).toContain("Testers can never show work from a test under an NDA as excerpts on their profile; without one, they can only with your permission.");
    expect(f).toContain('placeholder="Leave blank for no NDA. If filled, testers must accept it before joining."');
    expect(f).toContain('{left("ndaText")}');
  });

  it("while the test has an NDA: requests refused, shown ones hidden; all back when it's removed (batch 18 section 7: a pending one can still be Allowed, straight into hidden)", async () => {
    const s = await paidWork();
    const shownId = (await ask(s.tester.cookie, s.sub.id)).body.id;
    await ex(s.dev.cookie, { action: "decide", excerptId: shownId, decision: "allow" });
    const t2 = await paidWork();
    const pendingId = (await ask(t2.tester.cookie, t2.sub.id)).body.id;
    expect((await edit(s.testId, s.dev.cookie, { ndaText: "Keep it secret." })).status).toBe(200);
    expect((await edit(t2.testId, t2.dev.cookie, { ndaText: "Keep it secret." })).status).toBe(200);
    expect((await ask(t2.tester.cookie, t2.sub.id)).body.error.message).toBe("This test now has an NDA, so its work can't be shown as an excerpt.");
    // (Batch 18 section 7) The pending request stays for the developer, with the NDA note; the tester's list says it's hidden.
    expect((await X.pendingForDeveloper(t2.dev.user.id)).map((x) => [x.id, x.ndaNote])).toEqual([[pendingId, "Harbor Run has an NDA now: if you allow this, it stays hidden while Harbor Run has an NDA."]]);
    expect((await X.myExcerpts(t2.tester.user.id))[0].state).toBe("Hidden while Harbor Run has an NDA");
    expect(await X.shownExcerpts(s.tester.user.id)).toEqual([]);
    expect((await X.myExcerpts(s.tester.user.id))[0].state).toBe("Allowed · hidden while Harbor Run has an NDA");
    // Removed again: back.
    expect((await edit(s.testId, s.dev.cookie, { ndaText: "" })).status).toBe(200);
    expect((await X.shownExcerpts(s.tester.user.id)).map((x) => x.id)).toEqual([shownId]);
    // (Batch 18 section 7) Allowed under the NDA: accepted straight into hidden, and shown once the NDA is removed.
    expect((await ex(t2.dev.cookie, { action: "decide", excerptId: pendingId, decision: "allow" })).body).toEqual({ status: "shown", hidden: true });
    expect(await db.notification.count({ where: { userId: t2.tester.user.id, text: "Your excerpt from Harbor Run was allowed. It stays hidden while Harbor Run has an NDA." } })).toBe(1);
    expect((await X.myExcerpts(t2.tester.user.id))[0].state).toBe("Allowed · hidden while Harbor Run has an NDA");
    expect(await X.shownExcerpts(t2.tester.user.id)).toEqual([]);
    expect((await edit(t2.testId, t2.dev.cookie, { ndaText: "" })).status).toBe(200);
    expect((await X.shownExcerpts(t2.tester.user.id)).map((x) => x.id)).toEqual([pendingId]);
  });
});

describe("batch 13 section 7: the Recording part, up to 5 recordings sent together", () => {
  const start = (sessionId: string, cookie: string, over: Record<string, unknown> = {}) => sact(sessionId, "recording-start", cookie, { filename: "run.mp4", size: 1000, contentType: "video/mp4", ...over });
  async function uploaded(sessionId: string, cookie: string, over: Record<string, unknown> = {}) {
    const r = await start(sessionId, cookie, over);
    expect(r.status).toBe(200);
    await sact(sessionId, "recording-done", cookie, { recordingId: r.body.recordingId });
    return r.body.recordingId as string;
  }

  it("5 at most (a 6th is refused), Remove frees a slot, written-part videos count separately, one piece for all, and no Send while one uploads", async () => {
    const s = await setup({ recordingCents: "12.00" });
    const j = await joined(s.testId);
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await uploaded(j.sessionId, j.tester.cookie));
    expect((await start(j.sessionId, j.tester.cookie)).body.error.message).toBe("You can add at most 5 recordings. Remove one first.");
    // A video on the written part doesn't count toward these 5.
    expect((await start(j.sessionId, j.tester.cookie, { part: "written" })).status).toBe(200);
    // Remove one: its slot is free.
    expect((await sact(j.sessionId, "recording-remove", j.tester.cookie, { recordingId: ids[0] })).status).toBe(200);
    const pending = (await start(j.sessionId, j.tester.cookie)).body.recordingId as string;
    // Still uploading: Send waits.
    expect((await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true })).body.error.message).toBe("A recording is still uploading. Send once it's done.");
    await sact(j.sessionId, "recording-done", j.tester.cookie, { recordingId: pending });
    expect((await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    const subs = await db.submission.findMany({ where: { contractId: j.sessionId, kind: "recording" }, include: { recordings: true } });
    expect(subs).toHaveLength(1);
    expect(subs[0].recordings).toHaveLength(5);
    // A sent one removed stays with the sent piece until the next Send.
    await sact(j.sessionId, "recording-remove", j.tester.cookie, { recordingId: ids[1] });
    expect(await db.recording.count({ where: { submissionId: subs[0].id } })).toBe(5);
    await settle();
    expect((await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await db.recording.count({ where: { submissionId: subs[0].id } })).toBe(4);
    // Paid: (batch 30 §2) an updated version can still be sent, so a recording can still be removed (it leaves at the next Send).
    await settle();
    await pay(s.dev.cookie, { kind: "submission", id: subs[0].id, amount: "12.00", tickedCents: 1200 });
    expect((await sact(j.sessionId, "recording-remove", j.tester.cookie, { recordingId: ids[2] })).status).toBe(200);
    expect(src("app/app/sessions/[id]/RecordingUpload.tsx")).toContain('title="Remove this recording?"');
    expect(src("app/app/sessions/[id]/RecordingUpload.tsx")).toContain("onLoadedMetadata");
  });
});

describe("batch 13 section 8: whole sets of questions and answers", () => {
  it("the owner's example: a Q1 draft, only Q2 changed; after the switch Q1 is filled, Q2 is new and empty, Q3 unchanged; the previous set has Q1 to Q3", async () => {
    const s = await setup({ questions: ["Q1?", "Q2?", "Q3?"] });
    const j = await joined(s.testId);
    await setKept(j.tester.user.id, `written:${j.sessionId}`, { answers: ["My Q1 draft", "", ""], notes: "" });
    expect((await edit(s.testId, s.dev.cookie, { questions: ["Q1?", "Q2 changed?", "Q3?"] })).status).toBe(200);
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: j.sessionId, status: "open" } });
    await decideTerms({ id: j.tester.user.id }, j.sessionId, { offerId: offer.id, choice: "switch", seenAt: seen(), confirmed: true });
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    const prev = prevSetsOf(c.prevSets);
    expect(prev).toHaveLength(1);
    // (Batch 26 section 14) Unmarked questions are not required.
    expect(prev[0].items).toEqual([{ question: "Q1?", required: false, answer: "My Q1 draft" }, { question: "Q2?", required: false, answer: "" }, { question: "Q3?", required: false, answer: "" }]);
    const kept = await db.keptForm.findUniqueOrThrow({ where: { userId_key: { userId: j.tester.user.id, key: `written:${j.sessionId}` } } });
    expect((kept.data as { answers: string[] }).answers).toEqual(["My Q1 draft", "", ""]);
    expect(carryOver(prev[0].items, ["Q1?", "Q2 changed?", "Q3?"])).toEqual(["My Q1 draft", "", ""]);
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("<PrevSetFolds sets={prevSets} sentPart={!!written} attachments=");
    expect(src("components/AnswerSets.tsx")).toContain("Previous questions and answers (until {fmtDate(new Date(s.until))})");
  });

  it("sent, then switched: the developer sees it under its own questions, labelled, at its price; sending the new set replaces it and keeps the earlier one in a fold", async () => {
    const s = await setup({ questions: ["Q1?", "Q2?"] });
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["one", "two"] });
    await settle();
    expect((await edit(s.testId, s.dev.cookie, { questions: ["Q1?", "Q2 new?"], writtenCents: "12.00" })).status).toBe(200);
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: j.sessionId, status: "open" } });
    await decideTerms({ id: j.tester.user.id }, j.sessionId, { offerId: offer.id, choice: "switch", seenAt: seen(), confirmed: true });
    let sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "written" } });
    expect(sub.setUntil).not.toBeNull();
    expect(sub.agreedCents).toBe(1000);
    expect(itemsOf(sub.answers).map((x) => x.question)).toEqual(["Q1?", "Q2?"]);
    expect(src("app/app/tests/[id]/page.tsx")).toContain("Sent for the questions until {fmtDate(x.s!.setUntil)}");
    await settle();
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["one", "new two"], seenAt: seen(), confirmed: true })).status).toBe(200);
    sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "written" } });
    expect(sub.setUntil).toBeNull();
    expect(sub.agreedCents).toBe(1200);
    expect(itemsOf(sub.answers)).toEqual([{ question: "Q1?", required: false, answer: "one" }, { question: "Q2 new?", required: false, answer: "new two" }]);
    expect(prevSetsOf(sub.prevSets)[0].items.map((x) => x.answer)).toEqual(["one", "two"]);
    // Older rows (a list of answers) still read, paired by position.
    // (Batch 26 section 14) The old marker still reads as not required; unmarked is not required; "[required] " is.
    expect(itemsOf(["a", "b", "c"], ["[not required] X?", "Y?", "[required] Z?"])).toEqual([{ question: "X?", required: false, answer: "a" }, { question: "Y?", required: false, answer: "b" }, { question: "Z?", required: true, answer: "c" }]);
  });
});

describe("batch 13 section 9: long text", () => {
  it("NDA 1,000 (an older, longer one stays until changed), questions (batch 15 section 3) 20,000 each, live counters, scroll boxes", async () => {
    expect(LIMITS.nda).toBe(1000);
    expect(LIMITS.question).toBe(20_000);
    const s = await setup({ ndaText: "x".repeat(1000) });
    expect((await edit(s.testId, s.dev.cookie, { ndaText: "y".repeat(1001) })).body.error.message).toBe("Keep the NDA to 1,000 characters.");
    await db.test.update({ where: { id: s.testId }, data: { ndaText: "z".repeat(5000) } });
    expect((await edit(s.testId, s.dev.cookie, { title: "Harbor Run 2" })).status).toBe(200);
    expect((await edit(s.testId, s.dev.cookie, { questions: ["Q".repeat(20_001)] })).body.error.message).toBe("Keep each question to 20,000 characters.");
    expect((await edit(s.testId, s.dev.cookie, { questions: ["Q".repeat(20_000)] })).status).toBe(200);
    const f = src("app/app/tests/TestForm.tsx");
    expect(f).toContain("data-nda-count");
    expect(f).toContain("data-steps-count");
    expect(f).toContain("{counterText(q.length, LIMITS.question)}");
    expect(src("components/NdaBox.tsx")).toContain("max-h-[15rem] overflow-y-auto");
    for (const p of ["app/app/find/[id]/JoinBox.tsx", "app/app/sessions/[id]/page.tsx", "app/app/sessions/[id]/TesterTop.tsx"]) expect(src(p)).toContain("<NdaBox");
    expect(f).not.toContain("<NdaBox"); // (batch 16 section 8) no "How testers see it" preview on Post / Edit
    expect(src("app/app/sessions/[id]/TesterTop.tsx")).toContain('<NdaBox label="Before"');
    expect(src("app/app/sessions/[id]/TesterTop.tsx")).toContain("<QuestionList items={offer.fromQuestions} />"); // (batch 15 section 3)
  });
});
