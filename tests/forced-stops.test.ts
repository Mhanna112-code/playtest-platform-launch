import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { decideDispute } from "@/lib/server/payments";
import { setStripeForTests } from "@/lib/server/stripe";
import { optionalAlerts, testerCanTurnOff, type Change } from "@/components/ChangesBox";
import { json, makeUser, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 3, §160) "With forced stops that ignore alerts, don't show the turn-me-off in Alerts": the server marks each stop line no Alerts tick could switch off
// (`forced`), and the box offers "Don't stop me for: …" (developer) or "Turn off alerts" (tester) only for the lines that could be switched off.

afterEach(() => setStripeForTests(null));
const DAY = 86_400_000;
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), ...body } })).then(json);
const paying = () => setStripeForTests({ paymentIntents: { create: async () => ({ id: "pi_" + randomUUID(), status: "succeeded" }) }, transfers: { create: async () => ({ id: "tr_" + randomUUID() }) } } as unknown as Stripe);
const at = new Date().toISOString();

describe("§160 the box: no turn-off for forced lines", () => {
  it("developer: a box of forced lines offers no Alerts type; a mixed box offers only the optional line's type", () => {
    const forced: Change[] = [{ text: "The team decided Ana Silva's dispute: …", at, alert: "admin", forced: true }, { text: "You paid Ben Okafor $10.00 in another tab", at }];
    expect(optionalAlerts(forced)).toEqual([]);
    const mixed: Change[] = [...forced, { text: "Ben Okafor left the test", at, alert: "leaving" }];
    expect(optionalAlerts(mixed)).toEqual(["leaving"]);
  });

  it("tester: “Turn off alerts” only when a line could be switched off", () => {
    expect(testerCanTurnOff([{ text: "Nora Lane paid $10.00 for your written answers", at, forced: true }, { text: "Nora Lane stopped this test at 3:10 PM.", at, kind: "stop" }])).toBe(false);
    expect(testerCanTurnOff([{ text: "Nora Lane paid $10.00 for your written answers", at, forced: true }, { text: "Nora Lane requested a call for …", at }])).toBe(true);
  });
});

describe("§160 the server marks the forced lines", () => {
  it("Pay: the team's decision about the same tester is forced; another tester leaving (an Alerts type) is not", async () => {
    const s = await setup({ recordingCents: "10.00" });
    const ana = await joined(s.testId, "Ana Silva");
    const ben = await joined(s.testId, "Ben Okafor", "he");
    await sact(ana.sessionId, "written", ana.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const anaSub = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId } });
    const rec = await db.submission.create({ data: { contractId: ana.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
    paying();
    expect((await pay(s.dev.cookie, { kind: "submission", id: anaSub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await sact(ana.sessionId, "dispute", ana.tester.cookie, { kind: "submission", id: anaSub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true })).status).toBe(200);
    await db.test.update({ where: { id: s.testId }, data: { ignoredAlerts: ["admin"] } });
    const a = await makeUser({ name: "Admin" });
    const admin = await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    await settle();
    const loaded = seen(); await settle();
    await decideDispute(admin, (await db.dispute.findFirstOrThrow({ where: { submissionId: anaSub.id } })).id, { total: "4.00", tickCents: 0 });
    expect((await sact(ben.sessionId, "leave", ben.tester.cookie, { confirmed: true })).status).toBe(200);
    await settle();
    const r = await pay(s.dev.cookie, { kind: "submission", id: rec.id, amount: "10.00", tickedCents: 1000, seenAt: loaded });
    expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
    const lines = r.body.error.changes as Change[];
    const decision = lines.find((c) => c.text.startsWith("The team decided"))!;
    const left = lines.find((c) => c.text === "Ben Okafor left the test")!;
    expect([decision.alert, decision.forced]).toEqual(["admin", true]);
    expect([left.alert, left.forced]).toEqual(["leaving", undefined]);
    expect(optionalAlerts(lines)).toEqual(["leaving"]);
  });

  it("Charge with Alerts Off: the team's decision on her dispute is forced (no “Turn off alerts”)", async () => {
    const s = await setup({ recordingCents: "10.00" });
    const ana = await joined(s.testId, "Ana Silva");
    await sact(ana.sessionId, "written", ana.tester.cookie, { answers: ["a", "b"] });
    const open = { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY), payBy: new Date(Date.now() - DAY) };
    const written = await db.submission.update({ where: { id: (await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId } })).id }, data: open });
    const rec = await db.submission.create({ data: { contractId: ana.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date(), devMarks: [] } });
    await db.user.update({ where: { id: ana.tester.user.id }, data: { testerAlertsOff: true } });
    paying();
    expect((await pay(s.dev.cookie, { kind: "submission", id: rec.id, amount: "4.00", tickedCents: 400, reason: "Half of it was silent", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await sact(ana.sessionId, "dispute", ana.tester.cookie, { kind: "submission", id: rec.id, reason: "I recorded the whole session", seenAt: seen(), confirmed: true })).status).toBe(200);
    const a = await makeUser({ name: "Admin" });
    const admin = await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    await settle();
    const loaded = seen(); await settle();
    await decideDispute(admin, (await db.dispute.findFirstOrThrow({ where: { submissionId: rec.id } })).id, { total: "4.00", tickCents: 0 });
    await settle();
    const r = await sact(ana.sessionId, "choose", ana.tester.cookie, { submissionId: written.id, choice: "letgo", seenAt: loaded, loadedAt: loaded });
    expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
    const lines = r.body.error.changes as Change[];
    expect(lines.every((c) => c.forced)).toBe(true);
    expect(testerCanTurnOff(lines)).toBe(false);
  });
});
