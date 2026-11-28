import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as subPOST } from "@/app/api/payments/subscription/route";
import { logAccountChange } from "@/lib/server/accountChanges";
import { TERMS_TICK_MISSING, TERMS_VERSION } from "@/lib/termsOfUse";
import { json, makeUser, req } from "./helpers";
import { act, atHours, bookCall, joined, oldChooseOne, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 27, shared rule 4, approved again) One press = one outcome, in this order inside every button: refusals (final, then soft) → the stop-once box →
// form mistakes (red at the field, nothing saved). The eleven departures of the refusal report, each with a stop-once condition present:
// a refusal case wins with no box; a red-mistake case gets the box first, then on the confirmed press the red mistake.

const later = () => new Promise((r) => setTimeout(r, 30));
type R = Awaited<ReturnType<typeof act>>;
const code = (r: R) => r.body.error?.code as string | undefined;
const show = (r: R) => JSON.stringify(r.body);
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const sub = (cookie: string, body: Record<string, unknown>) => subPOST(req("/api/payments/subscription", { cookie, body })).then(json);

/**
 * A developer stop-once condition: a payment of theirs made in another tab ("You paid … in another tab": a big own action, it stops every press once). Returns
 * the page's load time (before it) for the presses from tab-1.
 */
async function devPaidElsewhere(testId: string, devCookie: string) {
  const other = await joined(testId, "Cara Diaz", "she");
  expect((await sact(other.sessionId, "written", other.tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true })).status).toBe(200);
  const s = await db.submission.findFirstOrThrow({ where: { contractId: other.sessionId } });
  await later();
  const loaded = seen();
  await later();
  expect((await pay(devCookie, { kind: "submission", id: s.id, amount: "10.00", tickedCents: 1000, tab: "tab-2" })).status).toBe(200);
  await settle();
  return loaded;
}

/** A tester stop-once condition: their own Request a time in another tab ("You requested a call … in another tab"). */
async function testerActedElsewhere(sessionId: string, cookie: string, hours = 400) {
  await later();
  const loaded = seen();
  await later();
  expect((await sact(sessionId, "request-time", cookie, { startsAt: atHours(hours), seenAt: seen(), confirmed: true, tab: "tab-1" })).status).toBe(200);
  await settle();
  return loaded;
}

describe("rule 4: refusals come before the stop-once box", () => {
  it("1. Cancel invite: the tester joined meanwhile → “She already joined.”, never the box first", async () => {
    const { dev, testId } = await setup();
    const t = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const u = await makeUser({ tester: true, name: "Ben Ode", pronoun: "he" });
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [t.user.id, u.user.id] })).status).toBe(200);
    const inv = await db.invite.findFirstOrThrow({ where: { testId, testerId: t.user.id } });
    const invU = await db.invite.findFirstOrThrow({ where: { testId, testerId: u.user.id } });
    const loaded = await devPaidElsewhere(testId, dev.cookie);
    expect((await act(testId, "join", t.cookie, { listingVersion: 1, seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const r = await act(testId, "cancel-invite", dev.cookie, { inviteId: inv.id, seenAt: loaded, tab: "tab-1" });
    expect(r.status, show(r)).toBe(409);
    expect(r.body.error).toMatchObject({ code: "gone", message: "She already joined." });
    // The condition was there: the still-open invite's Cancel from the same page stops once.
    expect(code(await act(testId, "cancel-invite", dev.cookie, { inviteId: invU.id, seenAt: loaded, tab: "tab-1" }))).toBe("stop_once");
  });

  it("2. Accept on an application: joining closed (Open until passed) → the Accept refusal, never the box first (Decline from the same page still stops once)", async () => {
    const { dev, testId } = await setup();
    const a = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const app = await db.application.create({ data: { testId, testerId: a.user.id, listing: {} } });
    const loaded = await devPaidElsewhere(testId, dev.cookie);
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 60_000) } });
    const r = await act(testId, "application", dev.cookie, { action: "accept", applicationId: app.id, seenAt: loaded, tab: "tab-1" });
    expect(r.status, show(r)).toBe(409);
    expect(code(r), show(r)).toBe("refused");
    expect(r.body.error.message).toMatch(/Accept/);
    expect(await db.contract.count({ where: { testId, testerId: a.user.id } })).toBe(0);
    expect(code(await act(testId, "application", dev.cookie, { action: "decline", applicationId: app.id, seenAt: loaded, tab: "tab-1" }))).toBe("stop_once");
  });

  it("3. Switch / Keep: already switched in another tab → “You already switched to these terms.”, never the box first", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await act(testId, "edit", dev.cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields: { writtenCents: "12.00" }, seenAt: seen(), confirmed: true })).status).toBe(200);
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: sessionId, status: "open" } });
    await later();
    const loaded = seen();
    await later();
    // Switched in the other tab: "You switched … in another tab" is the condition.
    expect((await sact(sessionId, "terms", tester.cookie, { offerId: offer.id, choice: "switch", seenAt: seen(), confirmed: true, tab: "tab-1" })).status).toBe(200);
    await settle();
    const r = await sact(sessionId, "terms", tester.cookie, { offerId: offer.id, choice: "keep", seenAt: loaded, tab: "tab-2" });
    expect(r.status, show(r)).toBe(409);
    expect(r.body.error).toMatchObject({ code: "gone", message: "You already switched to these terms." });
    // The condition was there: another press from that page stops once.
    expect(code(await sact(sessionId, "request-time", tester.cookie, { startsAt: atHours(420), seenAt: loaded, tab: "tab-2" }))).toBe("stop_once");
  });

  it("4. Charge: a part already paid in full → “This part is already paid in full.”, never the box first", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true })).status).toBe(200);
    const s = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    // Its Charge open (7 days and the deadline passed), with nothing left to charge on it.
    await db.submission.update({ where: { id: s.id }, data: { choiceOfferedAt: new Date(), agreedCents: 0 } });
    const loaded = await testerActedElsewhere(sessionId, tester.cookie);
    const r = await sact(sessionId, "choose", tester.cookie, { submissionId: s.id, choice: "charge", amount: "5.00", seenAt: loaded, tab: "tab-2" });
    expect(r.status, show(r)).toBe(409);
    expect(r.body.error).toMatchObject({ code: "paid_in_full", message: "This part is already paid in full." });
    expect(code(await sact(sessionId, "request-time", tester.cookie, { startsAt: atHours(420), seenAt: loaded, tab: "tab-2" }))).toBe("stop_once");
  });

  it("5. Accept a call request less than the lead ahead → the too-soon refusal, never the box first", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const loaded = await testerActedElsewhere(sessionId, tester.cookie);
    // The developer's request for a time now under the lead ahead (1 minute in tests, 24 hours on the live site).
    const soon = new Date(Date.now() + 30_000).toISOString();
    const q = await oldChooseOne(sessionId, "developer", [soon]);
    const r = await sact(sessionId, "answer-request", tester.cookie, { requestId: q.id, action: "accept", seenAt: loaded, tab: "tab-2" });
    expect(r.status, show(r)).toBe(409);
    expect(code(r)).toBe("too_soon");
    expect(await db.call.count({ where: { contractId: sessionId } })).toBe(0);
    expect(code(await sact(sessionId, "request-time", tester.cookie, { startsAt: atHours(420), seenAt: loaded, tab: "tab-2" }))).toBe("stop_once");
  });

  it("5b. The developer's Accept on a request they declined in another tab: the one refusal, never a box first", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await sact(sessionId, "request-time", tester.cookie, { startsAt: atHours(60), seenAt: seen(), confirmed: true })).status).toBe(200);
    const q = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId, fromSide: "tester", status: "pending" } });
    const loaded = await devPaidElsewhere(testId, dev.cookie);
    // Declined in the developer's other tab.
    expect((await act(testId, "answer-request", dev.cookie, { contractId: sessionId, requestId: q.id, action: "decline", seenAt: seen(), confirmed: true, tab: "tab-2" })).status).toBe(200);
    await settle();
    const r = await act(testId, "answer-request", dev.cookie, { contractId: sessionId, requestId: q.id, action: "accept", seenAt: loaded, tab: "tab-1" });
    expect(r.status, show(r)).toBe(409);
    expect(code(r)).toBe("gone");
    expect(await db.call.count({ where: { contractId: sessionId } })).toBe(0);
  });

  it("6a. The tester's Request a time at a time the developer already has booked with someone else: the clash, never the box first", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId);
    const call = await bookCall(testId, dev.cookie, a.sessionId, a.tester.cookie, 60);
    const b = await joined(testId, "Ben Okafor", "he");
    const loaded = await testerActedElsewhere(b.sessionId, b.tester.cookie);
    const r = await sact(b.sessionId, "request-time", b.tester.cookie, { startsAt: call.startsAt.toISOString(), seenAt: loaded, tab: "tab-2" });
    expect(r.status, show(r)).toBe(409);
    expect(code(r)).toBe("clash");
    expect(await db.callRequest.count({ where: { contractId: b.sessionId, startsAt: call.startsAt } })).toBe(0);
  });

  it("6b. Accept a weekly set whose second week clashes: “These weeks clash: …”, never the box first", async () => {
    const a = await setup();
    const t = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const ja = await act(a.testId, "join", t.cookie, { listingVersion: 1 });
    expect(ja.status).toBe(200);
    const b = await setup();
    const jb = await act(b.testId, "join", t.cookie, { listingVersion: 1 });
    expect(jb.status).toBe(200);
    await settle();
    const first = atHours(60);
    // A call on test B exactly a week after the set's first call.
    await bookCall(b.testId, b.dev.cookie, jb.body.sessionId as string, t.cookie, 60 + 7 * 24);
    const loaded = await testerActedElsewhere(ja.body.sessionId as string, t.cookie, 30);
    const q = await oldChooseOne(ja.body.sessionId as string, "developer", [{ startsAt: first, repeat: "weekly", count: 2 }]);
    const r = await sact(ja.body.sessionId as string, "answer-request", t.cookie, { requestId: q.id, action: "accept", seenAt: loaded, tab: "tab-2" });
    expect(r.status, show(r)).toBe(409);
    expect(code(r)).toBe("clash");
    expect(r.body.error.message).toMatch(/^These weeks clash: week 2 /);
  });

  it("7. Invite: the developer's 100 invites a day (a whole-press refusal) comes before the box", async () => {
    const { dev, testId } = await setup();
    const loaded = await devPaidElsewhere(testId, dev.cookie);
    const { INVITES_PER_DAY } = await import("@/lib/server/invites");
    await db.invite.createMany({ data: Array.from({ length: INVITES_PER_DAY }, () => ({ testId, testerId: `seed-${randomUUID()}`, status: "cancelled" })) });
    const t = await makeUser({ tester: true, name: "Dee Kim", pronoun: "she" });
    const r = await act(testId, "invite", dev.cookie, { testerIds: [t.user.id], seenAt: loaded, tab: "tab-1" });
    expect(r.status, show(r)).toBe(429);
    expect(code(r)).toBe("too_many_invites");
    expect(await db.invite.count({ where: { testId, testerId: t.user.id } })).toBe(0);
  });

  it("8. Subscribe on a hold, and Cancel subscription with nothing to cancel: the refusal, never the Payments box first", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane", pronoun: "she" });
    await later();
    const loaded = seen();
    await later();
    // Changed in another tab: the Payments box would list it.
    await logAccountChange(dev.user.id, "tab-2", { scopes: ["payments"], field: "card", label: "Card", line: "Card changed" });
    await settle();
    const none = await sub(dev.cookie, { action: "cancel", seenAt: loaded, tab: "tab-1" });
    expect(none.status, show(none)).toBe(409);
    expect(none.body.error).toMatchObject({ code: "none", message: "There's no subscription to cancel." });
    const keep = await sub(dev.cookie, { action: "keep", seenAt: loaded, tab: "tab-1" });
    expect(keep.body.error).toMatchObject({ code: "none", message: "There's nothing to keep." });
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: new Date() } });
    const held = await sub(dev.cookie, { action: "subscribe", seenAt: loaded, tab: "tab-1" });
    expect(held.status, show(held)).toBe(409);
    expect(code(held)).toBe("restricted");
    // Without a refusal the same page stops once.
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: null } });
    const free = await sub(dev.cookie, { action: "subscribe", seenAt: loaded, tab: "tab-1" });
    if (code(free) !== "free") expect(code(free), show(free)).toBe("stop_once");
  });
});

describe("rule 4: red mistakes come after the stop-once box", () => {
  it("9. Report a problem with a call: a note too short → the box first, then the red note on the confirmed press (nothing reported)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const call = await bookCall(testId, dev.cookie, sessionId, tester.cookie, 60);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 5 * 60_000) } });
    const loaded = await testerActedElsewhere(sessionId, tester.cookie);
    const first = await sact(sessionId, "no-show", tester.cookie, { callId: call.id, note: "late", seenAt: loaded, tab: "tab-2" });
    expect(code(first), show(first)).toBe("stop_once");
    await later();
    const second = await sact(sessionId, "no-show", tester.cookie, { callId: call.id, note: "late", seenAt: loaded, tab: "tab-2", confirmed: true, boxAt: seen() });
    expect(second.status, show(second)).toBe(400);
    expect(second.body.error).toMatchObject({ code: "bad_note", message: "Say what happened." });
    expect((await db.call.findUniqueOrThrow({ where: { id: call.id } })).noShowBy).toBeNull();
  });

  it("10. A recording's Send with nothing uploaded → the box first, then “Upload a recording first.”", async () => {
    const { testId } = await setup({ recordingCents: "5.00" });
    const { tester, sessionId } = await joined(testId);
    const loaded = await testerActedElsewhere(sessionId, tester.cookie);
    const first = await sact(sessionId, "recording-send", tester.cookie, { seenAt: loaded, tab: "tab-2" });
    expect(code(first), show(first)).toBe("stop_once");
    await later();
    const second = await sact(sessionId, "recording-send", tester.cookie, { seenAt: loaded, tab: "tab-2", confirmed: true, boxAt: seen() });
    expect(second.status, show(second)).toBe(400);
    expect(second.body.error).toMatchObject({ code: "none", message: "Upload a recording first." });
  });

  it("11. The updated Terms of Use tick: a refusal beats it, the listing box comes before it, then it is red with nothing saved; ticked, the join goes", async () => {
    const { dev, testId } = await setup({ spots: 1 });
    const old = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she", termsVersion: TERMS_VERSION - 1 });
    // Full: the refusal, not the red tick.
    const filler = await joined(testId, "Ben Okafor", "he");
    const full = await act(testId, "join", old.cookie, { listingVersion: 1, seenAt: seen() });
    expect(full.status, show(full)).toBe(409);
    expect(code(full)).toBe("refused");
    await sact(filler.sessionId, "leave", filler.tester.cookie, { seenAt: seen(), confirmed: true });
    await settle();
    // A listing change the page hadn't shown: the box first.
    await later();
    const loaded = seen();
    await later();
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect((await act(testId, "edit", dev.cookie, { version: t.version, fields: { description: "Sail far" }, seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const listingVersion = (await db.test.findUniqueOrThrow({ where: { id: testId } })).listingVersion;
    const first = await act(testId, "join", old.cookie, { listingVersion: 1, seenAt: loaded });
    expect(code(first), show(first)).toBe("stop_once");
    await later();
    const second = await act(testId, "join", old.cookie, { listingVersion, seenAt: loaded, confirmed: true, boxAt: seen() });
    expect(second.status, show(second)).toBe(400);
    expect(second.body.error.message).toBe(TERMS_TICK_MISSING);
    expect((await db.user.findUniqueOrThrow({ where: { id: old.user.id } })).termsVersion).toBe(TERMS_VERSION - 1);
    expect(await db.contract.count({ where: { testId, testerId: old.user.id } })).toBe(0);
    await later();
    const third = await act(testId, "join", old.cookie, { listingVersion, seenAt: loaded, confirmed: true, boxAt: seen(), agreeTerms: true });
    expect(third.status, show(third)).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: old.user.id } })).termsVersion).toBe(TERMS_VERSION);
  });
});
