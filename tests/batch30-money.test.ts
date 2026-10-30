import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import * as R from "@/lib/rules";
import * as M from "@/lib/moneyLines";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Oct 29) Batch 30 §2 (sending a part again after it's paid), §3 (late work: no Charge), §5 (the team closes open reviews at $0).

const DAY = 86_400_000;
const LONG = ["The harbour level felt great, but the second boss was far too hard for me.", "Nowhere really: the menus were clear and the tutorial explained the sails."];
const LONG2 = ["Update: after a second run the second boss is fine, the checkpoint helps a lot.", "Still nowhere: the menus were clear and the tutorial explained the sails well."];
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const more = (testId: string, cookie: string, body: Record<string, unknown>) => act(testId, "pay-extra", cookie, { seenAt: seen(), confirmed: true, payKey: randomUUID(), ...body });
const src = (p: string) => readFileSync(path.resolve(__dirname, "..", "src", p), "utf8");
async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const lines = async (userId: string) => (await db.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } })).map((n) => n.text);

/** A test with Ana's written answers sent (on time) and her session. */
async function sent(over: Record<string, unknown> = {}, name = "Ana Silva") {
  const s = await setup({ writtenCents: "10.00", ...over });
  const j = await joined(s.testId, name);
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: LONG, seenAt: seen(), confirmed: true })).status).toBe(200);
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}
const subOf = (id: string) => db.submission.findUniqueOrThrow({ where: { id }, include: { review: true } });

// ---------- §2 ----------

describe("batch 30 §2: sending a part again after it's paid", () => {
  it("the lines", () => {
    expect(M.updateAboveSendLine("Nora Lane", 1000, 100000, null)).toBe("Nora Lane has paid $10.00 for this. An update can be paid more, up to $1,000.00 in all.");
    expect(M.updateAboveSendLine("Nora Lane", 100000, 100000, null)).toBe("This part is already paid the most it can be ($1,000.00): Nora Lane can't pay more for an update.");
    expect(M.updateRowLine("Ana Silva", 1000, 99000)).toBe("Ana Silva sent an updated version after you paid ($10.00 paid · up to $990.00 more)");
    expect(M.UPDATED_AT_CAP).toBe("Updated after you paid · already paid the most");
    expect(M.updatedAtCapLive("Ana Silva", "her", "written answers")).toBe("Ana Silva sent an updated version of her written answers (already paid the most)");
    expect((R.DEV_QUIET_KINDS as readonly string[]).includes("sentpaid")).toBe(true);
  });

  it("below the cap: the update is sent, waits in Needs you (a stop line, the alert opens its row); $0 closes it with a note the tester reads", async () => {
    const w = await sent();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    // The paid part can be sent again (it used to be locked).
    const up = await sact(w.sessionId, "written", w.tester.cookie, { answers: LONG2, seenAt: seen(), confirmed: true });
    expect(up.status).toBe(200);
    const s = await subOf(w.sub.id);
    expect(s.paidUpdateAt).not.toBeNull();
    expect(M.updateWaiting(s)).toBe(true);
    expect(s.review!.amountCents).toBe(1000); // the same piece, its review kept
    expect((s.answers as { answer: string }[]).map((x) => x.answer)).toEqual(LONG2);
    const ev = await db.testEvent.findFirstOrThrow({ where: { testId: w.testId, kind: "sent" }, orderBy: { createdAt: "desc" } });
    expect(ev.text).toBe("Ana Silva sent an updated version of her written answers after you paid");
    const devLines = await db.notification.findMany({ where: { userId: w.dev.user.id }, orderBy: { createdAt: "desc" } });
    expect(devLines[0].text).toBe("Ana Silva sent an updated version of her written answers for “Harbor Run”");
    expect(devLines[0].link).toBe(`/app/tests/${w.testId}#update-${w.sub.id}`);
    const { updateRoomLeft } = await import("@/lib/server/paidUpdates");
    expect(await updateRoomLeft(w.sub.id, w.testId)).toBe(true);
    // $0 Pay more closes the row (no charge), with an optional note.
    const paysBefore = await db.payment.count({ where: { submissionId: w.sub.id } });
    const zero = await more(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "0", note: "Thanks, nothing new to pay for." });
    expect(zero.status).toBe(200);
    expect(zero.body.amountCents).toBe(0);
    const after = await subOf(w.sub.id);
    expect(M.updateWaiting(after)).toBe(false);
    expect(after.paidUpdateZeroAt).not.toBeNull();
    expect(after.paidUpdateNote).toBe("Thanks, nothing new to pay for.");
    expect(await db.payment.count({ where: { submissionId: w.sub.id } })).toBe(paysBefore); // nothing charged
    expect(await lines(w.tester.user.id)).toContain("Nora Lane paid $0 more for your updated written answers on “Harbor Run”");
    // A second $0 with nothing waiting: refused as before.
    const again = await more(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "0" });
    expect(again.status).toBe(400);
    expect(again.body.error.message).toBe("Enter an amount like 7.50.");
  });

  it("a Pay more (any amount above $0) also answers the update: the row leaves", async () => {
    const w = await sent();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect((await sact(w.sessionId, "written", w.tester.cookie, { answers: LONG2, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(M.updateWaiting(await subOf(w.sub.id))).toBe(true);
    const r = await more(w.testId, w.dev.cookie, { contractId: w.sessionId, submissionId: w.sub.id, amount: "5.00", tickedCents: 500 });
    expect(r.status).toBe(200);
    const s = await subOf(w.sub.id);
    expect(M.updateWaiting(s)).toBe(false);
    expect(s.paidUpdateZeroAt).toBeNull();
  });

  it("at the cap: no Needs you row, a quiet line, the usual Work sent alert only", async () => {
    const w = await sent();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "1000.00", tickedCents: 100000, over200: true })).status).toBe(200);
    expect((await sact(w.sessionId, "written", w.tester.cookie, { answers: LONG2, seenAt: seen(), confirmed: true })).status).toBe(200);
    const { paidUpdateRoom, updateRoomLeft } = await import("@/lib/server/paidUpdates");
    expect((await paidUpdateRoom(db, w.sub.id, w.testId)).atCap).toBe(true);
    expect(await updateRoomLeft(w.sub.id, w.testId)).toBe(false);
    const ev = await db.testEvent.findFirstOrThrow({ where: { testId: w.testId, kind: "sentpaid" } });
    expect(ev.text).toBe("Ana Silva sent an updated version of her written answers (already paid the most)");
    expect(await db.testEvent.count({ where: { testId: w.testId, kind: "sent", text: { contains: "after you paid" } } })).toBe(0);
    const devLines = await lines(w.dev.user.id);
    expect(devLines).toContain("Ana Silva updated her written answers for “Harbor Run”");
    expect(devLines.some((l) => l.startsWith("Ana Silva sent an updated version"))).toBe(false);
    // The page: the at-cap tag on the tester's row; the update row only below the cap while Pay more is open.
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain("{UPDATED_AT_CAP}");
    expect(page).toContain("updateWaiting(x) && (rooms.get(x.id)?.room ?? 0) > 0");
    expect(page).toContain("restricted || !payMore.open ? []");
  });

  it("Pay more closed (the close-out passed): the update doesn't wait in Needs you", async () => {
    const w = await sent();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect((await sact(w.sessionId, "written", w.tester.cookie, { answers: LONG2, seenAt: seen(), confirmed: true })).status).toBe(200);
    const { updateRoomLeft } = await import("@/lib/server/paidUpdates");
    expect(await updateRoomLeft(w.sub.id, w.testId)).toBe(true);
    // The last deadline 20 days ago: the close-out (14 days after it) passed.
    await db.contract.update({ where: { id: w.sessionId }, data: { dueAt: new Date(Date.now() - 20 * DAY) } });
    await db.test.update({ where: { id: w.testId }, data: { openUntil: new Date(Date.now() - 21 * DAY) } });
    await db.submission.update({ where: { id: w.sub.id }, data: { payBy: new Date(Date.now() - 20 * DAY) } }); // its own window too
    expect(await updateRoomLeft(w.sub.id, w.testId)).toBe(false);
  });

  it("a paid recording can be updated too (new uploads aren't refused); an old rejection and a team closure stay locked", async () => {
    const { resendRefusal } = await import("@/lib/server/paidUpdates");
    expect(resendRefusal({ rejected: false }, "recording")).toBe("");
    expect(resendRefusal({ rejected: true }, "written")).toBe("Your written answers were already reviewed, so they can't be changed.");
    expect(resendRefusal({ rejected: false, teamClosedById: "a" }, "written")).toBe(M.TEAM_CLOSED_NO_CHANGE);
    const s = await setup({ writtenCents: null, recordingCents: "20.00" });
    const j = await joined(s.testId);
    const start = await sact(j.sessionId, "recording-start", j.tester.cookie, { filename: "run.webm", size: 1000, contentType: "video/webm" });
    expect(start.status).toBe(200);
    await db.recording.update({ where: { id: start.body.recordingId }, data: { uploadedAt: new Date() } });
    expect((await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "recording" } });
    expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "20.00", tickedCents: 2000 })).status).toBe(200);
    const again = await sact(j.sessionId, "recording-start", j.tester.cookie, { filename: "run2.webm", size: 1000, contentType: "video/webm" });
    expect(again.status).toBe(200);
    await db.recording.update({ where: { id: again.body.recordingId }, data: { uploadedAt: new Date() } });
    expect((await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(M.updateWaiting(await subOf(sub.id))).toBe(true);
  });

  it("an update doesn't reopen a dispute (the dispute stays as it was)", async () => {
    const w = await sent();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "5.00", tickedCents: 500, reason: "Missing the second answer's detail." })).status).toBe(200);
    expect((await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.sub.id, reason: "We agreed the full price in the chat.", seenAt: seen(), confirmed: true })).status).toBe(200);
    await db.dispute.updateMany({ where: { submissionId: w.sub.id }, data: { status: "decided", decidedCents: 500, decidedAt: new Date() } });
    expect((await sact(w.sessionId, "written", w.tester.cookie, { answers: LONG2, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await db.dispute.findFirstOrThrow({ where: { submissionId: w.sub.id } })).status).toBe("decided");
    const again = await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.sub.id, reason: "Again, please, it was updated.", seenAt: seen(), confirmed: true });
    expect(again.status).toBe(409);
  });
});

// ---------- §3 ----------

describe("batch 30 §3: late listed work never opens Charge", () => {
  it("the lines", () => {
    expect(M.NO_CHARGE_LATE).toBe("You can't charge for work sent after your deadline.");
    expect(M.lateBeforeSendLine("Nov 3, 2026", "Nora Lane")).toBe("Your deadline passed on Nov 3, 2026. You can still send this: Nora Lane decides what to pay for late work, and you can't charge for it.");
    expect(M.lateSentLine("Nov 3, 2026", "Nora Lane")).toBe("Sent late (deadline was Nov 3, 2026): Nora Lane decides what to pay. You can't charge for late work.");
    expect(R.PAY_RULES_TICK).toContain("for work they sent by their own deadline");
    const terms = src("lib/termsOfUse.ts");
    expect(terms).toContain("Work sent after the tester's own deadline never opens Charge or Let it go");
    const session = src("app/app/sessions/[id]/page.tsx");
    expect(session).toContain("lateBeforeSendLine(fmtDate(c.dueAt), dev)");
    expect(session).toContain("lateSentLine(fmtDate(c.dueAt), dev)");
  });

  it("on-time listed work: Charge opens as today", async () => {
    const w = await sent();
    const past = new Date(Date.now() - DAY);
    await db.contract.update({ where: { id: w.sessionId }, data: { dueAt: past } });
    await db.submission.update({ where: { id: w.sub.id }, data: { payBy: past } });
    const { runDaily } = await import("@/lib/server/holds");
    await runDaily(new Date());
    expect((await subOf(w.sub.id)).choiceOfferedAt).not.toBeNull();
  });

  it("late listed work: no Charge (daily job, UI rule and server), not in Pay now; Pay works; it closes unpaid at its closing date", async () => {
    const s = await setup({ writtenCents: "10.00" });
    const j = await joined(s.testId);
    // The tester's deadline passed before sending: sent late.
    await db.contract.update({ where: { id: j.sessionId }, data: { dueAt: new Date(Date.now() - 2 * DAY) } });
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: LONG, seenAt: seen(), confirmed: true })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    expect(sub.late).toBe(true);
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - DAY) } });
    const { runDaily } = await import("@/lib/server/holds");
    await runDaily(new Date());
    expect((await subOf(sub.id)).choiceOfferedAt).toBeNull();
    expect(await db.notification.count({ where: { userId: s.dev.user.id, reminderKey: "paynow" } })).toBe(0);
    // Even a Charge opened before this rule: refused on the server.
    await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
    for (const choice of ["charge", "letgo"]) {
      const r = await sact(j.sessionId, "choose", j.tester.cookie, { submissionId: sub.id, choice, seenAt: seen(), confirmed: true });
      expect(r.status).toBe(409);
      expect(r.body.error.message).toBe("You can't charge for work sent after your deadline.");
    }
    // The developer's own Pay settles it (below the listing needs the reason).
    expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400 })).status).toBe(400);
    expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Late, and the second answer is thin." })).status).toBe(200);
  });

  it("late work left unpaid closes at its closing date (the test's close-out)", async () => {
    const s = await setup({ writtenCents: "10.00" });
    const j = await joined(s.testId);
    await db.contract.update({ where: { id: j.sessionId }, data: { dueAt: new Date(Date.now() - 2 * DAY) } });
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: LONG, seenAt: seen(), confirmed: true })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await db.contract.update({ where: { id: j.sessionId }, data: { dueAt: new Date(Date.now() - 20 * DAY) } });
    await db.test.update({ where: { id: s.testId }, data: { openUntil: new Date(Date.now() - 21 * DAY) } });
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 20 * DAY) } });
    const { closedOut, pieceCloseOut } = await import("@/lib/server/closeOut");
    expect(closedOut(await pieceCloseOut({ submissionId: sub.id }, "developer"))).toBe(true);
    const r = await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("pay_closed");
  });

  it("an update of a late piece stays late; an update before the deadline of an on-time piece stays on time", async () => {
    const w = await sent();
    expect((await subOf(w.sub.id)).late).toBe(false);
    expect((await sact(w.sessionId, "written", w.tester.cookie, { answers: LONG2, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await subOf(w.sub.id)).late).toBe(false);
    // A late piece whose deadline later moved (a pause) stays late when updated before the new deadline.
    await db.submission.update({ where: { id: w.sub.id }, data: { late: true } });
    expect((await sact(w.sessionId, "written", w.tester.cookie, { answers: LONG, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await subOf(w.sub.id)).late).toBe(true);
  });
});

// ---------- §5 ----------

describe("batch 30 §5: the team closes a developer's open reviews at $0", () => {
  async function world() {
    const a = await sent({ title: "Harbor Run" }, "Ana Silva");
    const ben = await joined(a.testId, "Ben Carter", "he");
    expect((await sact(ben.sessionId, "written", ben.tester.cookie, { answers: LONG, seenAt: seen(), confirmed: true })).status).toBe(200);
    // A second test of hers: Cid's work open, Dee's already paid.
    const b = await json(await (await import("@/app/api/tests/route")).POST(req("/api/tests", { cookie: a.dev.cookie, body: (await import("./fixtures")).listingBody({ title: "Sky Lab", productName: "Sky Lab" }) })));
    expect(b.status).toBe(200);
    await settle();
    const cid = await joined(b.body.id, "Cid Moreau", "he");
    expect((await sact(cid.sessionId, "written", cid.tester.cookie, { answers: LONG, seenAt: seen(), confirmed: true })).status).toBe(200);
    const dee = await joined(b.body.id, "Dee Park", "she");
    expect((await sact(dee.sessionId, "written", dee.tester.cookie, { answers: LONG, seenAt: seen(), confirmed: true })).status).toBe(200);
    const deeSub = await db.submission.findFirstOrThrow({ where: { contractId: dee.sessionId } });
    expect((await pay(a.dev.cookie, { kind: "submission", id: deeSub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const subs = async (sessionId: string) => db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    return { a, ben, cid, dee, testB: b.body.id as string, benSub: await subs(ben.sessionId), cidSub: await subs(cid.sessionId), deeSub };
  }

  it("the preview counts (developer-wide and one test); a short reason is refused", async () => {
    const w = await world();
    const ad = await admin();
    const all = await aact(ad.cookie, "preview-team-close", { id: w.a.dev.user.id, scope: "developer" });
    expect(all.status).toBe(200);
    expect(all.body.line).toBe("This closes 3 pieces from 3 testers on 2 tests at $0:");
    expect(all.body.lines).toHaveLength(3);
    expect(all.body.lines[0]).toMatch(/^Ana Silva's written answers on “Harbor Run” \(sent /);
    const one = await aact(ad.cookie, "preview-team-close", { id: w.a.testId, scope: "test" });
    expect(one.body.line).toBe("This closes 2 pieces from 2 testers on 1 test at $0:");
    const short = await aact(ad.cookie, "team-close", { id: w.a.dev.user.id, scope: "developer", reason: "spam", pieces: all.body.pieces });
    expect(short.status).toBe(400);
    expect(short.body.error.message).toBe(M.TEAM_CLOSE_REASON);
    // A preview isn't an admin action; nothing changed.
    expect(await db.adminAction.count({ where: { adminId: ad.user.id, action: "preview-team-close" } })).toBe(0);
    expect(await db.review.count({ where: { teamClosedById: { not: null }, contractId: { in: [w.a.sessionId, w.ben.sessionId, w.cid.sessionId] } } })).toBe(0);
  });

  it("closing settles exactly the open pieces at $0 (nothing charged); a Pay since the preview is left alone and counted; lines for everyone", async () => {
    const w = await world();
    const ad = await admin();
    const preview = await aact(ad.cookie, "preview-team-close", { id: w.a.dev.user.id, scope: "developer" });
    // The race: Ben's work is paid after the preview.
    expect((await pay(w.a.dev.cookie, { kind: "submission", id: w.benSub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const paysBefore = await db.payment.count({ where: { developerId: w.a.dev.user.id } });
    const reason = "Spam testers on a fraudulent test.";
    const r = await aact(ad.cookie, "team-close", { id: w.a.dev.user.id, scope: "developer", reason, pieces: preview.body.pieces });
    expect(r.status).toBe(200);
    expect(r.body.line).toBe("2 closed; 1 was settled meanwhile");
    for (const id of [w.a.sub.id, w.cidSub.id]) {
      const s = await subOf(id);
      expect(s.review).toMatchObject({ amountCents: 0, reason, teamClosedById: ad.user.id, rejected: false });
    }
    expect((await subOf(w.benSub.id)).review!.amountCents).toBe(1000); // left alone
    expect((await subOf(w.deeSub.id)).review!.teamClosedById).toBeNull();
    expect(await db.payment.count({ where: { developerId: w.a.dev.user.id } })).toBe(paysBefore); // nothing charged
    // Testers: a payment line; the developer: one line with the count.
    expect(await lines(w.a.tester.user.id)).toContain("“Harbor Run”: the team closed your written answers for $0");
    const n = await db.notification.findFirstOrThrow({ where: { userId: w.cid.tester.user.id, text: "“Sky Lab”: the team closed your written answers for $0" } });
    expect(n.payment).toBe(true);
    expect(n.groupKey).toBe("tpaid");
    expect(await lines(w.a.dev.user.id)).toContain("The team closed 2 open reviews on your tests for $0");
    // The history: the developer's account events, this admin's actions, the tests' timelines (third person, naming the admin).
    const ev = await db.accountEvent.findFirstOrThrow({ where: { userId: w.a.dev.user.id, kind: "team-closed" } });
    expect(ev.byId).toBe(ad.user.id);
    expect(ev.note).toBe(`2 open reviews closed for $0: ${reason}`);
    expect(await db.adminAction.count({ where: { adminId: ad.user.id, action: "team-close", targetId: w.a.dev.user.id } })).toBe(1);
    const { adminPage } = await import("@/lib/server/adminLists");
    const holds = (await adminPage("u-holds", ad.user.id, null, w.a.dev.user.id)).rows as { text: string }[];
    expect(holds.some((x) => x.text.endsWith(`Team closure by ${ad.user.email}: 2 open reviews closed for $0: ${reason}`))).toBe(true);
    const mine = (await adminPage("mine", ad.user.id, null)).rows as { why: string }[];
    expect(mine.some((x) => x.why.startsWith("2 open reviews closed by you for $0"))).toBe(true);
    const timeline = (await adminPage("t-timeline", ad.user.id, null, w.testB)).rows as { text: string }[];
    expect(timeline.some((x) => x.text.endsWith(`${ad.user.email} closed 1 open review on this test for $0: “${reason}”`))).toBe(true);
    // Charge, Pay and Pay more no longer apply; a dispute is refused with its line.
    const d = await sact(w.a.sessionId, "dispute", w.a.tester.cookie, { kind: "submission", id: w.a.sub.id, reason: "I did the whole thing, please look again.", seenAt: seen(), confirmed: true });
    expect(d.status).toBe(409);
    expect(d.body.error.message).toBe("The team closed this for $0, so it can't be disputed.");
    const p = await pay(w.a.dev.cookie, { kind: "submission", id: w.a.sub.id, amount: "10.00", tickedCents: 1000 });
    expect(p.body.error.message).toBe("The team closed this for $0.");
    const m = await more(w.a.testId, w.a.dev.cookie, { contractId: w.a.sessionId, submissionId: w.a.sub.id, amount: "5.00", tickedCents: 500 });
    expect(m.body.error.message).toBe("The team closed this for $0.");
    // And it can't be sent again.
    const up = await sact(w.a.sessionId, "written", w.a.tester.cookie, { answers: LONG2, seenAt: seen(), confirmed: true });
    expect(up.status).toBe(409);
    expect(up.body.error.message).toBe(M.TEAM_CLOSED_NO_CHANGE);
    // Closing again finds nothing open.
    expect((await aact(ad.cookie, "preview-team-close", { id: w.a.dev.user.id, scope: "developer" })).body.line).toBe("There are no open reviews to close.");
  });

  it("one test's closure leaves the developer's other tests alone; a listed call that took place is closed too (no automatic charge)", async () => {
    const w = await world();
    const ad = await admin();
    const booked = await (await import("./fixtures")).bookCall(w.a.testId, w.a.dev.cookie, w.a.sessionId, w.a.tester.cookie);
    const call = await db.call.update({ where: { id: booked.id }, data: { startsAt: new Date(Date.now() - 2 * 3_600_000), measuredMinutes: 30, measuredAt: new Date(Date.now() - 3_600_000), payBy: new Date(Date.now() + 6 * DAY) } });
    const pv = await aact(ad.cookie, "preview-team-close", { id: w.a.testId, scope: "test" });
    expect(pv.body.line).toBe("This closes 3 pieces from 2 testers on 1 test at $0:");
    const r = await aact(ad.cookie, "team-close", { id: w.a.testId, scope: "test", reason: "Abandoned account, closing it down.", pieces: pv.body.pieces });
    expect(r.body.line).toBe("3 closed");
    expect((await db.review.findFirstOrThrow({ where: { callId: call.id } })).teamClosedById).toBe(ad.user.id);
    expect((await subOf(w.cidSub.id)).review).toBeNull(); // the other test
    expect(await lines(w.a.dev.user.id)).toContain("The team closed 3 open reviews on “Harbor Run” for $0");
    // A piece from outside the scope is never touched, even if sent.
    const r2 = await aact(ad.cookie, "team-close", { id: w.a.testId, scope: "test", reason: "Trying another test's piece.", pieces: [{ kind: "submission", id: w.cidSub.id }] });
    expect(r2.body.line).toBe("0 closed; 1 was settled meanwhile");
    expect((await subOf(w.cidSub.id)).review).toBeNull();
  });

  it("the boxes: on the developer's admin box and the test's, and the tester's session page shows the team's line with Dispute disabled", () => {
    expect(src("app/admin/AccountActions.tsx")).toContain('{acct.isDeveloper && <TeamCloseBox id={acct.id} scope="developer" />}');
    expect(src("app/admin/AdminBoxes.tsx")).toContain('<TeamCloseBox id={testId} scope="test" />');
    const box = src("app/admin/TeamCloseBox.tsx");
    expect(box).toContain(`"Close all open reviews for $0"`);
    expect(box).toContain(`"Close this test's open reviews for $0"`);
    const session = src("app/app/sessions/[id]/page.tsx");
    expect(session).toContain("{teamClosedLine(review.reason)}");
    expect(session).toContain("{TEAM_CLOSED_NO_DISPUTE}");
    expect(M.teamClosedLine("Spam testers.")).toBe("The team closed this for $0: “Spam testers.”");
  });
});
