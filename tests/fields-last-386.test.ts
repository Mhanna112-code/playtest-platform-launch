import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { POST as helpPOST } from "@/app/api/help/route";
import { POST as reportsPOST } from "@/app/api/reports/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { CONTACT_LIMIT_PER_DAY } from "@/lib/limits";
import { pauseTest } from "@/lib/server/restrictions";
import { json, makeUser, req } from "./helpers";
import { act, joined, listingBody, sact, seen, settle, setup } from "./fixtures";
import { pay, payMore, sentWork } from "./b15";

// (Owner, Nov 11, §386 C) Field mistakes last on every form: refusals → stop-once box → the form's own mistakes. One press shows the red notes AND the refusal
// or the box; nothing is saved while a field is wrong. One test per form.

async function admin() {
  const a = await makeUser({ name: "Team Admin" });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const msg = (r: { body: { error?: { message?: string; code?: string } } }) => r.body.error?.message;

describe("§386 C Stop the test", () => {
  it("no reason + a stop-once box → the box; then the red reason; nothing stopped until it's given", async () => {
    const s = await setup();
    await joined(s.testId, "Ana Silva");
    const loaded = seen();
    await settle();
    await joined(s.testId, "Ben Okafor"); // a tester joined since the page loaded
    const first = await act(s.testId, "stop", s.dev.cookie, { reason: "", seenAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    const second = await act(s.testId, "stop", s.dev.cookie, { reason: "", seenAt: loaded, confirmed: true, boxAt: seen() });
    expect([second.status, msg(second)]).toEqual([400, "Say why you're stopping the test (testers read it)."]);
    expect((await db.test.findUniqueOrThrow({ where: { id: s.testId } })).status).not.toBe("stopped");
  });
});

describe("§386 C End early", () => {
  it("no tester ticked on a stopped test → the stopped refusal; alone → the red tick", async () => {
    const s = await setup();
    const a = await joined(s.testId, "Ana Silva");
    expect(msg(await act(s.testId, "end-early", s.dev.cookie, { contractIds: [], reason: "", seenAt: seen() }))).toBe("Tick at least one tester.");
    expect((await act(s.testId, "stop", s.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(msg(await act(s.testId, "end-early", s.dev.cookie, { contractIds: [], reason: "", seenAt: seen() }))).toBe("This test was stopped, so your End early didn't go through.");
    expect((await db.contract.findUniqueOrThrow({ where: { id: a.sessionId } })).endKind).toBe("stopped");
  });
});

describe("§386 C Rate", () => {
  it("no stars + a refusal (the test is paused) → the refusal; no stars alone → the red stars", async () => {
    const x = await sentWork();
    expect((await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    await settle();
    expect(msg(await sact(x.sessionId, "rate", x.tester.cookie, { seenAt: seen() }))).toBe("Choose 1 to 5 stars.");
    await pauseTest((await admin()).user.id, x.testId, "Checking");
    expect(msg(await sact(x.sessionId, "rate", x.tester.cookie, { seenAt: seen() }))).toBe("This test is paused, so your Rate didn't go through.");
    expect(await db.rating.count({ where: { contractId: x.sessionId } })).toBe(0);
  });
});

describe("§386 C Pay and Pay more notes", () => {
  it("a note over 1,000 characters + a refusal (already paid / not paid yet) → the refusal; alone → the red length", async () => {
    const x = await sentWork();
    const long = "x".repeat(1001);
    expect(msg(await payMore(x.testId, x.dev.cookie, { contractId: x.sessionId, submissionId: x.sub.id, amount: "1.00", note: long }))).toBe("Pay this part first: Pay more is for a part you've already paid.");
    expect(msg(await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "10.00", tickedCents: 1000, reason: long }))).toBe("Keep it to 1,000 characters.");
    expect(await db.review.count({ where: { submissionId: x.sub.id } })).toBe(0);
    expect((await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "5.00", tickedCents: 500, reason: "Half of it" })).status).toBe(200);
    expect(msg(await pay(x.dev.cookie, { kind: "submission", id: x.sub.id, amount: "10.00", tickedCents: 1000, reason: long }))).toBe("You already paid $5.00 for Ana Silva's written answers.");
    expect(msg(await payMore(x.testId, x.dev.cookie, { contractId: x.sessionId, submissionId: x.sub.id, amount: "1.00", tickedCents: 100, note: long }))).toBe("Keep it to 1,000 characters.");
    expect(await db.payment.count({ where: { submissionId: x.sub.id, kind: "extra" } })).toBe(0);
  });
});

describe("§386 C Contact us", () => {
  it("no topic + the day's limit → the limit; no topic alone → the red topic; nothing sent", async () => {
    const u = await makeUser();
    const send = (body: Record<string, unknown>) => helpPOST(req("/api/help", { cookie: u.cookie, body })).then(json);
    expect(msg(await send({ topic: "", message: "" }))).toBe("Choose what it's about.");
    for (let i = 0; i < CONTACT_LIMIT_PER_DAY; i++) await db.contactMessage.create({ data: { userId: u.user.id, topic: "Other", message: `Message number ${i}` } });
    const r = await send({ topic: "", message: "" });
    expect(r.body.error?.code).toBe("limit");
    expect(await db.contactMessage.count({ where: { userId: u.user.id } })).toBe(CONTACT_LIMIT_PER_DAY);
  });
});

describe("§386 C Admin notes", () => {
  it("Suspend with no note on an account already suspended → 'already suspended'; alone → the red note", async () => {
    const a = await admin();
    const dev = await makeUser({ dev: true });
    expect(msg(await aact(a.cookie, "suspend", { id: dev.user.id, note: "", side: "developer" }))).toBe("Record why (it is kept with the suspension).");
    expect((await aact(a.cookie, "suspend", { id: dev.user.id, note: "Spam posts", side: "developer" })).status).toBe(200);
    expect(msg(await aact(a.cookie, "suspend", { id: dev.user.id, note: "", side: "developer" }))).toMatch(/already suspended/);
  });
  it("Pause a test with a note over 1,000 characters on a test already paused → the refusal; alone → the red length", async () => {
    const a = await admin();
    const s = await setup();
    const long = "x".repeat(1001);
    expect(msg(await aact(a.cookie, "pause-test", { id: s.testId, note: long }))).toBe("Keep it to 1,000 characters.");
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking it" })).status).toBe(200);
    expect(msg(await aact(a.cookie, "pause-test", { id: s.testId, note: long }))).not.toBe("Keep it to 1,000 characters.");
  });
});

describe("§386 C Request a time", () => {
  it("the developer: a missing time + a ticked tester who left → the refusal; alone → the red time", async () => {
    const s = await setup();
    const a = await joined(s.testId, "Ana Silva");
    const bad = { contractIds: [a.sessionId], rows: [], minutes: "30", seenAt: seen() };
    expect((await act(s.testId, "request-time", s.dev.cookie, bad)).body.error?.code).toBe("bad_time");
    expect((await sact(a.sessionId, "leave", a.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(msg(await act(s.testId, "request-time", s.dev.cookie, { ...bad, seenAt: seen() }))).toBe("Ana Silva's session has ended, so your Request a time didn't go through.");
  });
  it("the tester: a bad length on a paused test → the paused refusal; alone → the red length", async () => {
    const s = await setup();
    const a = await joined(s.testId, "Ana Silva");
    const bad = { rows: [{ startsAt: new Date(Date.now() + 72 * 3_600_000).toISOString(), repeat: "once" }], minutes: "", seenAt: seen() };
    expect((await sact(a.sessionId, "request-time", a.tester.cookie, bad)).body.error?.code).toBe("bad_minutes");
    await pauseTest((await admin()).user.id, s.testId, "Checking");
    expect(msg(await sact(a.sessionId, "request-time", a.tester.cookie, { ...bad, seenAt: seen() }))).toBe("This test is paused right now, so your Request a time didn't go through.");
  });
});

describe("§386 C Report", () => {
  it("a short note + a pause since the profile loaded (the box) → the box; then the red note; nothing reported", async () => {
    const s = await setup();
    const a = await joined(s.testId, "Ana Silva");
    const loaded = seen();
    await settle();
    await pauseTest((await admin()).user.id, s.testId, "Checking");
    const report = (body: Record<string, unknown>) => reportsPOST(req("/api/reports", { cookie: a.tester.cookie, body: { userId: s.dev.user.id, note: "Bad", ...body } })).then(json);
    const first = await report({ seenAt: loaded });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    const second = await report({ seenAt: loaded, confirmed: true, boxAt: seen() });
    expect([second.status, msg(second)]).toEqual([400, "Say what happened (the team reads it)."]);
    expect(await db.report.count({ where: { reporterId: a.tester.user.id } })).toBe(0);
  });
});

describe("§386 C Post a test", () => {
  it("a listing mistake + no card → the card refusal; with a card → the red mistake", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane", pronoun: "she", savedCard: false });
    const post = () => testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ title: "" }) })).then(json);
    expect((await post()).body.error?.code).toBe("card_required");
    await db.user.update({ where: { id: dev.user.id }, data: { stripePaymentMethodId: "pm_test_saved", cardExpMonth: 12, cardExpYear: 2030 } });
    expect((await post()).body.error?.code).toBe("bad_listing");
    expect(await db.test.count({ where: { developerId: dev.user.id } })).toBe(0);
  });
});

describe("§386 C the pages: each form stays pressable with its red notes (they mark the fields and still go)", () => {
  const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
  it("Rate, Report, Contact us, admin notes, Request a time, Post, Stop and End early", () => {
    expect(src("components/RateBox.tsx")).not.toContain("if (!checkFields(");
    expect(src("components/ReportButton.tsx")).not.toContain("if (!checkFields(");
    expect(src("app/admin/AdminButton.tsx")).not.toContain("if (!checkFields(");
    const contact = src("app/app/help/ContactForm.tsx");
    expect(contact).toContain('data-red-and-blue=""');
    expect(contact).not.toContain("if (!checkFields(");
    expect(src("components/CallRequests.tsx")).toContain('<button className="btn-ghost" disabled={busy} onClick={send}>Request a time</button>');
    expect(src("app/app/tests/[id]/DevCallPanel.tsx")).toContain("onClick={() => { checkFields(form.current); void request({");
    expect(src("app/app/tests/TestForm.tsx")).not.toContain('{...(edit ? { "data-red-and-blue": "" } : {})}');
    const top = src("app/app/tests/[id]/TopPanel.tsx");
    expect(top).toContain("confirmDisabled={busy} ");
    expect(top).toContain('if (!fine) void go("end-early", { contractIds: chosenIds, reason });');
  });
});
