import { randomUUID } from "node:crypto";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as excerptsPOST } from "@/app/api/excerpts/route";
import * as X from "@/lib/server/excerpts";
import { testV } from "@/lib/server/pulseV";
import { dashboardV, publicProfileV } from "@/lib/server/pageFreshness";
import { ExcerptReplaces, REPLACES_LINE } from "@/components/ExcerptList";
import { tagMarker } from "@/lib/answerAttachments";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 35 §126 (owner, Nov 2): excerpt requests and decisions redraw the open pages live; the same excerpt can't be asked twice; a new one for a question already
// shown replaces it on Allow.

// The components compile for the classic JSX runtime under vitest: React in scope for them.
(globalThis as { React?: typeof React }).React = React;
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const ex = (cookie: string, body: Record<string, unknown>) => excerptsPOST(req("/api/excerpts", { cookie, body })).then(json);
const ANSWER = "The harbour level felt great, but the second boss was far too hard for me.";
const OTHER = "Nowhere really, the menus were smooth and the music kept me going.";

async function paidWork() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: [ANSWER, OTHER] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  return { ...s, ...j, sub };
}
const ask = (cookie: string, submissionId: string, text: string, index = 0) => ex(cookie, { action: "request", submissionId, index, text });
const decide = (cookie: string, excerptId: string, decision: "allow" | "deny") => ex(cookie, { action: "decide", excerptId, decision });
/**
 * An excerpt from another submission of the same session (Submission is one per session and kind today; the owner's rule matches by session + question, so an
 * older row from any submission of the session counts): a row on a second submission of the session, written straight to the database.
 */
async function elsewhere(s: { sessionId: string; testId: string; tester: { user: { id: string } } }, text: string, status: "pending" | "shown") {
  const other = await db.submission.create({ data: { contractId: s.sessionId, kind: "recording" } });
  return db.excerpt.create({ data: { testerId: s.tester.user.id, testId: s.testId, contractId: s.sessionId, submissionId: other.id, question: "What did you like?", text, hideProduct: false, status, decidedAt: status === "shown" ? new Date() : null } });
}
const user = (id: string) => db.user.findUniqueOrThrow({ where: { id } });

describe("§126.1 live: excerpt changes are in the pages' fingerprints", () => {
  it("a request redraws the test page and dashboard; Allow / Deny / Remove redraw the session page and the tester's own profile", async () => {
    const s = await paidWork();
    const dev = await user(s.dev.user.id), tester = await user(s.tester.user.id);
    const before = { test: await testV(dev.id, s.testId), dash: await dashboardV(dev), session: await testV(tester.id, s.testId, s.sessionId), profile: await publicProfileV(tester, tester.id) };
    const id = (await ask(s.tester.cookie, s.sub.id, "the second boss was far too hard")).body.id as string;
    // No test event (no live line), yet the developer's test page and dashboard fingerprints change.
    expect(await db.testEvent.count({ where: { testId: s.testId, text: { contains: "excerpt" } } })).toBe(0);
    const asked = { test: await testV(dev.id, s.testId), dash: await dashboardV(dev), session: await testV(tester.id, s.testId, s.sessionId), profile: await publicProfileV(tester, tester.id) };
    expect(asked.test).not.toBe(before.test);
    expect(asked.dash).not.toBe(before.dash);
    expect(asked.session).not.toBe(before.session);
    expect((await decide(s.dev.cookie, id, "allow")).status).toBe(200);
    const allowed = { test: await testV(dev.id, s.testId), session: await testV(tester.id, s.testId, s.sessionId), profile: await publicProfileV(tester, tester.id) };
    expect(allowed.test).not.toBe(asked.test);
    expect(allowed.session).not.toBe(asked.session);
    expect(allowed.profile).not.toBe(asked.profile);
    expect((await ex(s.tester.cookie, { action: "remove", excerptId: id })).status).toBe(200);
    expect(await publicProfileV(tester, tester.id)).not.toBe(allowed.profile);
    expect(await testV(dev.id, s.testId)).not.toBe(allowed.test);
    // Deny redraws the tester's session page too (its "waiting for" note goes).
    const id2 = (await ask(s.tester.cookie, s.sub.id, "harbour level felt great")).body.id as string;
    const pending = await testV(tester.id, s.testId, s.sessionId);
    expect((await decide(s.dev.cookie, id2, "deny")).status).toBe(200);
    expect(await testV(tester.id, s.testId, s.sessionId)).not.toBe(pending);
  });
});

describe("§126.2 no duplicates", () => {
  it("the same text (after squash) as a pending or shown excerpt for the same session and question is refused", async () => {
    const s = await paidWork();
    const id = (await ask(s.tester.cookie, s.sub.id, "the second boss was far too hard")).body.id as string;
    expect((await ask(s.tester.cookie, s.sub.id, "  the second   boss was far too hard ")).body.error.message).toBe(X.SAME_PENDING);
    expect((await decide(s.dev.cookie, id, "allow")).status).toBe(200);
    expect((await ask(s.tester.cookie, s.sub.id, "the second boss was\nfar too hard")).body.error.message).toBe(X.SAME_SHOWN);
    expect(await db.excerpt.count({ where: { testerId: s.tester.user.id } })).toBe(1);
    // The same text shown (or pending) from another submission of the same session: still the same excerpt.
    const t = await paidWork();
    await elsewhere(t, "harbour level felt great", "shown");
    expect((await ask(t.tester.cookie, t.sub.id, "harbour  level felt great")).body.error.message).toBe(X.SAME_SHOWN);
    const u = await paidWork();
    await elsewhere(u, "harbour level felt great", "pending");
    expect((await ask(u.tester.cookie, u.sub.id, "harbour level felt great")).body.error.message).toBe(X.SAME_PENDING);
  });

  it("one pending per part, and one pending per session + question", async () => {
    const s = await paidWork();
    expect((await ask(s.tester.cookie, s.sub.id, "the second boss was far too hard")).status).toBe(200);
    expect((await ask(s.tester.cookie, s.sub.id, "Nowhere really, the menus were smooth", 1)).body.error.message).toBe(X.ONE_PENDING);
    // A pending request for the same question from another submission of the session: this part has none pending, but its question does.
    const t = await paidWork();
    await elsewhere(t, "the second boss was far too hard", "pending");
    expect((await ask(t.tester.cookie, t.sub.id, "harbour level felt great")).body.error.message).toBe(X.ONE_PENDING_QUESTION);
  });
});

describe("§126.3 the same question replaces", () => {
  it("the request row names the excerpt shown now; Allow shows the new one and removes the old in one go; Deny keeps the old", async () => {
    const s = await paidWork();
    const old = (await ask(s.tester.cookie, s.sub.id, "the second boss was far too hard")).body.id as string;
    await decide(s.dev.cookie, old, "allow");
    // Deny: the old one stays.
    const denied = (await ask(s.tester.cookie, s.sub.id, "harbour level felt great")).body.id as string;
    const rows = await X.pendingForDeveloper(s.dev.user.id, s.testId);
    expect(rows.find((r) => r.id === denied)?.replaces).toEqual(["the second boss was far too hard"]);
    const html = renderToStaticMarkup(React.createElement(ExcerptReplaces, { texts: rows[0].replaces }));
    expect(html).toContain(REPLACES_LINE);
    expect(html).toContain("the second boss was far too hard");
    await decide(s.dev.cookie, denied, "deny");
    expect((await db.excerpt.findUniqueOrThrow({ where: { id: old } })).status).toBe("shown");
    // Allow: new shown, old gone.
    const neu = (await ask(s.tester.cookie, s.sub.id, "felt great, but the second boss")).body.id as string;
    expect((await X.pendingForDeveloper(s.dev.user.id, s.testId))[0].replaces).toEqual(["the second boss was far too hard"]);
    expect((await decide(s.dev.cookie, neu, "allow")).status).toBe(200);
    expect(await db.excerpt.findUnique({ where: { id: old } })).toBeNull();
    expect((await X.shownExcerpts(s.tester.user.id)).map((x) => x.text)).toEqual(["felt great, but the second boss"]);
    // A request with nothing shown for its question says nothing about replacing.
    const other = (await ask(s.tester.cookie, s.sub.id, "Nowhere really, the menus were smooth", 1)).body.id as string;
    expect((await X.pendingForDeveloper(s.dev.user.id, s.testId)).find((r) => r.id === other)?.replaces).toEqual([]);
    expect(renderToStaticMarkup(React.createElement(ExcerptReplaces, { texts: [] }))).toBe("");
    // The shown one from another submission of the same session is replaced too.
    const t = await paidWork();
    const older = await elsewhere(t, "harbour level felt great", "shown");
    const r = (await ask(t.tester.cookie, t.sub.id, "the second boss was far too hard")).body.id as string;
    expect((await X.pendingForDeveloper(t.dev.user.id, t.testId))[0].replaces).toEqual(["harbour level felt great"]);
    expect((await decide(t.dev.cookie, r, "allow")).status).toBe(200);
    expect(await db.excerpt.findUnique({ where: { id: older.id } })).toBeNull();
  });

  it("MAX_EXCERPTS doesn't block a replacement (the replaced one goes away)", async () => {
    const tester = await makeUser({ tester: true, name: "Ben Ward" });
    const subs: { id: string; dev: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const s = await setup({ title: `Run ${i}` });
      const test = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
      const j = await act(s.testId, "join", tester.cookie, { listingVersion: test.listingVersion });
      await sact(j.body.sessionId, "written", tester.cookie, { answers: [ANSWER, OTHER] });
      await settle();
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.body.sessionId } });
      await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
      const id = (await ask(tester.cookie, sub.id, "the second boss was far too hard")).body.id as string;
      await decide(s.dev.cookie, id, "allow");
      subs.push({ id: sub.id, dev: s.dev.cookie });
    }
    // A new question at 3 shown: refused. The same question with a different text: a replacement, allowed.
    expect((await ask(tester.cookie, subs[0].id, "Nowhere really, the menus were smooth", 1)).body.error.message).toBe(X.TOO_MANY_EXCERPTS);
    const r = await ask(tester.cookie, subs[0].id, "harbour level felt great");
    expect(r.status).toBe(200);
    expect((await decide(subs[0].dev, r.body.id, "allow")).status).toBe(200);
    expect(await db.excerpt.count({ where: { testerId: tester.user.id, status: "shown" } })).toBe(3);
  });
});

describe("§126.4 excerpts leave files out", () => {
  const upload = async (sessionId: string, cookie: string, filename: string, contentType: string) => {
    const started = await sact(sessionId, "recording-start", cookie, { part: "written", filename, contentType, size: 100 });
    expect(started.status).toBe(200);
    expect((await sact(sessionId, "recording-done", cookie, { recordingId: started.body.recordingId })).status).toBe(200);
    return tagMarker(started.body.tag as string, filename);
  };

  it("the trim box and the stored text have no file markers and no [file]; the spaces they leave are tidied", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const img = await upload(j.sessionId, j.tester.cookie, "map*v2*.png", "image/png");
    const pdf = await upload(j.sessionId, j.tester.cookie, "notes.pdf", "application/pdf");
    const answer = `The harbour level felt great ${img} but the second boss ${pdf}. It was far too hard for me.\n${img}\nThe end.`;
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: [answer, OTHER], seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "written" }, include: { review: true, dispute: true } });
    expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const [first] = await X.excerptChoices(await db.submission.findUniqueOrThrow({ where: { id: sub.id }, include: { review: true, dispute: true } }));
    expect(first.text).toBe("The harbour level felt great but the second boss. It was far too hard for me.\nThe end.");
    expect(first.text).not.toContain("📎");
    expect(first.text).not.toContain("[file]");
    expect(X.withoutFiles(`a ${img} b [[attachment:abc|x.png]] c`)).toBe("a b c");
    // A request whose text still holds a marker (an older page) is stored without it.
    const r = await ask(j.tester.cookie, sub.id, `felt great ${img} but the second boss`);
    expect(r.status).toBe(200);
    expect((await db.excerpt.findUniqueOrThrow({ where: { id: r.body.id } })).text).toBe("felt great but the second boss");
    // The old "[file]" placeholder is no longer in the answer it's trimmed from.
    await ex(s.dev.cookie, { action: "decide", excerptId: r.body.id, decision: "deny" });
    expect((await ask(j.tester.cookie, sub.id, "felt great [file] but the second boss")).body.error.message).toContain("Trim the excerpt from your answer");
  });

  it("excerpts stored earlier with [file] stay as they are", async () => {
    const s = await paidWork();
    const old = await db.excerpt.create({ data: { testerId: s.tester.user.id, testId: s.testId, contractId: s.sessionId, submissionId: s.sub.id, question: "What did you like?", text: "felt great [file] but the boss", hideProduct: false, status: "shown", decidedAt: new Date() } });
    expect((await X.shownExcerpts(s.tester.user.id)).map((x) => x.text)).toEqual([old.text]);
  });
});
