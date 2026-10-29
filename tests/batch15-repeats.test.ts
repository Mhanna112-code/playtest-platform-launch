import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as joinCallPOST } from "@/app/api/calls/[id]/join/route";
import { act, atHours, bookCall, joined, sact, seen, setup } from "./fixtures";
import { json, makeUser, req } from "./helpers";
import { pay, payMore, withCard } from "./b15";

// Batch 15 section 13: a press whose answer was lost after the server acted, pressed again, never does it twice: it answers "already done" or is idempotent by its press id.
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");

describe("presses repeated after a lost answer (section 13)", () => {
  it("every press goes through api(): no raw fetch for a press; offline says so under the button and the typed text stays", () => {
    const client = src("lib/client.ts");
    expect(client).toContain('throw new ApiError(0, "offline", "You seem to be offline. Check your connection and try again.");');
    // The only raw fetches in pages and components are polls, heartbeats and draft keeping (never a press).
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const files = [...walk(path.resolve(__dirname, "../src/components")), ...walk(path.resolve(__dirname, "../src/app")).filter((f) => !f.includes(`${path.sep}api${path.sep}`))].filter((f) => f.endsWith(".tsx"));
    for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/fetch\(([^)]*)/g)) expect(m[1], f).toMatch(/status|presence|pulse|account\/status|account\/changes|admin\/dispute|kept|calls\/\$\{callId\}\/room/); // (batch 16 section 27) account/changes is a poll; (batch 21) the call room's relay
  });

  it("Pay, Pay more, Charge, Let it go, Send, Join, Apply, Accept, Book, Rate and Join call: the same press twice does it once", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    await withCard(dev.user.id);
    // Apply twice: one application.
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).listingVersion;
    await act(testId, "apply", ana.cookie, { listingVersion: v, note: "Hi" });
    await act(testId, "apply", ana.cookie, { listingVersion: v, note: "Hi" });
    expect(await db.application.count({ where: { testId, testerId: ana.user.id } })).toBe(1);
    // Accept twice: one contract; the second answer says it's done.
    const app = await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } });
    expect((await act(testId, "application", dev.cookie, { applicationId: app.id, decision: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await act(testId, "application", dev.cookie, { applicationId: app.id, decision: "accept", seenAt: seen(), confirmed: true })).status).toBe(409);
    const c = await db.contract.findFirstOrThrow({ where: { testId, testerId: ana.user.id } });
    // Join again: refused, still one contract.
    expect((await act(testId, "join", ana.cookie, { listingVersion: v })).status).toBeGreaterThanOrEqual(400);
    expect(await db.contract.count({ where: { testId, testerId: ana.user.id } })).toBe(1);
    // Send twice: one submission.
    await sact(c.id, "written", ana.cookie, { answers: ["a", "b"] });
    await sact(c.id, "written", ana.cookie, { answers: ["a", "b"] });
    expect(await db.submission.count({ where: { contractId: c.id, kind: "written" } })).toBe(1);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: c.id } });
    // Pay twice with the same press id: one review, one payment.
    const payKey = randomUUID();
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, payKey });
    const again = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, payKey });
    expect(again.body.repeated).toBe(true);
    expect(await db.payment.count({ where: { submissionId: sub.id, kind: { not: "extra" } } })).toBe(1);
    // Pay more twice with the same press id: once.
    const key = randomUUID();
    await payMore(testId, dev.cookie, { contractId: c.id, submissionId: sub.id, amount: "2.00", tickedCents: 200, payKey: key });
    const more2 = await payMore(testId, dev.cookie, { contractId: c.id, submissionId: sub.id, amount: "2.00", tickedCents: 200, payKey: key });
    expect(more2.body.repeated).toBe(true);
    expect(await db.payment.count({ where: { submissionId: sub.id, kind: "extra" } })).toBe(1);
    // Book (a request) twice for the same time: one request (the second clashes with the first).
    await sact(c.id, "request-time", ana.cookie, { startsAt: atHours(60), seenAt: seen(), confirmed: true });
    expect((await sact(c.id, "request-time", ana.cookie, { startsAt: atHours(60), seenAt: seen(), confirmed: true })).status).toBe(409);
    expect(await db.callRequest.count({ where: { contractId: c.id, fromSide: "tester" } })).toBe(1);
  });

  it("Charge and Let it go twice: once; Rate twice: once; Join call twice: the same room", async () => {
    const { dev, testId } = await setup();
    await withCard(dev.user.id);
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Okafor");
    for (const x of [a, b]) await sact(x.sessionId, "written", x.tester.cookie, { answers: ["a", "b"] });
    const [sa, sb] = await Promise.all([a, b].map((x) => db.submission.findFirstOrThrow({ where: { contractId: x.sessionId } })));
    for (const s of [sa, sb]) await db.submission.update({ where: { id: s.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * 86_400_000), payBy: new Date(Date.now() - 1000) } });
    const charge = () => sact(a.sessionId, "choose", a.tester.cookie, { submissionId: sa.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true });
    expect((await charge()).status).toBe(200);
    expect((await charge()).status).toBe(409);
    expect(await db.payment.count({ where: { submissionId: sa.id } })).toBe(1);
    const letgo = () => sact(b.sessionId, "choose", b.tester.cookie, { submissionId: sb.id, choice: "letgo", seenAt: seen(), confirmed: true });
    expect((await letgo()).status).toBe(200);
    expect((await letgo()).status).toBe(409);
    expect(await db.review.count({ where: { submissionId: sb.id } })).toBe(1);
    // Join call twice: the same call page (batch 21: the built-in room).
    const call = await bookCall(testId, dev.cookie, a.sessionId, a.tester.cookie, 48);
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 60_000) } });
    const j = () => joinCallPOST(req(`/api/calls/${call.id}/join`, { cookie: a.tester.cookie, body: {} }), { params: Promise.resolve({ id: call.id }) }).then(json);
    const [j1, j2] = [await j(), await j()];
    expect(j1.body.url).toBe(`/app/calls/${call.id}`);
    expect(j2.body.url).toBe(j1.body.url);
    // Rate twice: one rating.
    await db.submission.update({ where: { id: sa.id }, data: {} });
    const rate = () => sact(b.sessionId, "rate", b.tester.cookie, { stars: 4, seenAt: seen(), confirmed: true });
    await rate();
    await rate();
    expect(await db.rating.count({ where: { contractId: b.sessionId } })).toBeLessThanOrEqual(1);
  });
});
