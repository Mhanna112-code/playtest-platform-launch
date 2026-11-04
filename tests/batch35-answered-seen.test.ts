import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as sessionPOST } from "@/app/api/sessions/[id]/[action]/route";
import { POST as testPOST } from "@/app/api/tests/[id]/[action]/route";
import { logAction, unanswered } from "@/lib/server/live";
import { devChanges, answersIt } from "@/lib/server/live";
import { testerGate } from "@/lib/server/testerGate";
import { joinStopList } from "@/lib/server/joining";
import { stopForUnanswered } from "@/lib/server/adminRace";
import { decideDispute } from "@/lib/server/payments";
import { json, makeUser, req } from "./helpers";
import { act, addTo, atHours, joined, sact, seen, settle, setup } from "./fixtures";

const pay = (cookie: string, body: Record<string, unknown>, load = "page-a") => reviewPOST(req("/api/review", { cookie, headers: { "x-tab": load, "x-load": load }, body: { payKey: randomUUID(), ...body } })).then(json);
const texts = (r: { body: { error?: { changes?: { text: string }[] } } }) => (r.body.error?.changes ?? []).map((c) => c.text);
const press = (testId: string, cookie: string, body: Record<string, unknown>, load = "page-a") => testPOST(req(`/api/tests/${testId}/request-time`, { cookie, headers: { "x-tab": load, "x-load": load }, body }), { params: Promise.resolve({ id: testId, action: "request-time" }) }).then(json);

describe("batch 35 §86: answered changes never stop a later press", () => {
  it("tester Accept then Request a call goes through with the original page time; the answer is shared across loads", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Ana Silva", "they");
    const loaded = seen(); await settle();
    expect((await act(testId, "request-time", dev.cookie, { confirmed: true, contractIds: [sessionId], startsAt: atHours(48), minutes: 30 })).status).toBe(200);
    const request = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId } });
    const accepted = await json(await sessionPOST(req(`/api/sessions/${sessionId}/answer-request`, { cookie: tester.cookie, headers: { "x-load": "load-a", "x-tab": "tab-a" }, body: { seenAt: loaded, requestId: request.id, action: "accept" } }), { params: Promise.resolve({ id: sessionId, action: "answer-request" }) }));
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: loaded, tab: "tab-a", startsAt: atHours(72), minutes: 30 })).status).toBe(200);
    // Same historical request line is seen from any load, not only the tab that answered.
    const line = { kind: "requested", item: request.id, text: "Nora Lane requested a call", createdAt: request.createdAt };
    expect(await unanswered(tester.user.id, testId, [line])).toEqual([]);
    // Another tab still stops for the tester's own actions, without resurrecting the answered request.
    await expect(testerGate(tester.user.id, sessionId, testId, { seenAt: loaded, tab: "tab-b", load: "load-b" })).rejects.toMatchObject({ code: "stop_once", data: { changes: expect.arrayContaining([expect.objectContaining({ text: expect.stringMatching(/^You accepted/) })]) } });
  });

  it("Pay sees only that piece, on this page and a different x-load; unrelated work and a later update still stop once", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva", "they"); const b = await joined(testId, "Ben Okafor", "they");
    const loaded = seen(); await settle();
    await sact(a.sessionId, "written", a.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: a.sessionId } });
    // (§155) The piece's own unseen send stops Pay once; the second press pays (and the line stays answered, §86).
    const first = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded });
    expect(texts(first)).toEqual(["Ana Silva sent their written answers"]);
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, confirmed: true, boxAt: first.body.error?.now })).status).toBe(200);
    const requestBody = { seenAt: loaded, contractIds: [b.sessionId], startsAt: atHours(48), minutes: 30 };
    expect((await press(testId, dev.cookie, requestBody)).status).toBe(200);
    // Other-load own actions stop, but the sent line never comes back.
    const other = await press(testId, dev.cookie, { ...requestBody, startsAt: atHours(72) }, "page-b");
    expect(other.body.error?.code).toBe("stop_once");
    expect(texts(other).some((t) => /sent their written answers/.test(t))).toBe(false);
    expect(texts(other)).toContainEqual(expect.stringMatching(/^You paid/));
    await sact(b.sessionId, "written", b.tester.cookie, { answers: ["a", "b"] });
    const stop = await press(testId, dev.cookie, { ...requestBody, startsAt: atHours(96) });
    expect(stop.body.error?.code).toBe("stop_once");
    expect(texts(stop)).toEqual(["Ben Okafor sent their written answers"]);
    const boxAt = seen(); await settle();
    expect((await press(testId, dev.cookie, { ...requestBody, startsAt: atHours(96), confirmed: true, boxAt })).status).toBe(200);
    await settle();
    expect((await addTo(a.sessionId, a.tester.cookie, { text: "updated", confirmed: true })).status).toBe(200); // (batch 35 §136) an addition
    const changes = await devChanges(dev.user.id, testId, new Date(loaded), "page-a", db, { press: { acts: [], keys: [] } });
    expect(changes.filter((e) => e.kind === "sent").map((e) => e.text)).toEqual(["Ben Okafor sent their written answers", expect.stringMatching(/^Ana Silva added to (her|their) answer to “/)]);
  });

  it("answering one request does not hide a second request from the same tester", async () => {
    const { dev, testId } = await setup(); const { tester, sessionId } = await joined(testId, "Ana Silva", "they");
    const loaded = seen(); await settle();
    for (const hours of [48, 72]) expect((await sact(sessionId, "request-time", tester.cookie, { confirmed: true, startsAt: atHours(hours), minutes: 30 })).status).toBe(200);
    const requests = await db.callRequest.findMany({ where: { contractId: sessionId }, orderBy: { createdAt: "asc" } });
    expect((await act(testId, "answer-request", dev.cookie, { seenAt: seen(), contractId: sessionId, requestId: requests[1].id, action: "decline" })).status).toBe(200);
    const changes = await devChanges(dev.user.id, testId, new Date(loaded), "", db, { press: { acts: [], keys: [] } });
    expect(changes.filter((e) => e.kind === "requested")).toHaveLength(1);
    expect(answersIt(changes.find((e) => e.kind === "requested")!, { item: requests[0].id })).toBe(true);
  });

  it("admin Decide answers a newly added dispute side and records the dispute id for later admin stops", async () => {
    const { dev, testId } = await setup(); const { tester, sessionId } = await joined(testId, "Ana Silva", "they");
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Only half was useful", confirmed: true })).status).toBe(200);
    const loaded = seen(); await settle();
    expect((await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered all questions fully", confirmed: true })).status).toBe(200);
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    await settle();
    expect((await act(testId, "dispute-side", dev.cookie, { disputeId: d.id, text: "They skipped half the questions" })).status).toBe(200);
    const admin = await makeUser(); const u = await db.user.update({ where: { id: admin.user.id }, data: { isAdmin: true } });
    expect(await decideDispute(u, d.id, { seenAt: loaded, total: "", load: "admin-a" })).toEqual({ extraCents: 0 });
    const side = await db.dispute.findUniqueOrThrow({ where: { id: d.id } });
    await expect(stopForUnanswered(u.id, testId, "Another press", [{ item: d.id, text: "The developer added their side", at: side.devSideAt! }])).resolves.toBeUndefined();
    await expect(stopForUnanswered(u.id, testId, "Another press", [
      { item: d.id, text: "The developer added their side", at: side.devSideAt! },
      { item: "unanswered-dispute", text: "Another side arrived", at: side.devSideAt! },
    ])).rejects.toMatchObject({ code: "stop_once", data: { changes: [expect.objectContaining({ text: "Another side arrived" })] } });
    const events = await devChanges(dev.user.id, testId, new Date(loaded), "", db, { press: { acts: [], keys: [] } });
    expect(events.some((e) => e.kind === "dispute")).toBe(false);
  });

  it.each(["switch", "keep"])("%s records the actual terms offer as seen, including from another load", async (choice) => {
    const { testId } = await setup(); const { tester, sessionId } = await joined(testId, "Ana Silva", "they");
    const offer = await db.termsOffer.create({ data: { contractId: sessionId, testId, listingVersion: 1, deadlineDays: 7, questions: ["What did you like?", "Where did you get stuck?"], writtenCents: 1200, diff: "written answers $10.00 → $12.00" } });
    expect((await sact(sessionId, "terms", tester.cookie, { choice, offerId: offer.id, seenAt: seen(), tab: "a" })).status).toBe(200);
    const line = { kind: "terms", item: offer.id, text: "Nora Lane offered new terms", createdAt: offer.createdAt };
    expect(await unanswered(tester.user.id, testId, [line])).toEqual([]);
    const newer = { ...line, createdAt: new Date(Date.now() + 1000) };
    expect(await unanswered(tester.user.id, testId, [newer])).toEqual([newer]);
    const other = await makeUser({ tester: true });
    expect(await unanswered(other.user.id, testId, [line])).toEqual([line]);
  });

  it.each(["accept", "decline"])("%s of an application stays seen for later developer presses", async (action) => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const tester = await makeUser({ tester: true, name: "Ana Silva", pronoun: "they" });
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const loaded = seen(); await settle();
    expect((await act(testId, "apply", tester.cookie, { listingVersion: t.listingVersion, confirmed: true })).status).toBe(200);
    const app = await db.application.findFirstOrThrow({ where: { testId, testerId: tester.user.id } });
    expect((await act(testId, "application", dev.cookie, { applicationId: app.id, action, confirmed: true })).status).toBe(200);
    expect((await devChanges(dev.user.id, testId, new Date(loaded), "", db, { press: { acts: [], keys: [] } })).filter((e) => e.kind === "applied")).toEqual([]);
    // The application id may be reused for a later ask: the later timestamp is still unseen.
    const later = await db.testEvent.create({ data: { testId, kind: "applied", link: `item-app-${app.id}`, text: "Ana Silva asks to rejoin", createdAt: new Date(Date.now() + 1000) } });
    const changes = await devChanges(dev.user.id, testId, new Date(loaded), "", db, { press: { acts: [], keys: [] } });
    expect(changes.filter((e) => e.kind === "applied").map((e) => e.text)).toEqual([later.text]);
  });

  it("Join from an invite records that exact invite for later Join gates on other devices", async () => {
    const { dev, testId } = await setup({ joinMode: "invite" });
    const tester = await makeUser({ tester: true, pronoun: "they" });
    expect((await act(testId, "invite", dev.cookie, { testerIds: [tester.user.id], confirmed: true })).status).toBe(200);
    const invite = await db.invite.findFirstOrThrow({ where: { testId, testerId: tester.user.id } });
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect((await act(testId, "join", tester.cookie, { inviteId: invite.id, listingVersion: t.listingVersion, confirmed: true, tab: "a" })).status).toBe(200);
    const line = { kind: "invite", item: invite.id, text: "Here is a new invite", createdAt: invite.createdAt };
    expect(await unanswered(tester.user.id, testId, [line])).toEqual([]);
    // The join page builds this line from replaced invites; retain that history after Join.
    await db.invite.create({ data: { testId, testerId: tester.user.id, status: "replaced", updatedAt: new Date() } });
    await db.invite.update({ where: { id: invite.id }, data: { status: "sent" } });
    expect(await joinStopList(tester.user.id, testId, { seenAt: new Date(invite.createdAt.getTime() - 1).toISOString(), tab: "a", load: "b" }, "join")).toBeNull();
  });
  it.each(["accept", "decline"])("%s of a rejoin ask records that ask for later presses", async (action) => {
    const { dev, testId } = await setup(); const { tester, sessionId } = await joined(testId, "Ana Silva", "they");
    expect((await sact(sessionId, "leave", tester.cookie, { confirmed: true })).status).toBe(200);
    const loaded = seen(); await settle();
    expect((await act(testId, "rejoin-ask", tester.cookie, { confirmed: true })).status).toBe(200);
    const app = await db.application.findFirstOrThrow({ where: { testId, testerId: tester.user.id } });
    expect((await act(testId, "application", dev.cookie, { applicationId: app.id, action, confirmed: true })).status).toBe(200);
    expect((await devChanges(dev.user.id, testId, new Date(loaded), "", db, { press: { acts: [], keys: [] } })).filter((e) => e.kind === "applied")).toEqual([]);
  });

  it("Pay more on a piece added to after a Pay stops once for the addition (§155), then pays and keeps it answered", async () => {
    const { dev, testId } = await setup(); const { tester, sessionId } = await joined(testId, "Ana Silva", "they");
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, confirmed: true })).status).toBe(200);
    const loaded = seen(); await settle();
    expect((await addTo(sessionId, tester.cookie, { text: "changed", confirmed: true })).status).toBe(200);
    const more = { contractId: sessionId, submissionId: sub.id, amount: "1.00", tickedCents: 100, seenAt: loaded, tab: "page-a" };
    const first = await act(testId, "pay-extra", dev.cookie, more);
    expect(first.body.error?.code).toBe("stop_once");
    expect(texts(first)).toEqual([expect.stringMatching(/^Ana Silva added to their answer to “/)]);
    expect((await act(testId, "pay-extra", dev.cookie, { ...more, confirmed: true, boxAt: first.body.error.now })).status).toBe(200);
    expect((await devChanges(dev.user.id, testId, new Date(loaded), "page-a", db, { press: { acts: [], keys: [] } })).filter((e) => e.kind === "sent")).toEqual([]);
  });

  it.each(["needs_action", "needs_confirmation"])("Confirm with your bank (%s) marks the piece seen on another load", async (status) => {
    const { dev, testId } = await setup(); const { tester, sessionId } = await joined(testId, "Ana Silva", "they");
    const loaded = seen(); await settle();
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await db.review.create({ data: { contractId: sessionId, submissionId: sub.id, amountCents: 1000, agreedCents: 1000, payKey: randomUUID() } });
    const payment = await db.payment.create({ data: { kind: "review", contractId: sessionId, submissionId: sub.id, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status, actionPi: "pi_test", actionBy: new Date(Date.now() + 60000) } });
    const r = await json(await confirmPOST(req("/api/payments/confirm", { cookie: dev.cookie, headers: { "x-tab": "a", "x-load": "load-a" }, body: { paymentId: payment.id, simulate: "succeeded" } })));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await devChanges(dev.user.id, testId, new Date(loaded), "b", db, { press: { acts: [], keys: [] } })).filter((e) => e.kind === "sent")).toEqual([]);
  });

  it("tester Rate also drops an answered request while unrelated payments still stop it once", async () => {
    const { dev, testId } = await setup(); const { tester, sessionId } = await joined(testId, "Ana Silva", "they");
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, confirmed: true })).status).toBe(200);
    const loaded = seen(); await settle();
    expect((await act(testId, "request-time", dev.cookie, { confirmed: true, contractIds: [sessionId], startsAt: atHours(48), minutes: 30 })).status).toBe(200);
    const request = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await sact(sessionId, "answer-request", tester.cookie, { seenAt: loaded, requestId: request.id, action: "decline" })).status).toBe(200);
    expect((await act(testId, "pay-extra", dev.cookie, { contractId: sessionId, submissionId: sub.id, amount: "1.00", tickedCents: 100, confirmed: true })).status).toBe(200);
    const stop = await sact(sessionId, "rate", tester.cookie, { stars: 5, seenAt: loaded, pageSeenAt: loaded });
    expect(stop.body.error?.code).toBe("stop_once");
    expect(texts(stop)).toEqual([expect.stringMatching(/^Nora Lane paid you/)]);
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 5, seenAt: loaded, pageSeenAt: loaded, confirmed: true, boxAt: seen() })).status).toBe(200);
  });

  it("existing developer ActionLog item keys count too, including older sent lines without an id", async () => {
    const { dev, testId } = await setup(); const { tester, sessionId } = await joined(testId, "Ana Silva", "they");
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const line = { kind: "sent", contractId: sessionId, text: "Ana Silva sent their written answers", createdAt: sub.sentAt };
    await settle();
    await logAction(dev.user.id, testId, {}, "paid Ana Silva $10.00 for the written answers", { a: "pay", k: [`sub:${sub.id}`, `c:${sessionId}`] });
    expect(await unanswered(dev.user.id, testId, [line])).toEqual([]);
    const unrelated = { ...line, text: "Ana Silva sent their recording" };
    expect(await unanswered(dev.user.id, testId, [unrelated])).toEqual([unrelated]);
  });

});
