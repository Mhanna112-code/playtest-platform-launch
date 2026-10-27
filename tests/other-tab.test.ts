import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { setStripeForTests } from "@/lib/server/stripe";
import { db } from "@/lib/db";
import { DEV_EXEMPT_KINDS, DEV_STOP_KINDS, TESTER_EVENT_KINDS, TESTER_EXEMPT_KINDS } from "@/lib/rules";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { POST as invitePOST } from "@/app/api/invites/[id]/route";
import { GET as liveGET } from "@/app/api/live/route";
import { json, makeUser, req } from "./helpers";
import { act, atHours, joined, sact, seen, setup } from "./fixtures";

// (Owner, Oct 22, NEWEST+3) Every button stops once, including for your own actions in another tab.

const later = () => new Promise((r) => setTimeout(r, 30));
afterEach(() => setStripeForTests(null));
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const texts = (r: { body: { error: { changes: { text: string }[] } } }) => r.body.error.changes.map((c) => c.text);
// The database clock can run a few ms ahead of the test process on Windows: the live route only lists changes up to its own "now", so wait a beat first.
const live = (cookie: string, scope: string, since: string, tab = "") =>
  later().then(() => liveGET(req(`/api/live?scope=${encodeURIComponent(scope)}&since=${encodeURIComponent(since)}`, { cookie, headers: tab ? { "x-tab": tab } : {} }))).then(json);

describe("reason E: your own actions in another tab", () => {
  it("tester: written answers sent in tab 1 stop Leave once in tab 2; the same tab never stops for itself", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await later(); // the database clock can run a few ms ahead of this process: let the last write settle first
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
    await later(); // the database clock can run a few ms ahead of this process: let the last write settle first
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
    await later(); // the database clock can run a few ms ahead of this process: let the last write settle first
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
    // The edit re-sent the invite (NEWEST+4): the old one is refused; No thanks on the new one stops once for the change.
    const old = await invitePOST(req(`/api/invites/${inv.id}`, { cookie: cara.cookie, body: { seenAt: opened } }), { params: Promise.resolve({ id: inv.id }) }).then(json);
    expect(old.body.error.message).toMatch(/^Nora Lane changed the listing at .+ and sent you a new invite: /);
    const inv2 = await db.invite.findFirstOrThrow({ where: { testId, testerId: cara.user.id, status: "sent" } });
    const nt = await invitePOST(req(`/api/invites/${inv2.id}`, { cookie: cara.cookie, body: { seenAt: opened } }), { params: Promise.resolve({ id: inv2.id }) }).then(json);
    expect(texts(nt)).toEqual(["Nora Lane changed the description", "Nora Lane changed the listing: here's a new invite on the updated listing"]);
    expect((await invitePOST(req(`/api/invites/${inv2.id}`, { cookie: cara.cookie, body: { seenAt: opened, confirmed: true } }), { params: Promise.resolve({ id: inv2.id }) }).then(json)).status).toBe(200);
  });
});

describe("Block has one stop: already blocked in another tab (owner, Oct 27)", () => {
  it("Block goes through without the page gate; a second press (another tab) fails with a blue notice", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    await later(); // the database clock can run a few ms ahead of this process: let the last write settle first
    const pageLoaded = seen();
    await later();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    // A change since the page loaded does NOT stop Block (no other stop-once reasons).
    expect((await blocksPOST(req("/api/blocks", { cookie: tester.cookie, body: { userId: dev.user.id, seenAt: pageLoaded } })).then(json)).status).toBe(200);
    expect(await db.block.count({ where: { blockerId: tester.user.id } })).toBe(1);
    const again = await blocksPOST(req("/api/blocks", { cookie: tester.cookie, body: { userId: dev.user.id } })).then(json);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe("You already blocked Nora Lane.");
  });

  it("the developer accepting the tester's request stops the tester once; a taken request never names the other tester", async () => {
    const { dev, testId } = await setup();
    const a = await joined(testId);
    const b = await joined(testId, "Ben Carter", "he");
    expect((await sact(a.sessionId, "request-time", a.tester.cookie, { startsAt: atHours(30), seenAt: seen(), confirmed: true })).status).toBe(200);
    await later(); // the database clock can run a few ms ahead of this process: let the last write settle first
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
    await later(); // the database clock can run a few ms ahead of this process: let the last write settle first
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
    await later(); // the database clock can run a few ms ahead of this process: let the last write settle first
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
    expect(r.body.error.listingEdited).toBe(true); // the "fields you didn't touch keep the newer values" tail
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { writtenCents: "12.00" }, seenAt: editOpened, tab: "tab-1", confirmed: true })).status).toBe(200);
  });
});

describe("Pay after a tester left (owner bug report)", () => {
  it("a tester leaves; Pay with the page's old seenAt stops once with the line; the second press pays", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Dev Tester");
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await later(); // the database clock can run a few ms ahead of this process: let the last write settle first
    const pageLoaded = seen();
    await later();
    expect((await sact(sessionId, "leave", tester.cookie, {})).status).toBe(200);
    const body = { payKey: randomUUID(), kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: pageLoaded };
    const first = await reviewPOST(req("/api/review", { cookie: dev.cookie, body })).then(json);
    expect(first.body.error.code).toBe("stop_once");
    expect(texts(first)).toEqual(["Dev Tester left the test"]);
    expect((await live(dev.cookie, `test:${testId}`, pageLoaded)).body.changes.map((c: { text: string }) => c.text)).toEqual(["Dev Tester left the test"]);
    const second = await reviewPOST(req("/api/review", { cookie: dev.cookie, body: { ...body, confirmed: true } })).then(json);
    expect(second.status).toBe(200);
  });
});

describe("Reject: a missing reason is red before the stop-once", () => {
  it("reason checked first (400 at the field); with a reason, the stop-once; then it rejects", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await later(); // the database clock can run a few ms ahead of this process: let the last write settle first
    const pageLoaded = seen();
    await later();
    await joined(testId, "Ben Carter", "he"); // a stop-once reason
    const base = { payKey: randomUUID(), action: "reject", kind: "submission", id: sub.id, seenAt: pageLoaded };
    const r1 = await reviewPOST(req("/api/review", { cookie: dev.cookie, body: { ...base, reason: "" } })).then(json);
    expect(r1).toMatchObject({ status: 400, body: { error: { code: "bad_reason" } } });
    const r2 = await reviewPOST(req("/api/review", { cookie: dev.cookie, body: { ...base, reason: "Missing answers" } })).then(json);
    expect(r2.body.error.code).toBe("stop_once");
    expect((await reviewPOST(req("/api/review", { cookie: dev.cookie, body: { ...base, reason: "Missing answers", confirmed: true } }))).status).toBe(200);
  });
});

describe("Edit Save's tail", () => {
  it("a stop for a tester's action only (no listing edit elsewhere) uses the plain tail", async () => {
    const { dev, testId } = await setup();
    const editOpened = seen();
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    await later();
    await joined(testId);
    const r = await act(testId, "edit", dev.cookie, { version: v, fields: { writtenCents: "12.00" }, seenAt: editOpened, tab: "tab-1" });
    expect(r.body.error.code).toBe("changed");
    expect(r.body.error.listingEdited).toBe(false);
    expect(r.body.error.message).toBe("Press Save again to save.");
  });
});

describe("both sides' reason sets are complete", () => {
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
    for (const [side, stopKinds, exemptKinds] of [["developer", DEV_STOP_KINDS, DEV_EXEMPT_KINDS], ["tester", TESTER_EVENT_KINDS, TESTER_EXEMPT_KINDS]] as const) {
      const stops = new Set<string>(stopKinds);
      for (const k of kinds) {
        const exempt = (exemptKinds as Record<string, string>)[k];
        expect(stops.has(k) || (!!exempt && exempt.length > 10), `event kind "${k}" neither reaches the ${side} nor is exempt with a reason`).toBe(true);
        expect(stops.has(k) && !!exempt, `event kind "${k}" is both for the ${side}`).toBe(false);
      }
    }
  });
});

describe("payments and disputes, only for this test", () => {
  const fail = (contractId: string, devId: string, testerId: string, submissionId: string, extra: Record<string, unknown> = {}) =>
    db.payment.create({ data: { kind: "review", contractId, submissionId, developerId: devId, testerId, amountCents: 800, feeCents: 160, testerCents: 640, status: "failed", owedUntil: new Date(Date.now() + 3 * 86_400_000), ...extra } });

  it("a payment failure on test A shows and stops on test B and B's Edit page, naming A; a success on A doesn't", async () => {
    const { dev, testId: A } = await setup();
    const ana = await joined(A);
    const { POST: postTest } = await import("@/app/api/tests/route");
    const r = await json(await postTest(req("/api/tests", { cookie: dev.cookie, body: { productName: "Night Ferry", title: "Night Ferry", description: "x", buildUrl: "https://example.com/o", categories: ["Game"], devices: [], languages: [], spots: 3, writtenCents: "8.00", recordingCents: null, liveRateCents: null, liveMinutes: null, deadlineDays: 7, questions: ["Q?"], openUntil: "" } })));
    const B = r.body.id as string;
    const ben = await joined(B, "Ben Carter", "he");
    await sact(ana.sessionId, "written", ana.tester.cookie, { answers: ["a", "b"] });
    await later(); // the database clock can run a few ms ahead of this process: let the last write settle first
    const pageLoaded = seen();
    await later();
    // A success on A: nothing on B.
    const subA = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId } });
    await pay(dev.cookie, { kind: "submission", id: subA.id, amount: "10.00", tickedCents: 1000 });
    expect((await live(dev.cookie, `test:${B}`, pageLoaded)).body.changes).toEqual([]);
    // A failure on A (owed): shows and stops on B (test page and Edit's Save), naming Harbor Run.
    await fail(ana.sessionId, dev.user.id, ana.tester.user.id, subA.id);
    const line = expect.stringMatching(/^Payment failed on Harbor Run: \$8\.00 to Ana Silva for the written answers · we'll retry tomorrow · pay by .+ to avoid a pause$/);
    expect((await live(dev.cookie, `test:${B}`, pageLoaded)).body.changes.map((c: { text: string }) => c.text)).toEqual([line]);
    expect(texts(await act(B, "stop", dev.cookie, { seenAt: pageLoaded }))).toEqual([line]);
    const v = (await db.test.findUniqueOrThrow({ where: { id: B } })).version;
    const e = await act(B, "edit", dev.cookie, { version: v, fields: { description: "y" }, seenAt: pageLoaded });
    expect(e.body.error.code).toBe("changed");
    expect(texts(e)).toEqual([line]);
    // Ben (another tester) never reads Ana's payment.
    expect((await live(ben.tester.cookie, `session:${ben.sessionId}`, pageLoaded)).body.changes).toEqual([]);
  });

  it("a declined Pay becomes owed: the alert shows on another test; the tester reads 'delayed' (bell, top box, stop once), then 'paid' once", async () => {
    const { dev, testId: A } = await setup();
    const ana = await joined(A);
    const { POST: postTest } = await import("@/app/api/tests/route");
    const B = (await json(await postTest(req("/api/tests", { cookie: dev.cookie, body: { productName: "Night Ferry", title: "Night Ferry", description: "x", buildUrl: "https://example.com/o", categories: ["Game"], devices: [], languages: [], spots: 3, writtenCents: "8.00", recordingCents: null, liveRateCents: null, liveMinutes: null, deadlineDays: 7, questions: ["Q?"], openUntil: "" } })))).body.id as string;
    await sact(ana.sessionId, "written", ana.tester.cookie, { answers: ["a", "b"] });
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    await db.user.update({ where: { id: ana.tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID(), payoutsReady: true } });
    let decline = true;
    setStripeForTests({
      paymentIntents: { create: async () => { if (decline) throw new Error("declined"); return { id: "pi_" + randomUUID(), status: "succeeded" }; } },
      webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
    } as unknown as Stripe);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId } });
    await later(); // the database clock can run a few ms ahead of this process: let the last write settle first
    const pageLoaded = seen();
    await later();
    const notesBefore = await db.notification.count({ where: { userId: ana.tester.user.id } });
    const r = await reviewPOST(req("/api/review", { cookie: dev.cookie, body: { payKey: randomUUID(), seenAt: pageLoaded, kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, tab: "tab-1" } })).then(json);
    expect(r.body.error.code).toBe("card_failed");
    const owed = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id, status: "failed" } });
    expect(owed.owedUntil).not.toBeNull();
    // The developer's other test names the failure (top box and stop once).
    const alert = expect.stringMatching(/^Payment failed on Harbor Run: \$10\.00 to Ana Silva for the written answers · we'll retry tomorrow · pay by .+ to avoid a pause$/);
    expect((await live(dev.cookie, `test:${B}`, pageLoaded, "tab-2")).body.changes.map((c: { text: string }) => c.text)).toEqual([alert]);
    expect(texts(await act(B, "next-round", dev.cookie, { seenAt: pageLoaded, tab: "tab-2" }))).toEqual([alert]);
    // The tester: one bell, the top-box line and a stop once, worded without failed / declined / card / hold.
    const delayed = "Nora Lane's payment for your written answers ($10) is delayed. You'll be told when it arrives.";
    const bells = await db.notification.findMany({ where: { userId: ana.tester.user.id }, orderBy: { createdAt: "asc" } });
    expect(bells.slice(notesBefore).map((n) => n.text)).toEqual([delayed]);
    expect((await live(ana.tester.cookie, `session:${ana.sessionId}`, pageLoaded)).body.changes.map((c: { text: string }) => c.text)).toEqual([delayed]);
    expect(texts(await sact(ana.sessionId, "leave", ana.tester.cookie, { seenAt: pageLoaded }))).toEqual([delayed]);
    for (const t of [delayed, ...bells.map((n) => n.text)]) expect(t).not.toMatch(/fail|declin|card|hold/i);
    // It goes through ("Pay what you owe"): exactly one more notification, the normal paid line; the top box says paid.
    decline = false;
    const afterDecline = await db.notification.count({ where: { userId: ana.tester.user.id } });
    const { payOwed } = await import("@/lib/server/holds");
    expect((await payOwed(dev.user)).paid).toBe(1);
    const after = await db.notification.findMany({ where: { userId: ana.tester.user.id }, orderBy: { createdAt: "asc" } });
    expect(after.map((n) => n.text).slice(afterDecline)).toEqual(["Nora Lane paid $10.00 for your written answers"]);
    expect((await live(ana.tester.cookie, `session:${ana.sessionId}`, pageLoaded)).body.changes.map((c: { text: string }) => c.text)).toEqual([delayed, "Nora Lane paid $10.00 for your written answers"]);
  });

  it("the tester's own delay on test A shows on their session on B with the same developer, not with another developer", async () => {
    const { dev, testId: A } = await setup();
    const ana = await joined(A);
    const { POST: postTest } = await import("@/app/api/tests/route");
    const B = (await json(await postTest(req("/api/tests", { cookie: dev.cookie, body: { productName: "Night Ferry", title: "Night Ferry", description: "x", buildUrl: "https://example.com/o", categories: ["Game"], devices: [], languages: [], spots: 3, writtenCents: "8.00", recordingCents: null, liveRateCents: null, liveMinutes: null, deadlineDays: 7, questions: ["Q?"], openUntil: "" } })))).body.id as string;
    const onB = await act(B, "join", ana.tester.cookie, { listingVersion: 1 });
    const other = await setup({ title: "Elsewhere" });
    const onC = await act(other.testId, "join", ana.tester.cookie, { listingVersion: 1 });
    await sact(ana.sessionId, "written", ana.tester.cookie, { answers: ["a", "b"] });
    await later(); // the database clock can run a few ms ahead of this process: let the last write settle first
    const pageLoaded = seen();
    await later();
    const subA = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId } });
    await fail(ana.sessionId, dev.user.id, ana.tester.user.id, subA.id);
    const delayed = "Nora Lane's payment for your written answers on Harbor Run ($8) is delayed. You'll be told when it arrives.";
    expect((await live(ana.tester.cookie, `session:${onB.body.sessionId}`, pageLoaded)).body.changes.map((c: { text: string }) => c.text)).toEqual([delayed]);
    expect(texts(await sact(onB.body.sessionId, "leave", ana.tester.cookie, { seenAt: pageLoaded }))).toEqual([delayed]);
    expect((await live(ana.tester.cookie, `session:${onC.body.sessionId}`, pageLoaded)).body.changes).toEqual([]);
  });

  it("a tester never reads 'failed', 'hold' or 'chargeback': delayed, arrived, the team's decision", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Short answers" });
    await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question", seenAt: seen(), confirmed: true });
    await later(); // the database clock can run a few ms ahead of this process: let the last write settle first
    const pageLoaded = seen();
    await later();
    const p = await fail(sessionId, dev.user.id, tester.user.id, sub.id, { failure: "card_declined" });
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 500, feeCents: 100, testerCents: 400, status: "charged", chargeback: "open", chargebackAt: new Date(), stripePaymentIntentId: "pi_" + randomUUID() } });
    await db.testEvent.create({ data: { testId, kind: "chargeback", text: "Your bank reversed your $5.00 payment for Ana Silva's written answers", contractId: sessionId } });
    await db.testEvent.create({ data: { testId, kind: "paused", text: "Your tests are paused until you pay what you owe" } });
    const before = await live(tester.cookie, `session:${sessionId}`, pageLoaded);
    expect(before.body.changes.map((c: { text: string }) => c.text)).toEqual(["Nora Lane's payment for your written answers ($8) is delayed. You'll be told when it arrives."]);
    await later();
    await db.payment.update({ where: { id: p.id }, data: { status: "charged", settledAt: new Date() } });
    const d = await db.dispute.findFirstOrThrow({ where: { contractId: sessionId } });
    await db.dispute.update({ where: { id: d.id }, data: { status: "decided", decidedCents: 800, decidedAt: new Date() } });
    const lines: string[] = (await live(tester.cookie, `session:${sessionId}`, pageLoaded)).body.changes.map((c: { text: string }) => c.text);
    expect(lines).toEqual(expect.arrayContaining(["Nora Lane paid $8.00 for your written answers", "The team decided your dispute: the pay was raised to $8.00"]));
    for (const t of lines) expect(t).not.toMatch(/fail|hold|chargeback|reversed|bank/i);
    const stop = await sact(sessionId, "leave", tester.cookie, { seenAt: pageLoaded });
    expect(stop.body.error.code).toBe("stop_once");
    for (const t of texts(stop)) expect(t).not.toMatch(/fail|hold|chargeback|reversed|bank/i);
    // The developer's side lists the chargeback (an event on this test).
    expect((await live(dev.cookie, `test:${testId}`, pageLoaded)).body.changes.map((c: { text: string }) => c.text)).toEqual(expect.arrayContaining(["Your bank reversed your $5.00 payment for Ana Silva's written answers"]));
  });
});
