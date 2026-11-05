import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type Stripe from "stripe";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { GET as keptGET, POST as keptPOST } from "@/app/api/kept/route";
import { SentWork } from "@/components/SentWork";
import { WrittenAddForm } from "@/app/app/sessions/[id]/SessionActions";
import { PayBox } from "@/app/app/tests/[id]/PayBox";
import {
  ADDITIONS_FULL, ANYTHING_ELSE_KEY, ANYTHING_ELSE_TITLE, additionsOf, answersByQuestion, isElseKey, questionKey, writtenThreads,
} from "@/lib/additions";
import { byQuestion } from "@/lib/byQuestion";
import { addedWhat } from "@/lib/moneyLines";
import { additionTooLongLine } from "@/lib/rules";
import { CANCELLED_NOTHING_CHARGED, CANCEL_THIS_CHECK, cancelledCheckLine, payMoreWaits } from "@/lib/bankNotice";
import { bankWaitsOf } from "@/lib/server/payments";
import { bankToConfirm, bankWaitingOnTest, confirmItems, waitingConfirmation } from "@/lib/server/confirm";
import { setStripeForTests } from "@/lib/server/stripe";
import { fmtStampIn } from "@/lib/format";
import { pay, payMore } from "./b15";
import { joined, sact, seen, settle, setup } from "./fixtures";
import { json, req } from "./helpers";

// (Owner, Nov 4, §188) A. ONE fixed "Anything else" spot after the last question of every written part: the notes sent with the answers (its original), the old
// additions with no question, and what is added there now, each dated; added to like a question (the 10, the 20,000, the stop-once, the drafts).
// B. The Pay more box greyed for the developer's own check open elsewhere offers Cancel this check next to its line (un-greys at once); a charge made while away
// offers Confirm with your bank instead. Own checks are never in the Confirm with your bank lists.
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const Q1 = "What did you like?", Q2 = "Where did you get stuck?";
const item = (question: string, answer: string) => ({ question, required: false, answer });
const at1 = "2026-11-03T23:29:00.000Z", at2 = "2026-11-04T08:05:00.000Z", at3 = "2026-11-04T09:10:00.000Z";
const written = (sessionId: string) => db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: sessionId, kind: "written" } } });
const addElse = (sessionId: string, cookie: string, text: string, extra: Record<string, unknown> = {}) =>
  sact(sessionId, "written-add", cookie, { text, question: ANYTHING_ELSE_KEY, seenAt: seen(), confirmed: true, ...extra });
const send = (sessionId: string, cookie: string, notes = "") => sact(sessionId, "written", cookie, { answers: ["the boats", "level 2"], notes, seenAt: seen(), confirmed: true });

describe("§188 A: Anything else, the developer's side", () => {
  const additions = [
    { at: at1, text: "old addition with no question", files: [] },
    { at: at2, text: "about Q2", files: [], questionKey: questionKey(Q2) },
    { at: at3, text: "new one under Anything else", files: [], questionKey: ANYTHING_ELSE_KEY },
  ];
  const html = (over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(SentWork, {
    id: "needs-s1", timeZone: "UTC", kind: "written", answers: [item(Q1, "the boats"), item(Q2, "level 2")], notes: "Crashed once on level 3.", additions, files: [], ...over,
  }));

  it("one last fold after the questions: the notes as its original, then the old untied and the new additions, dated, oldest first", () => {
    const h = html();
    expect(h.match(/<details /g)).toHaveLength(3);
    // The last fold.
    expect(h.slice(h.indexOf(`data-fold="needs-s1-q-${ANYTHING_ELSE_KEY}"`))).not.toContain("<details");
    expect(h).toContain(`data-else-title="">${ANYTHING_ELSE_TITLE}</span>`);
    expect(h).toContain('data-added-count="2">· 2 added</span>');
    expect(h).not.toContain("not about one question");
    const body = h.slice(h.indexOf(`data-question-body="${ANYTHING_ELSE_KEY}"`));
    expect(body.indexOf("Crashed once on level 3.")).toBeGreaterThan(-1);
    expect(body).toContain('data-else-original=""');
    expect(body.indexOf("Crashed once on level 3.")).toBeLessThan(body.indexOf("old addition with no question"));
    expect(body.indexOf("old addition with no question")).toBeLessThan(body.indexOf("new one under Anything else"));
    expect(body).toContain(">Added · Nov 3, 2026, 11:29 PM</p>");
    expect(body).toContain(">Added · Nov 4, 2026, 9:10 AM</p>");
    expect(body).not.toContain("about Q2");
    // The question's addition stays under its question; Anything else comes after every question.
    expect(h.indexOf("about Q2")).toBeLessThan(h.indexOf(`data-fold="needs-s1-q-${ANYTHING_ELSE_KEY}"`));
    // Each text folds with the shared long-text fold (LongText), as a question's answer does.
    expect(src("components/SentWork.tsx")).toContain("answerFold(notes, `${id}-notes`, ANYTHING_ELSE_TITLE)");
  });

  it("on every written part, even with nothing in it", () => {
    const h = html({ notes: "", additions: [] });
    expect(h).toContain(`data-fold="needs-s1-q-${ANYTHING_ELSE_KEY}"`);
    expect(h.slice(h.indexOf(`data-question-body="${ANYTHING_ELSE_KEY}"`))).toContain('data-no-answer="">(nothing)</p>');
    expect(h).not.toContain("data-added-count");
  });

  it("the threads: the else key and no key both go to Anything else; a question's key never does", () => {
    const t = writtenThreads([item(Q1, "a"), item(Q2, "b")], [], additions);
    expect(t.general.map((a) => a.text)).toEqual(["old addition with no question", "new one under Anything else"]);
    expect(t.other.map((o) => (o.kind === "add" ? o.add.text : ""))).toEqual(["old addition with no question", "new one under Anything else"]);
    expect(t.threads[1].adds.map((a) => a.text)).toEqual(["about Q2"]);
    expect(isElseKey(undefined)).toBe(true);
    expect(isElseKey(ANYTHING_ELSE_KEY)).toBe(true);
    expect(isElseKey(questionKey(Q1))).toBe(false);
    expect(questionKey(ANYTHING_ELSE_TITLE)).not.toBe(ANYTHING_ELSE_KEY);
  });

  it("By question: Anything else is the last entry, its additions dated like a question's", () => {
    const b = answersByQuestion({ answers: [item(Q1, "a"), item(Q2, "b")], notes: "n", additions }, [], (at) => fmtStampIn(at, "UTC"));
    expect(b.notes).toBe("n\n\n*Added · Nov 3, 2026, 11:29 PM*\nold addition with no question\n\n*Added · Nov 4, 2026, 9:10 AM*\nnew one under Anything else");
    const blocks = byQuestion([Q1, Q2], [{ contractId: "c", tester: "Ana Silva", questions: [Q1, Q2], answers: b.answers, notes: b.notes, sentAt: new Date(at1), status: "waiting", paidCents: 0 }]);
    expect(blocks.at(-1)!.title).toBe(ANYTHING_ELSE_TITLE);
    expect(src("app/app/tests/[id]/ByQuestion.tsx")).not.toContain('"Other notes"');
  });

  it("every developer view draws it through SentWork (Needs you, the update row, the tester rows, the team's See the work)", () => {
    const page = src("app/app/tests/[id]/page.tsx");
    for (const id of ["needs-${x.s!.id}", "update-${x.id}", "row-${r.sub.id}"]) expect(page).toContain(`<SentWork id={\`${id}\`}`);
    expect(src("app/admin/DisputeWork.tsx")).toContain("<SentWork ");
  });
});

describe("§188 A: Anything else, the tester's side", () => {
  it("its own Add to this answer row after the questions' rows, opening under Anything else's latest part (its slot)", () => {
    const page = src("app/app/sessions/[id]/page.tsx");
    expect(page).toContain("currentKeys.includes(key) || key === ANYTHING_ELSE_KEY ? <div data-add-slot={`${c.id}:${key}`} /> : null");
    expect(page).toContain("{ key: ANYTHING_ELSE_KEY, question: ANYTHING_ELSE_TITLE }].map(({ key, question }) => (");
    // SentWork hands Anything else's slot to the page.
    const h = renderToStaticMarkup(createElement(SentWork, { id: "own", timeZone: "UTC", kind: "written", answers: [item(Q1, "a")], notes: "n", additions: [], files: [], addTo: ({ key }: { key: string }) => createElement("div", { "data-add-slot": `s1:${key}` }) }));
    const body = h.slice(h.indexOf(`data-question-body="${ANYTHING_ELSE_KEY}"`));
    expect(body).toContain(`data-add-slot="s1:${ANYTHING_ELSE_KEY}"`);
    const row = renderToStaticMarkup(createElement(WrittenAddForm, { sessionId: "s1", seenAt: seen(), questionKey: ANYTHING_ELSE_KEY, question: ANYTHING_ELSE_TITLE, made: 2, slot: `s1:${ANYTHING_ELSE_KEY}` }));
    expect(row).toContain('data-add-more="written">Add to this answer</button>');
    expect(row).toContain(`data-add-question="">${ANYTHING_ELSE_TITLE}</span>`);
    expect(row).toContain(`data-add-for="${ANYTHING_ELSE_KEY}"`);
    // At 10: no button (the page's one note under the panel says so).
    expect(renderToStaticMarkup(createElement(WrittenAddForm, { sessionId: "s1", seenAt: seen(), questionKey: ANYTHING_ELSE_KEY, question: ANYTHING_ELSE_TITLE, made: 10 }))).not.toContain("data-add-more");
  });

  it("adding there stores the else key; the lines name Anything else; old untied additions show with it; its draft is kept under add:<session>:else", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    expect((await send(j.sessionId, j.tester.cookie, "first notes")).status).toBe(200);
    const sub = await written(j.sessionId);
    await db.submission.update({ where: { id: sub.id }, data: { additions: [{ at: at1, text: "old one", files: [] }] } });
    const r = await addElse(j.sessionId, j.tester.cookie, "the music skipped in the cave");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const adds = additionsOf((await written(j.sessionId)).additions);
    expect(adds).toEqual([expect.objectContaining({ text: "old one" }), expect.objectContaining({ text: "the music skipped in the cave", questionKey: ANYTHING_ELSE_KEY })]);
    expect(addedWhat("her", "written answers", 1, ANYTHING_ELSE_TITLE)).toBe("added to “Anything else” in her written answers");
    const ev = await db.testEvent.findFirst({ where: { testId }, orderBy: { createdAt: "desc" } });
    expect(ev?.text).toBe("Ana Silva added to “Anything else” in her written answers");
    const bell = await db.notification.findFirst({ where: { userId: dev.user.id }, orderBy: { createdAt: "desc" } });
    expect(bell?.text).toContain("Ana Silva added to “Anything else” in her written answers for “Harbor Run”");
    const log = await db.actionLog.findFirst({ where: { userId: j.tester.user.id }, orderBy: { createdAt: "desc" } });
    expect(log?.text).toContain("added to “Anything else” in your written answers");
    // Drawn: both under Anything else, after the notes.
    const s2 = await written(j.sessionId);
    const h = renderToStaticMarkup(createElement(SentWork, { id: "x", timeZone: "UTC", kind: "written", answers: s2.answers, questions: [Q1, Q2], notes: s2.notes, additions: s2.additions, files: [] }));
    const body = h.slice(h.indexOf(`data-question-body="${ANYTHING_ELSE_KEY}"`));
    expect(body.indexOf("first notes")).toBeLessThan(body.indexOf("old one"));
    expect(body.indexOf("old one")).toBeLessThan(body.indexOf("the music skipped in the cave"));
    // The draft's own key.
    const key = `add:${j.sessionId}:${ANYTHING_ELSE_KEY}`;
    expect((await json(await keptPOST(req("/api/kept", { cookie: j.tester.cookie, headers: { "x-uid": j.tester.user.id }, body: { key, data: { text: "half typed" } } })))).status).toBe(200);
    const back = await json(await keptGET(req(`/api/kept?key=${encodeURIComponent(key)}`, { cookie: j.tester.cookie, headers: { "x-uid": j.tester.user.id } })));
    expect(back.body.data).toMatchObject({ text: "half typed" });
  });

  it("counts toward the part's 10: the 10th under Anything else goes, the 11th (there or under a question) is refused", async () => {
    const { testId } = await setup();
    const j = await joined(testId);
    await send(j.sessionId, j.tester.cookie);
    const sub = await written(j.sessionId);
    await db.submission.update({ where: { id: sub.id }, data: { additions: Array.from({ length: 9 }, (_, i) => ({ at: new Date(Date.now() - 60_000 + i).toISOString(), text: `added ${i}`, files: [], ...(i % 2 ? { questionKey: questionKey(Q1) } : {}) })) } });
    expect((await addElse(j.sessionId, j.tester.cookie, "the tenth")).status).toBe(200);
    const eleventh = await addElse(j.sessionId, j.tester.cookie, "the eleventh");
    expect(eleventh.status).toBe(409);
    expect(eleventh.body.error.message).toBe(ADDITIONS_FULL);
    const underQ = await sact(j.sessionId, "written-add", j.tester.cookie, { text: "under a question", question: questionKey(Q1), seenAt: seen(), confirmed: true });
    expect(underQ.body.error.message).toBe(ADDITIONS_FULL);
    expect(additionsOf((await written(j.sessionId)).additions)).toHaveLength(10);
  });

  it("20,000 characters per addition: 20,001 refused on the first press, 20,000 goes", async () => {
    const { testId } = await setup();
    const j = await joined(testId);
    await send(j.sessionId, j.tester.cookie);
    const long = await addElse(j.sessionId, j.tester.cookie, "x".repeat(20_001), { confirmed: false, loadedAt: seen() });
    expect(long.status).toBe(400);
    expect(long.body.error.message).toBe(additionTooLongLine(20_001));
    expect((await addElse(j.sessionId, j.tester.cookie, "y".repeat(20_000))).status).toBe(200);
  });

  it("stops once for the developer's payment on the written answers since her page loaded (forced, Alerts Off), then goes", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    await send(j.sessionId, j.tester.cookie);
    const sub = await written(j.sessionId);
    expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    await db.user.update({ where: { id: j.tester.user.id }, data: { testerAlertsOff: true } });
    await settle();
    const loaded = seen();
    await settle();
    expect((await payMore(s.testId, s.dev.cookie, { contractId: j.sessionId, submissionId: sub.id, amount: "2.00", tickedCents: 200 })).status).toBe(200);
    await settle();
    const first = await sact(j.sessionId, "written-add", j.tester.cookie, { text: "More about the cave.", question: ANYTHING_ELSE_KEY, seenAt: loaded, loadedAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(first.body.error.changes).toEqual([expect.objectContaining({ text: "Nora Lane paid you $2.00 more for your written answers", forced: true })]);
    await settle();
    const second = await sact(j.sessionId, "written-add", j.tester.cookie, { text: "More about the cave.", question: ANYTHING_ELSE_KEY, seenAt: loaded, boxAt: seen(), confirmed: true });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
const CHECK_URL = "https://hooks.stripe.com/3d_secure_2/hosted?fake=1";
const devs: string[] = [];
afterAll(async () => {
  await db.payment.updateMany({ where: { developerId: { in: devs }, status: { notIn: ["charged", "bundled", "not_set_up"] } }, data: { status: "cancelled", actionPi: null, actionBy: null } });
});
afterEach(() => setStripeForTests(null));

function fakeStripe() {
  const status = new Map<string, { status: string }>();
  const changed: string[] = [];
  setStripeForTests({
    paymentIntents: {
      create: async () => {
        const id = "pi_" + randomUUID();
        status.set(id, { status: "requires_action" });
        return { id, status: "requires_action", client_secret: `${id}_secret_x`, next_action: { type: "redirect_to_url", redirect_to_url: { url: CHECK_URL, return_url: "http://localhost:3400/api/payments/bank-return" } } };
      },
      retrieve: async (id: string) => ({ id, client_secret: `${id}_secret_x`, ...(status.get(id) ?? { status: "succeeded" }) }),
      cancel: async (id: string) => { changed.push(`cancel ${id}`); status.set(id, { status: "canceled" }); return { id, status: "canceled" }; },
    },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
  } as unknown as Stripe);
  return { status, changed };
}

/** Ana's written answers paid $10.00, then the developer's Pay more $2.00 on them left open at the bank (another tab). */
async function ownOpen() {
  const s = await setup();
  devs.push(s.dev.user.id);
  const j = await joined(s.testId);
  await send(j.sessionId, j.tester.cookie);
  const sub = await written(j.sessionId);
  expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID() } });
  await settle();
  const st = fakeStripe();
  const r = await payMore(s.testId, s.dev.cookie, { contractId: j.sessionId, submissionId: sub.id, amount: "2.00", tickedCents: 200 });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body).toMatchObject({ requiresAction: true });
  await settle();
  return { ...s, ...j, sub, st, paymentId: r.body.paymentId as string };
}
const box = (over: Record<string, unknown>) => renderToStaticMarkup(createElement(PayBox, {
  kind: "submission", id: "sub1", name: "Ana Silva", listingCents: 1000, listingText: "$10.00", paidSoFarCents: 1000, seenAt: seen(), more: { testId: "t1", contractId: "c1" }, ...over,
}));

describe("§188 B: the Pay more box waiting for the developer's own check", () => {
  it("the waiting row names it as the developer's own press; the box offers Cancel this check right next to the line, greyed except that row", async () => {
    const o = await ownOpen();
    const w = await bankWaitsOf(db, { submissionId: o.sub.id }, "Ana Silva");
    expect(w).toEqual({ id: o.paymentId, kind: "own", cents: 200, line: "Your $2.00 payment for this part is waiting for your bank: finish or cancel it first." });
    const h = box({ bankWaits: w!.line, bankWaitsId: w!.id, bankWaitsKind: { kind: w!.kind, cents: w!.cents } });
    expect(h).toContain('data-pay-greyed=""');
    const row = h.slice(h.indexOf('data-pay-more-waits=""'), h.indexOf("</div>", h.indexOf('data-pay-more-waits=""')));
    expect(row).toContain('data-waits-kind="own"');
    expect(row).toMatch(/Your \$2\.00 payment for this part is waiting for your bank: finish or cancel it first\.\s*<button[^>]*data-cancel-own-check="">Cancel this check<\/button><\/p>/);
    expect(row).not.toContain("Confirm with your bank");
    // Pay more stays greyed until the wait ends.
    expect(h).toMatch(/<button class="btn-green" disabled="">Pay more<\/button>/);
  });

  it("Cancel this check: Stripe first, cancelled (nothing charged, the plain §170 line); the box un-greys at once; nothing waits any more", async () => {
    const o = await ownOpen();
    // The box's press is BankWaiting's own-press cancel (one function, shared).
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain("const r = await cancelOwnCheck(id);");
    expect(src("components/BankWaiting.tsx")).toContain("const r = await cancelOwnCheck(paymentId);");
    const r = await json(await confirmPOST(req("/api/payments/confirm", { cookie: o.dev.cookie, body: { paymentId: o.paymentId } })));
    expect(r.status).toBe(402);
    expect(r.body.error.code).toBe("not_confirmed");
    expect(cancelledCheckLine(r.body.error.message, r.body.error.by)).toBe(CANCELLED_NOTHING_CHARGED);
    expect(CANCELLED_NOTHING_CHARGED).toBe("Cancelled: nothing was charged.");
    expect(o.st.changed).toEqual([expect.stringMatching(/^cancel pi_/)]);
    expect((await db.payment.findUniqueOrThrow({ where: { id: o.paymentId } })).status).toBe("cancelled");
    // Un-greyed at once: the page drawn before the cancel still names it, and the box ignores it.
    const line = "Your $2.00 payment for this part is waiting for your bank: finish or cancel it first.";
    expect(payMoreWaits(line, o.paymentId, { open: false, checkId: "", cancelled: o.paymentId })).toBeUndefined();
    expect(payMoreWaits(line, "another", { open: false, checkId: "", cancelled: o.paymentId })).toBe(line);
    expect(await bankWaitsOf(db, { submissionId: o.sub.id }, "Ana Silva")).toBeNull();
    // §174 still: never greyed over its own open check.
    expect(payMoreWaits(line, o.paymentId, { open: true, checkId: o.paymentId })).toBeUndefined();
  });

  it("already gone through at the bank: recorded as paid once, said with the amount", async () => {
    const o = await ownOpen();
    for (const [pi] of o.st.status) o.st.status.set(pi, { status: "succeeded" });
    const r = await json(await confirmPOST(req("/api/payments/confirm", { cookie: o.dev.cookie, body: { paymentId: o.paymentId } })));
    expect(r.status).toBe(200);
    expect(r.body.done).toBe(true);
    expect(o.st.changed).toEqual([]);
  });

  it("a charge made while away waiting on the part: Confirm with your bank in the box instead (no Cancel this check, no second bank-<id> anchor)", async () => {
    const o = await ownOpen();
    await db.payment.update({ where: { id: o.paymentId }, data: { status: "cancelled", actionPi: null } });
    const away = await db.payment.create({ data: { kind: "dispute", contractId: o.sessionId, submissionId: o.sub.id, developerId: o.dev.user.id, testerId: o.tester.user.id, amountCents: 500, feeCents: 100, testerCents: 400, status: "needs_confirmation", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 2 * 86_400_000) } });
    const w = await bankWaitsOf(db, { submissionId: o.sub.id }, "Ana Silva");
    expect(w).toEqual({ id: away.id, kind: "away", cents: 500, line: "Confirm Ana Silva's $5.00 charge with your bank first." });
    const h = box({ bankWaits: w!.line, bankWaitsId: w!.id, bankWaitsKind: { kind: w!.kind, cents: w!.cents } });
    const row = h.slice(h.indexOf('data-pay-more-waits=""'));
    expect(row).toContain('data-waits-kind="away"');
    expect(row).toContain(`data-bank-waiting="${away.id}"`);
    expect(row).toContain("Confirm Ana Silva&#x27;s $5.00 charge with your bank first.");
    expect(row).toContain(">Confirm with your bank</button>");
    expect(h).not.toContain(CANCEL_THIS_CHECK);
    expect(h).not.toContain(`id="bank-${away.id}"`);
    // It stays in the Confirm lists (a charge made while away).
    expect((await waitingConfirmation(o.dev.user.id)).map((p) => p.id)).toContain(away.id);
  });

  it("the developer's own open check is never in a Confirm with your bank list or its counts (only charges made while away are)", async () => {
    const o = await ownOpen();
    expect((await waitingConfirmation(o.dev.user.id)).map((p) => p.id)).not.toContain(o.paymentId);
    expect((await confirmItems(o.dev.user.id)).map((p) => p.id)).not.toContain(o.paymentId);
    expect((await bankToConfirm(o.dev.user.id)).map((p) => p.id)).not.toContain(o.paymentId);
    expect((await bankWaitingOnTest(o.dev.user.id, o.testId)).map((p) => p.id)).not.toContain(o.paymentId);
    // The test page's Needs you count is the Confirm rows' (bankWaitingOnTest) plus the other things waiting.
    expect(src("app/app/tests/[id]/page.tsx")).toContain("const needsCount = bankRows.length +");
  });
});
