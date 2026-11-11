import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { NOTHING_TO_ADD, ZERO_PAY_REASON } from "@/lib/rules";
import { ANSWER_ONE } from "@/lib/questions";
import { pay, payMore } from "./b15";
import { addTo, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 11, §380 D2; replaces §380 D's "disabled until valid") Send Answers, Add to this answer, Dispute, Charge, Pay / Pay more and Send your side stay
// pressable with their fields incomplete. One press marks the red notes at the fields on the page AND still goes to the server, whose order is refusals (final,
// then soft) → stop-once box → the form's own mistakes as the safety net: a refusal or a box is answered (and shown under the button, with the red notes kept),
// only mistakes left → the mistakes, and nothing is ever saved while they remain.

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const ANS = "The harbour level was clear and the boats handled well on the first try.";
const DAY = 86_400_000;
type Res = { status: number; body: { error?: { code?: string; message?: string } } & Record<string, unknown> };
const code = (r: Res) => [r.status, r.body.error?.code];

/** Ana sent her written answers; Nora paid them $10.00 (Alerts Off: only a payment on the same part stops her). */
async function paidWorld() {
  const s = await setup();
  const j = await joined(s.testId);
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: [ANS, ANS], seenAt: seen(), confirmed: true })).status).toBe(200);
  const written = await db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: j.sessionId, kind: "written" } } });
  expect((await pay(s.dev.cookie, { kind: "submission", id: written.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  await db.user.update({ where: { id: j.tester.user.id }, data: { testerAlertsOff: true } });
  await settle();
  return { ...s, ...j, written };
}

describe("§380 D2: Send Answers", () => {
  it("incomplete + a refusal: the refusal (never the red mistake), nothing saved", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    expect((await sact(j.sessionId, "leave", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    const r = await sact(j.sessionId, "written", j.tester.cookie, { answers: ["", ""], seenAt: seen(), confirmed: true });
    expect(r.status).toBe(409);
    expect(r.body.error?.message).not.toBe(ANSWER_ONE);
    expect(await db.submission.count({ where: { contractId: j.sessionId } })).toBe(0);
  });

  it("incomplete, nothing else: the red mistake only, nothing saved; complete: saved", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const r = await sact(j.sessionId, "written", j.tester.cookie, { answers: ["", ""], seenAt: seen(), confirmed: true });
    expect([r.status, r.body.error?.message]).toEqual([400, ANSWER_ONE]);
    expect(await db.submission.count({ where: { contractId: j.sessionId } })).toBe(0);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: [ANS, ""], seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await db.submission.count({ where: { contractId: j.sessionId } })).toBe(1);
  });

  it("the server's order: the stop-once box before the form's own mistakes (§375's one pass)", () => {
    const t = src("lib/server/tests.ts");
    const send = t.slice(t.indexOf("export async function sendWritten"), t.indexOf("async function saveWritten"));
    expect(send.indexOf("const final = sendRefusal(")).toBeLessThan(send.indexOf("const soft = await softRefusals("));
    expect(send.indexOf("const soft = await softRefusals(")).toBeLessThan(send.indexOf("const box = await testerSendGate("));
    expect(send.indexOf("const box = await testerSendGate(")).toBeLessThan(send.indexOf("const mistake = formMistakes(page, sent);"));
    const add = t.slice(t.indexOf("export async function addWritten"), t.indexOf("async function saveAddition"));
    expect(add.indexOf("const box = await testerSendGate(")).toBeLessThan(add.indexOf("const mistake = await addMistakes("));
  });
});

describe("§380 D2: Add to this answer", () => {
  it("empty + a stop-once box (a payment on the part since the page loaded): the box; then the red mistake; nothing saved until it's fixed", async () => {
    const w = await paidWorld();
    const loaded = seen();
    await settle();
    expect((await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.written.id, amount: "2.00", tickedCents: 200 })).status).toBe(200);
    await settle();
    const first = await addTo(w.sessionId, w.tester.cookie, { text: "", seenAt: loaded, loadedAt: loaded });
    expect(code(first), JSON.stringify(first.body)).toEqual([409, "stop_once"]);
    await settle();
    const second = await addTo(w.sessionId, w.tester.cookie, { text: "", seenAt: loaded, boxAt: seen(), confirmed: true });
    expect([second.status, second.body.error?.message]).toEqual([400, NOTHING_TO_ADD]);
    expect((await db.submission.findUniqueOrThrow({ where: { id: w.written.id } })).additions ?? []).toEqual([]);
    expect((await addTo(w.sessionId, w.tester.cookie, { text: "An addition after payment.", seenAt: loaded, boxAt: seen(), confirmed: true })).status).toBe(200);
  });
});

describe("§380 D2: Dispute", () => {
  it("a short reason + a stop-once box: the box; then the red reason; nothing disputed until it's fixed", async () => {
    const w = await paidWorld();
    const loaded = seen();
    await settle();
    expect((await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.written.id, amount: "2.00", tickedCents: 200 })).status).toBe(200);
    await settle();
    const dispute = (body: Record<string, unknown>) => sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.written.id, ...body });
    const first = await dispute({ reason: "short", seenAt: loaded, loadedAt: loaded });
    expect(code(first), JSON.stringify(first.body)).toEqual([409, "stop_once"]);
    await settle();
    const second = await dispute({ reason: "short", seenAt: loaded, boxAt: seen(), confirmed: true });
    expect(code(second)).toEqual([400, "bad_reason"]);
    expect(await db.dispute.count({ where: { submissionId: w.written.id } })).toBe(0);
    expect((await dispute({ reason: "I answered every question fully and in detail.", seenAt: loaded, boxAt: seen(), confirmed: true })).status).toBe(200);
  });
});

describe("§380 D2: Pay", () => {
  it("$0 without its reason + a stop-once box (another tester joined): the box; then the red reason; nothing paid until it's fixed", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: [ANS, ANS], seenAt: seen(), confirmed: true })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await settle();
    const loaded = seen();
    await settle();
    await joined(s.testId, "Ben Carter", "he");
    const first = await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "0", reason: "", seenAt: loaded, confirmed: false });
    expect(code(first), JSON.stringify(first.body)).toEqual([409, "stop_once"]);
    const second = await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "0", reason: "", seenAt: loaded, confirmed: true });
    expect([second.status, second.body.error?.message]).toEqual([400, ZERO_PAY_REASON]);
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
    expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "0", reason: "Missing answers", seenAt: loaded, confirmed: true })).status).toBe(200);
  });

  it("no amount + a refusal (already paid): the refusal, never the red amount; nothing more paid", async () => {
    const w = await paidWorld();
    const r = await pay(w.dev.cookie, { kind: "submission", id: w.written.id, amount: "", tickedCents: null });
    expect(code(r)).toEqual([409, "reviewed"]);
    expect(await db.payment.count({ where: { submissionId: w.written.id } })).toBe(1);
  });

  it("Pay more with no amount, nothing else: the red amount, nothing charged", async () => {
    const w = await paidWorld();
    const r = await payMore(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.written.id, amount: "", tickedCents: null });
    expect([r.status, r.body.error?.message]).toEqual([400, "Enter an amount like 7.50."]);
    expect(await db.payment.count({ where: { submissionId: w.written.id, kind: "extra" } })).toBe(0);
  });
});

describe("§380 D2: Charge", () => {
  it("an empty amount box is its red mistake (never the whole listed amount); nothing charged; a typed amount charges", async () => {
    const s = await setup({ writtenCents: "9.00" });
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY), payBy: new Date(Date.now() - DAY) } });
    const charge = (amount: string) => sact(j.sessionId, "choose", j.tester.cookie, { submissionId: sub.id, choice: "charge", amount, seenAt: seen(), confirmed: true });
    const empty = await charge("");
    expect([empty.status, empty.body.error?.message]).toEqual([400, "Enter an amount like 5.00."]);
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
    expect((await charge("9.00")).body).toMatchObject({ choice: "charge", amountCents: 900 });
  });
});

describe("§380 D2: the pages", () => {
  it("never disabled by their fields; the red notes and the server's refusal are kept apart, so both show after one press", () => {
    const s = src("app/app/sessions/[id]/SessionActions.tsx");
    // Send Answers: the red at the questions (`msg`) stays while the refusal (`refused`) shows under the button.
    expect(s).toContain("disabled={busy || unchanged}");
    expect(s).toContain('const [refused, setRefused] = useCarried(carry, "refused", "");');
    expect(s).toContain("else setRefused(errOf(err));");
    expect(s).toContain('<Err text={refused || (msg && !msg.ok && !msg.text.startsWith(FIELD) ? msg.text : "")} press={sendPress} />');
    // Add: the same.
    expect(s).toContain('data-add-send="written" disabled={busy || fin.done}');
    expect(s).toContain("else setRefused(errOf(e)); // (§380 D2) under the button; the red note stays");
    // Dispute: the red is marked on the press and the press still goes.
    expect(s).toContain('checkFields(e.currentTarget.closest("details")); // (§380 D2) red at the reason, and the press still goes');
    const c = src("app/app/sessions/[id]/ChoiceBox.tsx");
    expect(c).toContain("disabled={busy} onClick={(e) => charge(e.currentTarget.parentElement)}");
    expect(c).toMatch(/if \(first\) markServerMistakes\(root, \[first\]\);\s+checkFields\(root\);\s+setRedAmount\([^)]*\);\s+go\("charge"\);/);
    const p = src("app/app/tests/[id]/PayBox.tsx");
    expect(p).toContain("disabled={busy || bank.open || !!bankWaits || !!p.owes} onClick={(e) => { const root = e.currentTarget.closest(\"div.space-y-3\"); const m = payMistake(); if (m) markServerMistakes(root, [m]); checkFields(root); go(); }}");
    expect(src("app/app/tests/[id]/DisputeSide.tsx")).toContain("<PressButton before={markText} seenAt={seenAt}");
  });

  it("every press still locks the page until it's answered (lib/client.ts api)", () => {
    const client = src("lib/client.ts");
    expect(client).toContain("if (locks) pressStarted();");
    expect(client).toContain("if (locks) pressAnswered(false);");
  });
});
