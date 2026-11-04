import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as allPOST } from "@/app/api/payments/confirm-all/route";
import { decideDispute } from "@/lib/server/payments";
import { awayAction } from "@/lib/server/confirm";
import { setStripeForTests } from "@/lib/server/stripe";
import { KeepLoadTime, keptSeenAt, useLoadTime } from "@/components/KeepLoadTime";
import { json, makeUser, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner bug, Nov 4, batch 35 §176) The dashboard's "Confirm with your bank" on a charge made while away didn't stop once for the team's decision about the same
// tester: the dashboard redrew on its own after the decision (its poll found the decision's new charge row), the redraw's render time became the press's seen
// marker, and the decision counted as seen though the dashboard never shows it. The dashboard's bank box now keeps its first load's time across redraws.

// The components' JSX needs React in scope under the tests' transform (as the other render tests do).
(globalThis as unknown as { React: typeof React }).React = React;
const TAB = "tab-" + randomUUID();
const devs: string[] = [];
beforeEach(() => { process.env.DISPUTE_WAIT_MS = "0"; });
afterEach(() => { setStripeForTests(null); delete process.env.DISPUTE_WAIT_MS; });
afterAll(async () => {
  await db.payment.updateMany({ where: { developerId: { in: devs }, status: { notIn: ["charged", "bundled", "not_set_up", "refunded"] } }, data: { status: "cancelled", actionPi: null, actionBy: null, coveredById: null } });
});
const src = (f: string) => fs.readFileSync(path.join(process.cwd(), "src", f), "utf8");
type Res = { status: number; body: { error?: { code?: string; now?: string; changes?: { text: string; forced?: boolean }[] } } & Record<string, unknown> };
const texts = (r: Res) => (r.body.error?.changes ?? []).map((c) => c.text);

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

/**
 * The real case (Nov 4, 17:49): Ana disputed the pay for her written answers (paid $4.00); a $5.00 charge made while away waits for the bank on her recording, and
 * Ben's on his written answers; Alerts ticked off: payments, work, leaving, admin (as the developer's test).
 */
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
  const paid = await reviewPOST(req("/api/review", { cookie: s.dev.cookie, body: { payKey: randomUUID(), kind: "submission", id: anaSub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful", seenAt: seen() } })).then(json);
  expect(paid.status, JSON.stringify(paid.body)).toBe(200);
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
async function admin() {
  const a = await makeUser({ name: "Admin" });
  return db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
}
const confirmStart = (cookie: string, paymentId: string, seenAt: string, extra: Record<string, unknown> = {}) =>
  confirmPOST(req("/api/payments/confirm", { cookie, headers: { "x-tab": TAB }, body: { paymentId, start: true, seenAt, ...extra } })).then(json) as Promise<Res>;

describe("§176 the dashboard's Confirm with your bank stops once for the team's decision about that tester after a redraw", () => {
  it("loaded, the team decides her dispute, the box redraws on its own, then Confirm: stops once naming the decision (forced); the second press goes ahead", async () => {
    const w = await world();
    const loaded = seen(); // the dashboard's first load
    await settle();
    const row = await db.dispute.findFirstOrThrow({ where: { submissionId: w.anaSub.id } });
    await decideDispute(await admin(), row.id, { total: "9.00", tickCents: 500 });
    await settle();
    const redraw = seen(); // the bank box's poll found a new row and redrew (router.refresh: a new server render time)
    await settle();
    // Before: the press sent the redraw's render time, so the decision counted as seen and the bank's check opened at once.
    const before = await confirmStart(w.dev.cookie, w.items[0].id, keptSeenAt(redraw, ""));
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    // Now: the box keeps its first load's time across redraws.
    const sent = keptSeenAt(redraw, loaded);
    expect(sent).toBe(loaded);
    const first = await confirmStart(w.dev.cookie, w.items[0].id, sent);
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(first.body.error?.changes).toEqual([expect.objectContaining({ text: expect.stringMatching(/^The team decided Ana Silva's dispute: raised the pay to \$9\.00/), forced: true })]);
    const second = await confirmStart(w.dev.cookie, w.items[0].id, sent, { confirmed: true, boxAt: first.body.error!.now });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    // Another tester's waiting charge: the decision about Ana follows the Decisions tick (off), so it goes ahead.
    expect((await confirmStart(w.dev.cookie, w.items[1].id, sent)).status).toBe(200);
  });

  it("Confirm all on the dashboard counts from the same first load: stops once for the decision about Ana", async () => {
    const w = await world();
    const loaded = seen();
    await settle();
    const row = await db.dispute.findFirstOrThrow({ where: { submissionId: w.anaSub.id } });
    await decideDispute(await admin(), row.id, { total: "9.00", tickCents: 500 });
    await settle();
    const redraw = seen();
    const r = (await allPOST(req("/api/payments/confirm-all", { cookie: w.dev.cookie, headers: { "x-tab": TAB }, body: { seenTotalCents: 1000, seenIds: w.items.map((p) => p.id), seenAt: keptSeenAt(redraw, loaded) } })).then(json)) as Res;
    expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
    expect(texts(r).some((t) => t.startsWith("The team decided Ana Silva's dispute"))).toBe(true);
  });

  it("the box keeps the first load: KeepLoadTime gives its presses the earlier time; outside it (test page, Payments) the render time is unchanged", () => {
    const Probe = ({ at }: { at: string }) => createElement("i", null, useLoadTime(at));
    const loaded = "2026-11-04T17:40:00.000Z", redraw = "2026-11-04T17:50:13.000Z";
    expect(renderToStaticMarkup(createElement(KeepLoadTime, { at: loaded }, createElement(Probe, { at: redraw })))).toBe(`<i>${loaded}</i>`);
    expect(renderToStaticMarkup(createElement(Probe, { at: redraw }))).toBe(`<i>${redraw}</i>`);
    expect(keptSeenAt("", loaded)).toBe(""); // Payments' renewal sends none: still none
    // The dashboard's box is wrapped; its two presses read it.
    expect(src("app/app/BankToConfirm.tsx")).toMatch(/<KeepLoadTime at=\{now\.toISOString\(\)\}>\s*<BankToConfirmBox /);
    expect(src("components/BankWaiting.tsx")).toContain("usePress(useLoadTime(seenAt))");
    expect(src("components/ConfirmAll.tsx")).toContain("const seenAt = useLoadTime(rendered);");
    // The first render's time is state: a redraw (router.refresh) keeps it.
    expect(src("components/KeepLoadTime.tsx")).toContain("const [first] = useState(at);");
  });
});
