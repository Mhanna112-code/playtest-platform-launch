import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as allPOST } from "@/app/api/payments/confirm-all/route";
import { POST as sessionPOST } from "@/app/api/sessions/[id]/[action]/route";
import { decideDispute } from "@/lib/server/payments";
import { awayAction } from "@/lib/server/confirm";
import { setStripeForTests } from "@/lib/server/stripe";
import { api } from "@/lib/client";
import { clearListed, markShownInBox, shownIdsNow } from "@/lib/live";
import { json, makeUser, req } from "./helpers";
import { act, atHours, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 5, §250; recording G, the R5 re-take) An update listed in ANY stop box on a page counts as seen for EVERY button on that page: no other press stops
// again for it. Per update (its identity, `sid`), not by time: what a box didn't list still stops the presses it applies to; a newer update stops as usual.

type Line = { text: string; sid?: string; forced?: boolean };
type Res = { status: number; body: { error?: { code?: string; now?: string; changes?: Line[] } } & Record<string, unknown> };
const texts = (r: Res) => (r.body.error?.changes ?? []).map((c) => c.text);
const sids = (...rs: Res[]) => rs.flatMap((r) => (r.body.error?.changes ?? []).map((c) => c.sid).filter((x): x is string => !!x));
const TAB = "dev-tab-" + randomUUID();
const STOP = "We have what we need.";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Ana and Ben working; Cara too (so Ben's leaving doesn't end the test). */
async function team() {
  const s = await setup();
  const ana = await joined(s.testId, "Ana Silva");
  const ben = await joined(s.testId, "Ben Okafor", "he");
  const cara = await joined(s.testId, "Cara Diaz");
  return { ...s, ana, ben, cara };
}
const dev = (x: { testId: string; dev: { cookie: string } }, action: string, body: Record<string, unknown>) => act(x.testId, action, x.dev.cookie, { tab: TAB, ...body }) as Promise<Res>;

describe("§250 the developer's test page: a box's lines are seen for every button", () => {
  it("the recording: Stop stops; End early then doesn't stop for the same updates; Stop again goes ahead", async () => {
    const x = await team();
    const loaded = seen(); await settle();
    // Ben leaves, Ana sends her written answers (the box listed "Ben left", "Fay disputed"…).
    expect((await sact(x.ben.sessionId, "leave", x.ben.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await sact(x.ana.sessionId, "written", x.ana.tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const stop = await dev(x, "stop", { reason: STOP, seenAt: loaded });
    expect(stop.body.error?.code, JSON.stringify(stop.body)).toBe("stop_once");
    expect(texts(stop).some((t) => t.startsWith("Ben Okafor left"))).toBe(true);
    expect(texts(stop).some((t) => t.startsWith("Ana Silva sent"))).toBe(true);
    // Every line carries its identity.
    expect(sids(stop)).toHaveLength(stop.body.error!.changes!.length);
    const shownIds = sids(stop);
    // Before §250: End early stopped AGAIN with the same updates (the press counted from the page load).
    const before = await dev(x, "end-early", { contractIds: [x.cara.sessionId], reason: "We have enough", seenAt: loaded });
    expect(before.body.error?.code).toBe("stop_once");
    expect(texts(before)).toEqual(texts(stop));
    // Now: the page sends what Stop's box listed; End early goes ahead.
    const end = await dev(x, "end-early", { contractIds: [x.cara.sessionId], reason: "We have enough", seenAt: loaded, shownIds });
    expect(end.status, JSON.stringify(end.body)).toBe(200);
    // Stop again (its box went with the redraw: a first press again) goes ahead too.
    const again = await dev(x, "stop", { reason: STOP, seenAt: loaded, shownIds });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: x.testId } })).status).toBe("stopped");
  });

  // (Codex 343018a9/efc9b078, docs/NOV8-SAME-PART-ALERTS.md) Developer payment presses follow the Work sent alert even for work on that same part: §159 rule 2's
  // forced stop went, so a sent line the Alerts left out stops neither Stop nor Pay.
  it("an update the first box didn't list (left out by the Alerts) stays out of the payment press too", async () => {
    const x = await team();
    await db.test.update({ where: { id: x.testId }, data: { ignoredAlerts: ["work"] } });
    const loaded = seen(); await settle();
    expect((await sact(x.ana.sessionId, "written", x.ana.tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await sact(x.ben.sessionId, "leave", x.ben.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    // Stop: "Work sent" is ticked off, so Ana's sent line isn't in its box; Ben's leaving is.
    const stop = await dev(x, "stop", { reason: STOP, seenAt: loaded });
    expect(stop.body.error?.code).toBe("stop_once");
    expect(texts(stop).some((t) => t.startsWith("Ana Silva sent"))).toBe(false);
    expect(texts(stop).some((t) => t.startsWith("Ben Okafor left"))).toBe(true);
    // Pay on Ana's written answers: her sent line follows the Alerts (left out); Ben's leaving (listed) doesn't stop it either.
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: x.ana.sessionId } });
    const pay = (await reviewPOST(req("/api/review", { cookie: x.dev.cookie, body: { payKey: randomUUID(), kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: loaded, tab: TAB, shownIds: sids(stop) } })).then(json)) as Res;
    expect(pay.body.error, JSON.stringify(pay.body)).toBeUndefined();
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
  });

  it("a newer update (after the box) stops as usual, alone", async () => {
    const x = await team();
    const loaded = seen(); await settle();
    expect((await sact(x.ben.sessionId, "leave", x.ben.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const stop = await dev(x, "stop", { reason: STOP, seenAt: loaded });
    expect(texts(stop).some((t) => t.startsWith("Ben Okafor left"))).toBe(true);
    await settle();
    expect((await sact(x.ana.sessionId, "written", x.ana.tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const end = await dev(x, "end-early", { contractIds: [x.cara.sessionId], reason: "We have enough", seenAt: loaded, shownIds: sids(stop) });
    expect(end.body.error?.code).toBe("stop_once");
    expect(texts(end)).toHaveLength(1);
    expect(texts(end)[0]).toMatch(/^Ana Silva sent/);
  });
});

describe("§250 the tester's session page", () => {
  it("Send's box lists the developer's call request: Leave doesn't stop for it; a newer request stops Leave alone", async () => {
    const x = await team();
    const loaded = seen(); await settle();
    expect((await dev(x, "request-time", { seenAt: seen(), confirmed: true, contractIds: [x.ana.sessionId], startsAt: atHours(48) })).status).toBe(200);
    await settle();
    const send = (await sact(x.ana.sessionId, "written", x.ana.tester.cookie, { answers: ["a", "b"], seenAt: loaded })) as Res;
    expect(send.body.error?.code, JSON.stringify(send.body)).toBe("stop_once");
    expect(texts(send)).toEqual([expect.stringMatching(/^Nora Lane requested a call for /)]);
    // Without the list (before §250) Leave stopped again for it.
    expect(((await sact(x.ana.sessionId, "leave", x.ana.tester.cookie, { seenAt: loaded })) as Res).body.error?.code).toBe("stop_once");
    // Send again as a first press with the list: goes ahead.
    const sendAgain = (await sact(x.ana.sessionId, "written", x.ana.tester.cookie, { answers: ["a", "b"], seenAt: loaded, shownIds: sids(send) })) as Res;
    expect(sendAgain.status, JSON.stringify(sendAgain.body)).toBe(200);
    // A newer request: Leave stops for it alone.
    await settle();
    expect((await dev(x, "request-time", { seenAt: seen(), confirmed: true, contractIds: [x.ana.sessionId], startsAt: atHours(72) })).status).toBe(200);
    await settle();
    const leave = (await sact(x.ana.sessionId, "leave", x.ana.tester.cookie, { seenAt: loaded, shownIds: sids(send) })) as Res;
    expect(leave.body.error?.code).toBe("stop_once");
    expect(texts(leave)).toHaveLength(1);
    expect((await sact(x.ana.sessionId, "leave", x.ana.tester.cookie, { seenAt: loaded, shownIds: sids(send, leave) })).status).toBe(200);
  });

  // (Owner, Nov 5, §268; replaces §232's exception) No exception: once a box listed the offer, Rate and Leave go through like every press.
  it("no exception any more (§268): once a box listed the offer, Rate and Leave go through", async () => {
    const s = await setup();
    const ana = await joined(s.testId, "Ana Silva");
    expect((await sact(ana.sessionId, "written", ana.tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId } });
    expect((await reviewPOST(req("/api/review", { cookie: s.dev.cookie, body: { payKey: randomUUID(), kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, confirmed: true } })).then(json)).status).toBe(200);
    await settle();
    const loaded = seen(); await settle();
    const t = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
    expect((await act(s.testId, "edit", s.dev.cookie, { version: t.version, fields: { writtenCents: "12.00" }, confirmed: true })).status).toBe(200);
    await settle();
    const rate = (extra: Record<string, unknown>) => sessionPOST(req(`/api/sessions/${ana.sessionId}/rate`, { cookie: ana.tester.cookie, body: { stars: 5, seenAt: loaded, pageSeenAt: loaded, loadedAt: loaded, ...extra } }), { params: Promise.resolve({ id: ana.sessionId, action: "rate" }) }).then(json) as Promise<Res>;
    const leave = (await sact(ana.sessionId, "leave", ana.tester.cookie, { seenAt: loaded, pageSeenAt: loaded })) as Res;
    expect(leave.body.error?.code, JSON.stringify(leave.body)).toBe("stop_once");
    expect(texts(leave)).toContain("Nora Lane offered you new terms: Switch or Keep them");
    // The offer line is seen now: Rate goes through.
    const r1 = await rate({ shownIds: sids(leave) });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
  });
});

/** Stripe stand-in: off-session charges go through; away checks wait for the bank. */
function bank() {
  const pis = new Map<string, string>();
  setStripeForTests({
    paymentIntents: {
      create: async () => { const id = "pi_" + randomUUID(); pis.set(id, "succeeded"); return { id, status: "succeeded" }; },
      retrieve: async (id: string) => ({ id, status: pis.get(id) ?? "succeeded", client_secret: `${id}_secret`, next_action: { type: "redirect_to_url", redirect_to_url: { url: "https://hooks.stripe.com/3ds" } } }),
      cancel: async (id: string) => { pis.set(id, "canceled"); return { id, status: "canceled" }; },
    },
    refunds: { create: async () => ({ id: "re_" + randomUUID() }) },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
    customers: { update: async () => ({}) },
  } as unknown as Stripe);
  return pis;
}
const devs: string[] = [];
beforeEach(() => { process.env.DISPUTE_WAIT_MS = "0"; });
afterEach(() => { setStripeForTests(null); delete process.env.DISPUTE_WAIT_MS; });
afterAll(async () => {
  await db.payment.updateMany({ where: { developerId: { in: devs }, status: { notIn: ["charged", "bundled", "not_set_up", "refunded"] } }, data: { status: "cancelled", actionPi: null, actionBy: null, coveredById: null } });
});
/** (As batch35-dash-confirm-decision) Ana disputed her written answers' pay; a charge made while away waits for the bank on her recording, and one on Ben's. */
async function world() {
  const s = await setup({ recordingCents: "10.00" });
  devs.push(s.dev.user.id);
  const ana = await joined(s.testId, "Ana Silva");
  const ben = await joined(s.testId, "Ben Okafor", "he");
  for (const t of [ana, ben]) await sact(t.sessionId, "written", t.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const anaSub = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId, kind: "written" } });
  const benSub = await db.submission.findFirstOrThrow({ where: { contractId: ben.sessionId } });
  const anaRec = await db.submission.create({ data: { contractId: ana.sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_saved" } });
  const pis = bank();
  expect((await reviewPOST(req("/api/review", { cookie: s.dev.cookie, body: { payKey: randomUUID(), kind: "submission", id: anaSub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", seenAt: seen() } })).then(json)).status).toBe(200);
  await settle();
  expect((await sact(ana.sessionId, "dispute", ana.tester.cookie, { kind: "submission", id: anaSub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true })).status).toBe(200);
  await db.test.update({ where: { id: s.testId }, data: { ignoredAlerts: ["payments", "work", "leaving", "admin"] } });
  const items = [];
  for (const [contractId, submissionId, testerId] of [[ana.sessionId, anaRec.id, ana.tester.user.id], [ben.sessionId, benSub.id, ben.tester.user.id]] as const) {
    const p = await db.payment.create({ data: { kind: "dispute", contractId, submissionId, developerId: s.dev.user.id, testerId, amountCents: 500, feeCents: 0, testerCents: 0, status: "needs_confirmation" } });
    const pi = "pi_" + randomUUID();
    pis.set(pi, "requires_action");
    items.push(await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: pi, clientSecret: `${pi}_secret` }));
  }
  await settle();
  return { ...s, ana, anaSub, items };
}

describe("§250 the dashboard: Confirm's box is seen by Confirm all and by Confirm again", () => {
  it("Confirm stops for the team's decision about Ana (forced); Confirm all and Confirm again don't stop for it", async () => {
    const w = await world();
    const loaded = seen(); await settle();
    const admin = await makeUser({ name: "Admin" });
    await db.user.update({ where: { id: admin.user.id }, data: { isAdmin: true } });
    const row = await db.dispute.findFirstOrThrow({ where: { submissionId: w.anaSub.id } });
    await decideDispute(await db.user.findUniqueOrThrow({ where: { id: admin.user.id } }), row.id, { total: "9.00", tickCents: 500 });
    await settle();
    const confirm = (extra: Record<string, unknown> = {}) => confirmPOST(req("/api/payments/confirm", { cookie: w.dev.cookie, headers: { "x-tab": TAB }, body: { paymentId: w.items[0].id, start: true, seenAt: loaded, page: "/app", ...extra } })).then(json) as Promise<Res>;
    const all = (extra: Record<string, unknown> = {}) => allPOST(req("/api/payments/confirm-all", { cookie: w.dev.cookie, headers: { "x-tab": TAB }, body: { seenTotalCents: 1000, seenIds: w.items.map((p) => p.id), seenAt: loaded, ...extra } })).then(json) as Promise<Res>;
    // (Owner, Nov 11, §380 C) Confirm with your bank and Confirm all no longer stop for the team's decision (D05): neither stops at all.
    void sids;
    const first = await confirm();
    expect(first.body.error?.code, JSON.stringify(first.body)).not.toBe("stop_once");
    expect((await all()).body.error?.code).not.toBe("stop_once");
  });
});

describe("§250 the page side", () => {
  it("a box's lines are recorded page-wide; every press sends them; another page starts fresh", async () => {
    const loc = { pathname: "/app/tests/t1" };
    vi.stubGlobal("window", Object.assign(new EventTarget(), { location: loc }));
    clearListed();
    markShownInBox([{ text: "Ben Okafor left", at: "2026-11-05T10:00:00.000Z", sid: "a1" }, { text: "no identity", at: "2026-11-05T10:00:00.000Z" }]);
    markShownInBox([{ text: "Ana Silva sent her written answers", at: "2026-11-05T10:01:00.000Z", sid: "b2" }]);
    expect(shownIdsNow()).toEqual(["a1", "b2"]);
    const fetcher = vi.fn(async () => Response.json({ ok: true })); vi.stubGlobal("fetch", fetcher);
    await api("/api/tests/t1/end-early", { reason: "x", seenAt: "2026-11-05T09:00:00.000Z" });
    const init = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init[1].body)).shownIds).toEqual(["a1", "b2"]);
    // A press without a seen marker (not gated) sends nothing extra.
    await api("/api/other", { x: 1 });
    expect(JSON.parse(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body)).shownIds).toBeUndefined();
    // Another page in the tab: fresh.
    loc.pathname = "/app";
    expect(shownIdsNow()).toEqual([]);
    clearListed();
  });
});
