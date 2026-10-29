import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as excerptsPOST } from "@/app/api/excerpts/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { GET as morePOST } from "@/app/api/admin/more/route";
import { POST as joinPOST } from "@/app/api/calls/[id]/join/route";
import { adminPage, type TestVM } from "@/lib/server/adminLists";
import { closePausedTest } from "@/lib/server/pauseClosure";
import { ANSWER_TERMS_CODE } from "@/lib/answerTerms";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 29 (owner, Oct 29): §20 leftovers from the batch 27 design doc check, and §30 only testers remove excerpts.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const later = () => new Promise((r) => setTimeout(r, 30));
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const ex = (cookie: string, body: Record<string, unknown>) => excerptsPOST(req("/api/excerpts", { cookie, body })).then(json);
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true });
};
async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const rowOf = async (adminId: string, testId: string) => {
  const title = (await db.test.findUniqueOrThrow({ where: { id: testId } })).title;
  return ((await adminPage("tests", adminId, null, "", { q: title, ticks: [] })).rows as TestVM[]).find((r) => r.id === testId)!;
};

describe("batch 29 section 30: only testers remove excerpts", () => {
  async function shownExcerpt() {
    const s = await setup();
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["The harbour level felt great, but the second boss was far too hard for me.", "Nowhere, it was smooth."] });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const id = (await ex(j.tester.cookie, { action: "request", submissionId: sub.id, index: 0, text: "the second boss was far too hard" })).body.id;
    expect((await ex(s.dev.cookie, { action: "decide", excerptId: id, decision: "allow" })).status).toBe(200);
    return { ...s, ...j, id };
  }

  it("the developer's Take down from an older page is refused; it stays on the profile", async () => {
    const s = await shownExcerpt();
    const r = await ex(s.dev.cookie, { action: "remove", excerptId: s.id });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe("Only the tester can remove an excerpt from their profile.");
    expect((await db.excerpt.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("shown");
  });

  it("the tester's Remove goes through and sends no bell line", async () => {
    const s = await shownExcerpt();
    const before = await db.notification.count({ where: { userId: s.dev.user.id } });
    expect((await ex(s.tester.cookie, { action: "remove", excerptId: s.id })).status).toBe(200);
    expect(await db.excerpt.count({ where: { id: s.id } })).toBe(0);
    expect(await db.notification.count({ where: { userId: s.dev.user.id } })).toBe(before);
    expect(await db.notification.count({ where: { text: { contains: "took down the excerpt" } } })).toBe(0);
  });

  it("no Take down anywhere on the developer's pages", () => {
    expect(src("app/app/tests/[id]/page.tsx")).not.toContain('label="Take down"');
    expect(src("app/app/tests/[id]/page.tsx")).not.toContain("<ExcerptRemove");
    expect(src("components/Excerpts.tsx")).toContain("export function ExcerptRemove({ excerptId }: { excerptId: string })");
    expect(src("lib/server/excerpts.ts")).not.toContain("tookDownLine");
  });
});

describe("batch 29 section 20: leftovers", () => {
  it("dashboard Join call refused for new terms: the refusal names the session, and Join call links to the Switch / Keep box", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 60_000) } });
    await later();
    expect((await edit(s.testId, s.dev.cookie, { writtenCents: "12.00" })).body.offered).toBe(1);
    const r = await joinPOST(req(`/api/calls/${call.id}/join`, { cookie: j.tester.cookie, body: {} }), { params: Promise.resolve({ id: call.id }) }).then(json);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: ANSWER_TERMS_CODE, sessionId: j.sessionId });
    const join = src("components/JoinCall.tsx");
    expect(join).toContain("Answer them on the session page →");
    expect(join).toContain("setTermsAt(`/app/sessions/${e.data.sessionId}#terms-offer`)");
    // The dashboard's Upcoming calls uses that Join call.
    expect(src("app/app/page.tsx")).toContain("<JoinCall callId={x.id} />");
  });

  it("Charge after new terms: the stop box ends 'Press again to go ahead under your current terms, or switch first.'", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * 86_400_000) } });
    await settle();
    const loaded = seen();
    await later();
    expect((await edit(s.testId, s.dev.cookie, { recordingCents: "15.00" })).status).toBe(200);
    expect(await db.termsOffer.count({ where: { contractId: j.sessionId } })).toBe(1);
    const r = await sact(j.sessionId, "choose", j.tester.cookie, { submissionId: sub.id, choice: "letgo", seenAt: loaded });
    expect(r.body.error.code).toBe("stop_once");
    expect(r.body.error.tail).toBe("Press again to go ahead under your current terms, or switch first.");
    expect(src("lib/server/terms.ts")).not.toContain("Press again to send under your current terms");
  });

  it("admin Tests row: 'the team' when no admin is named, 'at' before the time, a lift paired with the pause it ended", async () => {
    const a = await admin(), b = await admin(), c = await admin();
    const s = await setup({ title: `Harbor Run ${randomUUID().slice(0, 6)}` });
    // Paused (no admin recorded), then lifted by B: "paused by the team, lifted by B at …".
    await db.test.update({ where: { id: s.testId }, data: { adminPausedAt: new Date(), adminPausedById: null } });
    expect((await rowOf(a.user.id, s.testId)).line).toContain(" · paused by the team · ");
    expect((await aact(b.cookie, "unpause-test", { id: s.testId })).status).toBe(200);
    const lifted = (await rowOf(a.user.id, s.testId)).line;
    expect(lifted).toContain(`paused by the team, lifted by ${b.user.email} at `);
    // A newer pause (by C) that ended without a lift: B's older lift isn't paired with it; "at" before the time.
    await db.adminAction.create({ data: { adminId: c.user.id, action: "pause-test", targetId: s.testId, createdAt: new Date(Date.now() + 1000) } });
    const row = await rowOf(a.user.id, s.testId);
    expect(row.line).toMatch(new RegExp(` · open · paused by ${c.user.email.replace(/[.+]/g, "\\$&")} at .+ · `));
    expect(row.line).not.toContain("lifted by");
    expect(src("lib/server/adminLists.ts")).toContain("`${t.status} · paused by ${who(lastPause.adminId)} at ${fmtDateTime(lastPause.createdAt)}`");
  });

  it("a team-paused test closed after 7 days reads as closed, with no Lift the pause", async () => {
    const a = await admin();
    const s = await setup({ title: `Harbor Run ${randomUUID().slice(0, 6)}` });
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking" })).status).toBe(200);
    await closePausedTest(s.testId, "daily");
    expect((await db.test.findUniqueOrThrow({ where: { id: s.testId } })).adminPausedAt).not.toBeNull(); // kept by pauseClosure.ts
    const row = await rowOf(a.user.id, s.testId);
    expect(row.adminPaused).toBe(false);
    expect(row.stopped).toBe(true);
    expect(row.line).toContain(" · closed · ");
    expect(row.line).not.toContain("paused by");
    expect(row.closedLine).toMatch(/^Closed after 7 days paused: /);
  });

  it("admin live check: rows loaded further down are asked for by id and follow a pause", async () => {
    const a = await admin();
    const s = await setup({ title: `Harbor Run ${randomUUID().slice(0, 6)}` });
    const more = (ids: string[]) => morePOST(req(`/api/admin/more?kind=tests&ids=${encodeURIComponent(ids.join(","))}`, { cookie: a.cookie })).then(json);
    const before = await more([s.testId]);
    expect(before.status).toBe(200);
    expect(before.body.rows).toHaveLength(1);
    expect(before.body.rows[0]).toMatchObject({ id: s.testId, adminPaused: false });
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking" })).status).toBe(200);
    expect((await more([s.testId])).body.rows[0]).toMatchObject({ id: s.testId, adminPaused: true });
    // A tester can't use it.
    const t = await makeUser({ tester: true });
    expect((await morePOST(req(`/api/admin/more?kind=tests&ids=${s.testId}`, { cookie: t.cookie }))).status).toBe(403);
    const list = src("app/admin/PagedList.tsx");
    expect(list).toContain("void refreshBeyond(new Set(r.rows.map((x) => x.id)));");
    expect(list).toContain("`/api/admin/more?kind=tests&ids=${encodeURIComponent(rest.slice(i, i + 100).join(\",\"))}`");
  });

  it("one wording: 'Pick a time in the future.' from the server too", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const tooSoon = new Date(Date.now() + 20_000).toISOString();
    const r = await act(s.testId, "request-time", s.dev.cookie, { contractIds: [j.sessionId], rows: [{ startsAt: tooSoon, repeat: "once", count: 1 }], minutes: "30", seenAt: seen(), confirmed: true });
    expect(r.body.error).toMatchObject({ code: "bad_time", message: "Pick a time in the future." });
    expect(src("lib/server/requests.ts")).not.toContain("Pick times in the future.");
  });

  it("local call lead: the forms get the server's value as a prop", () => {
    expect(src("components/CallRequests.tsx")).toContain("useLocalMin(p.leadMinutes)");
    expect(src("components/CallRequests.tsx")).not.toContain('from "@/lib/callLead"');
    expect(src("app/app/tests/[id]/DevCallPanel.tsx")).toContain("useLocalMin(leadMinutes)");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("leadMinutes={CALL_MIN_AHEAD_MINUTES}");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("leadMinutes={CALL_MIN_AHEAD_MINUTES}");
  });

  it("goNextRound's comment has no garbled characters", () => {
    const t = src("lib/server/tests.ts");
    expect(t).not.toContain("â€");
    expect(t).toContain("a call change, a payment…)");
  });

  it("Go to the next round on a paused test (paused before the page loaded) opens at once", async () => {
    const a = await admin();
    const s = await setup();
    await joined(s.testId);
    const made = await act(s.testId, "next-round", s.dev.cookie, { seenAt: seen(), confirmed: true });
    expect(made.status).toBe(200);
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking" })).status).toBe(200);
    await settle();
    const loaded = seen();
    await later();
    const r = await act(s.testId, "go-next-round", s.dev.cookie, { seenAt: loaded });
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(made.body.id);
  });
});
