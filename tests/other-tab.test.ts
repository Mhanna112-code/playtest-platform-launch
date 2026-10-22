import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { DEV_EXEMPT_KINDS, DEV_STOP_KINDS } from "@/lib/rules";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { POST as invitePOST } from "@/app/api/invites/[id]/route";
import { GET as liveGET } from "@/app/api/live/route";
import { json, makeUser, req } from "./helpers";
import { act, atHours, joined, sact, seen, setup } from "./fixtures";

// (Owner, Oct 22, NEWEST+3) Every button stops once, including for your own actions in another tab.

const later = () => new Promise((r) => setTimeout(r, 5));
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const texts = (r: { body: { error: { changes: { text: string }[] } } }) => r.body.error.changes.map((c) => c.text);
const live = (cookie: string, scope: string, since: string, tab = "") =>
  liveGET(req(`/api/live?scope=${encodeURIComponent(scope)}&since=${encodeURIComponent(since)}`, { cookie, headers: tab ? { "x-tab": tab } : {} })).then(json);

describe("reason E: your own actions in another tab", () => {
  it("tester: written answers sent in tab 1 stop Leave once in tab 2; the same tab never stops for itself", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const pageLoaded = seen();
    await later();
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: pageLoaded, tab: "tab-1" })).status).toBe(200);
    // Tab 1 itself: not stopped by its own press.
    const own = await sact(sessionId, "request-time", tester.cookie, { startsAt: atHours(50), seenAt: pageLoaded, tab: "tab-1" });
    expect(own.status).toBe(200);
    // Tab 2: Leave stops once listing both, then goes through.
    const r = await sact(sessionId, "leave", tester.cookie, { seenAt: pageLoaded, tab: "tab-2" });
    expect(r.body.error.code).toBe("stop_once");
    expect(texts(r)).toEqual(["You also did this in another tab: sent your written answers", "You also did this in another tab: sent a call request"]);
    expect((await sact(sessionId, "leave", tester.cookie, { seenAt: pageLoaded, tab: "tab-2", confirmed: true })).status).toBe(200);
  });

  it("developer: a payment made in another tab stops Stop once with the developer's own words", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const pageLoaded = seen();
    await later();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, tab: "tab-2" });
    const r = await act(testId, "stop", dev.cookie, { seenAt: pageLoaded, tab: "tab-1" });
    expect(texts(r)).toEqual(["You also did this in another tab: paid Ana Silva $10.00 for the written answers"]);
    // The tab that paid is never stopped by it.
    expect((await act(testId, "next-round", dev.cookie, { seenAt: pageLoaded, tab: "tab-2" })).body.error?.code).not.toBe("stop_once");
  });

  it("join page: Withdraw application and No thanks stop once for your own other-tab actions and listing changes", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const t = await makeUser({ tester: true, name: "Dee Moss" });
    const pageLoaded = seen();
    await later();
    expect((await act(testId, "apply", t.cookie, { seenAt: pageLoaded, tab: "tab-1", note: "hi" })).status).toBe(200);
    const w = await act(testId, "withdraw-application", t.cookie, { seenAt: pageLoaded, tab: "tab-2" });
    expect(texts(w)).toEqual(["You also did this in another tab: applied to join this test"]);
    expect((await act(testId, "withdraw-application", t.cookie, { seenAt: pageLoaded, tab: "tab-2", confirmed: true })).status).toBe(200);
    // No thanks on an invite, after the developer changed the description (F).
    const cara = await makeUser({ tester: true, name: "Cara Diaz" });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [cara.user.id] });
    const inv = await db.invite.findFirstOrThrow({ where: { testId, testerId: cara.user.id } });
    const opened = seen();
    await later();
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { description: "Sail faster" } })).status).toBe(200);
    const nt = await invitePOST(req(`/api/invites/${inv.id}`, { cookie: cara.cookie, body: { seenAt: opened } }), { params: Promise.resolve({ id: inv.id }) }).then(json);
    expect(texts(nt)).toEqual(["Nora Lane changed the description"]);
    expect((await invitePOST(req(`/api/invites/${inv.id}`, { cookie: cara.cookie, body: { seenAt: opened, confirmed: true } }), { params: Promise.resolve({ id: inv.id }) }).then(json)).status).toBe(200);
  });
});

describe("Block goes through the gate; reason C wording", () => {
  it("tester: Block stops once after the developer paid; the second press blocks", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const pageLoaded = seen();
    await later();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    const b = await blocksPOST(req("/api/blocks", { cookie: tester.cookie, body: { userId: dev.user.id, sessionId, seenAt: pageLoaded } })).then(json);
    expect(texts(b)).toEqual(["Nora Lane paid $10.00 for your written answers"]);
    expect(await db.block.count({ where: { blockerId: tester.user.id } })).toBe(0);
    expect((await blocksPOST(req("/api/blocks", { cookie: tester.cookie, body: { userId: dev.user.id, sessionId, seenAt: pageLoaded, confirmed: true } })).then(json)).status).toBe(200);
    expect(await db.block.count({ where: { blockerId: tester.user.id } })).toBe(1);
  });

  it("the developer accepting the tester's request stops the tester once; a taken request never names the other tester", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId);
    const b = await joined(testId, "Ben Carter", "he");
    expect((await sact(a.sessionId, "request-time", a.tester.cookie, { startsAt: atHours(30), seenAt: seen(), confirmed: true })).status).toBe(200);
    const pageLoaded = seen();
    await later();
    const mine = await db.callRequest.findFirstOrThrow({ where: { contractId: a.sessionId, fromSide: "tester" } });
    expect((await act(testId, "answer-request", dev.cookie, { contractId: a.sessionId, requestId: mine.id, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    const r = await sact(a.sessionId, "leave", a.tester.cookie, { seenAt: pageLoaded });
    expect(texts(r)[0]).toMatch(/^Nora Lane accepted your call request: /);
    // A developer request to both; Ana takes it; Ben's page stops with the neutral line.
    await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [a.sessionId, b.sessionId], startsAt: atHours(80) });
    const benLoaded = seen();
    await later();
    const ra = await db.callRequest.findFirstOrThrow({ where: { contractId: a.sessionId, fromSide: "developer", status: "pending" } });
    expect((await sact(a.sessionId, "answer-request", a.tester.cookie, { requestId: ra.id, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    const s = await sact(b.sessionId, "leave", b.tester.cookie, { seenAt: benLoaded });
    expect(texts(s)).toHaveLength(1);
    expect(texts(s)[0]).toMatch(/^The call time .+ is no longer available: another tester took it$/);
    expect(JSON.stringify(s.body)).not.toContain("Ana");
  });

  it("the old Offer-times (callSlot) checks are gone from the stop logic", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../src/lib/server/testerGate.ts"), "utf8");
    expect(src).not.toMatch(/callSlot|allowedTesterIds/);
  });
});

describe("the live top notice and the seen marker", () => {
  it("lists every change since the page opened; a press sent with the notice's 'now' doesn't stop again", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const pageLoaded = seen();
    await later();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    const l = await live(tester.cookie, `session:${sessionId}`, pageLoaded);
    expect(l.body.changes.map((c: { text: string }) => c.text)).toEqual(["Nora Lane paid $10.00 for your written answers"]);
    expect((await sact(sessionId, "leave", tester.cookie, { seenAt: l.body.now })).status).toBe(200);
  });

  it("other people never read your page's notice", async () => {
    const { testId } = await setup();
    const { sessionId } = await joined(testId);
    const stranger = await makeUser({ tester: true, name: "Eve Ray" });
    expect((await live(stranger.cookie, `session:${sessionId}`, seen())).status).toBe(404);
    expect((await live(stranger.cookie, `test:${testId}`, seen())).status).toBe(404);
  });
});

describe("(F) listing info", () => {
  it("a description change stops the tester's buttons and the join page once, and shows in their top notice", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const outsider = await makeUser({ tester: true, name: "Cara Diaz" });
    const pageLoaded = seen();
    await later();
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { description: "New words" }, seenAt: seen() })).status).toBe(200);
    const r = await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: pageLoaded });
    expect(texts(r)).toEqual(["Nora Lane changed the description"]);
    const l = await live(tester.cookie, `session:${sessionId}`, pageLoaded);
    expect(l.body.changes).toEqual([expect.objectContaining({ text: "Nora Lane changed the description", kind: "info" })]);
    const j = await act(testId, "join", outsider.cookie, { seenAt: pageLoaded });
    expect(texts(j)).toEqual(["Nora Lane changed the description"]);
  });

  it("Edit's Save stops once for every developer reason: an edit saved in another tab, a tester joining", async () => {
    const { dev, testId } = await setup();
    const editOpened = seen();
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    await later();
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { description: "Tab 2 words" }, seenAt: editOpened, tab: "tab-2" })).status).toBe(200);
    await joined(testId);
    const r = await act(testId, "edit", dev.cookie, { version: v, fields: { writtenCents: "12.00" }, seenAt: editOpened, tab: "tab-1" });
    expect(r.body.error.code).toBe("changed");
    expect(texts(r)).toEqual(["Nora Lane changed the description", "Ana Silva joined"]);
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { writtenCents: "12.00" }, seenAt: editOpened, tab: "tab-1", confirmed: true })).status).toBe(200);
  });
});

describe("the developer's reason set is complete", () => {
  it("every event kind the app records either stops the developer or is exempt with a reason", () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const kinds = new Set<string>();
    for (const f of walk(path.resolve(__dirname, "../src")).filter((f) => f.endsWith(".ts"))) {
      const src = fs.readFileSync(f, "utf8");
      // recordEvent(tx, testId, <kind>, ...) and logEvent(testId, <kind>, ...) and testEvent.create({ data: { kind: "..." } })
      for (const m of src.matchAll(/recordEvent\(tx, [^,]+, ([^`]*?)(?:`|"[A-Z])/g)) for (const k of m[1].matchAll(/"([a-z_]+)"\s*[,:]/g)) kinds.add(k[1]);
      for (const m of src.matchAll(/logEvent\([^,]+, "([a-z_]+)"/g)) kinds.add(m[1]);
      for (const m of src.matchAll(/testEvent\.create\(\{ data: \{ testId, kind: "([a-z_]+)"/g)) kinds.add(m[1]);
    }
    expect(kinds.size).toBeGreaterThan(20);
    const stops = new Set<string>(DEV_STOP_KINDS);
    for (const k of kinds) {
      const exempt = DEV_EXEMPT_KINDS[k];
      expect(stops.has(k) || (exempt && exempt.length > 10), `event kind "${k}" neither stops the developer nor is exempt with a reason`).toBe(true);
      expect(stops.has(k) && !!exempt, `event kind "${k}" is both`).toBe(false);
    }
  });
});
