import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { startHold } from "@/lib/server/holds";
import { setStripeForTests } from "@/lib/server/stripe";
import { adminPage, type TestVM } from "@/lib/server/adminLists";
import { CRITICAL_KEYS, countsOf, lockedFields } from "@/lib/limits";
import { whenText } from "@/lib/server/adminRace";
import { TestActions } from "@/app/admin/TestActions";
import { AccountActions } from "@/app/admin/AccountActions";
import { accountState } from "@/lib/server/accountState";
import { reinstateHeldLine } from "@/lib/server/restrictions";
import { json, makeUser, req } from "./helpers";
import { act, joined, seen, setup } from "./fixtures";
import { sentWork } from "./b15";

// Batch 34 §1 (owner, Oct 30): admins' opposite actions stop once; impossible ones name who and when. Every admin press sends its page time (`since`); another admin's
// change to the same account, test, hold or outage since then stops the press once (the box's lines name who and when), and the second press (confirmed, with the
// box's time) goes ahead. A press that is no longer possible is a plain refusal naming who and when.

(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const T = "\\d{1,2}:\\d{2}\\s[AP]M"; // a time alone (within a day)
afterEach(() => setStripeForTests(null));

async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test`, name: "Team Member" });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
type Res = { status: number; body: { error?: { code: string; message: string; changes?: { text: string; at: string; kind?: string }[]; press?: string; now?: string } } & Record<string, unknown> };
const aact = (cookie: string, action: string, body: Record<string, unknown>): Promise<Res> => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
/** A page time from just before another admin's change. */
const loaded = async () => {
  const at = seen();
  await new Promise((r) => setTimeout(r, 15));
  return at;
};
/** The second press after a stop: confirmed, with the box's time. */
const again = (stop: Res) => ({ confirmed: true, boxAt: stop.body.error!.now });
/** A stop: 409 stop_once, the press named, one line per change (each naming who and when), in order. */
function expectStop(r: Res, press: string, lines: RegExp[]) {
  expect(r.status).toBe(409);
  expect(r.body.error).toMatchObject({ code: "stop_once", press });
  expect(r.body.error!.changes!.map((c) => c.text)).toEqual(lines.map((l) => expect.stringMatching(l)));
  for (const c of r.body.error!.changes!) expect(c.kind).toBe("stop"); // the line says its own time
  expect(typeof r.body.error!.now).toBe("string");
}
const line = (who: string, what: string) => new RegExp(`^${esc(who)} ${esc(what)} at ${T}\\.$`);
const refused = (r: Res, message: RegExp) => {
  expect(r.status).toBe(409);
  expect(r.body.error!.code).not.toBe("stop_once");
  expect(r.body.error!.message).toMatch(message);
};
const byAtRe = (who: string) => `\\(by ${esc(who)} at ${T}\\)`;
const devOf = async () => {
  const d = await makeUser({ name: "Nora Lane", dev: true, tester: true });
  return d;
};

describe("batch 34 §1: an account (Delete account and the $0 close-out)", () => {
  it("Delete after another admin's Suspend stops once naming them and when; the second press deletes", async () => {
    const a = await admin(), b = await admin();
    const x = await devOf();
    const since = await loaded();
    expect((await aact(b.cookie, "suspend", { id: x.user.id, side: "tester", note: "Spam reports" })).status).toBe(200);
    const stop = await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since });
    expectStop(stop, "Delete account", [line(b.user.email, "suspended the tester side")]);
    expect((stop.body.error as unknown as { account: { email: string } }).account.email).toBe(x.user.email); // the row or profile updates from the stop
    expect((await db.user.findUniqueOrThrow({ where: { id: x.user.id } })).deletedAt).toBeNull();
    const go = await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since, ...again(stop) });
    expect(go.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: x.user.id } })).deletedAt).not.toBeNull();
  });

  it("Delete after a Reinstate stops once; a newer change after the box stops it again with the new line; then it goes ahead", async () => {
    const a = await admin(), b = await admin(), c = await admin();
    const x = await devOf();
    expect((await aact(b.cookie, "suspend", { id: x.user.id, side: "developer", note: "Checking reports" })).status).toBe(200);
    const since = await loaded();
    expect((await aact(b.cookie, "unsuspend", { id: x.user.id, side: "developer" })).status).toBe(200);
    const stop = await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since });
    expectStop(stop, "Delete account", [line(b.user.email, "reinstated the developer side")]);
    await new Promise((r) => setTimeout(r, 15));
    expect((await aact(c.cookie, "suspend", { id: x.user.id, side: "tester", note: "More reports" })).status).toBe(200);
    const stop2 = await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since, ...again(stop) });
    expectStop(stop2, "Delete account", [line(c.user.email, "suspended the tester side")]);
    expect((await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since, ...again(stop2) })).status).toBe(200);
  });

  it("Delete after another admin's $0 close-out stops once; the second press deletes", async () => {
    const a = await admin(), b = await admin();
    const w = await sentWork();
    const since = await loaded();
    const pv = await aact(b.cookie, "preview-team-close", { id: w.dev.user.id, scope: "developer" });
    expect((await aact(b.cookie, "team-close", { id: w.dev.user.id, scope: "developer", reason: "Spam account", pieces: pv.body.pieces })).body.line).toBe("1 closed");
    const stop = await aact(a.cookie, "delete-account", { id: w.dev.user.id, note: "Abandoned account", since });
    expectStop(stop, "Delete account", [line(b.user.email, "closed 1 open review for $0")]);
    expect((await aact(a.cookie, "delete-account", { id: w.dev.user.id, note: "Abandoned account", since, ...again(stop) })).status).toBe(200);
  });

  it("the $0 close-out after a Suspend or a Reinstate stops once; the second press closes (N closed; M settled meanwhile stays)", async () => {
    const a = await admin(), b = await admin();
    const w = await sentWork();
    const pv = await aact(a.cookie, "preview-team-close", { id: w.dev.user.id, scope: "developer" });
    await new Promise((r) => setTimeout(r, 15));
    expect((await aact(b.cookie, "suspend", { id: w.dev.user.id, side: "developer", note: "Fraud reports" })).status).toBe(200);
    expect((await aact(b.cookie, "unsuspend", { id: w.dev.user.id, side: "developer" })).status).toBe(200);
    const body = { id: w.dev.user.id, scope: "developer", reason: "Spam account", pieces: pv.body.pieces, at: pv.body.at, since: pv.body.at };
    const stop = await aact(a.cookie, "team-close", body);
    expectStop(stop, "Close all open reviews for $0", [line(b.user.email, "suspended the developer side"), line(b.user.email, "reinstated the developer side")]);
    const go = await aact(a.cookie, "team-close", { ...body, ...again(stop) });
    expect(go.body.line).toBe("1 closed");
    // A test's close-out names its own button.
    const w2 = await sentWork();
    const pv2 = await aact(a.cookie, "preview-team-close", { id: w2.testId, scope: "test" });
    await new Promise((r) => setTimeout(r, 15));
    expect((await aact(b.cookie, "suspend", { id: w2.dev.user.id, side: "developer", note: "Fraud reports" })).status).toBe(200);
    expectStop(await aact(a.cookie, "team-close", { id: w2.testId, scope: "test", reason: "Spam account", pieces: pv2.body.pieces, since: pv2.body.at }), "Close this test's open reviews for $0", [line(b.user.email, "suspended the developer side")]);
  });

  it("already deleted: a plain refusal naming who and when (an admin, or its owner)", async () => {
    const a = await admin(), b = await admin();
    const x = await devOf();
    const since = await loaded();
    expect((await aact(b.cookie, "delete-account", { id: x.user.id, note: "Asked by email" })).status).toBe(200);
    refused(await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since }), new RegExp(`^That account was already deleted ${byAtRe(b.user.email)}\\.$`));
    const y = await devOf();
    await db.user.update({ where: { id: y.user.id }, data: { deletedAt: new Date(), deletedBy: "self" } });
    refused(await aact(a.cookie, "delete-account", { id: y.user.id, note: "Asked by email", since }), new RegExp(`^That account was already deleted ${byAtRe("its owner")}\\.$`));
  });

  it("an admin's own changes never stop their press, and a press without a page time goes ahead as before", async () => {
    const a = await admin(), b = await admin();
    const x = await devOf(), y = await devOf();
    const since = await loaded();
    expect((await aact(a.cookie, "suspend", { id: x.user.id, side: "tester", note: "Spam reports" })).status).toBe(200);
    expect((await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since })).status).toBe(200);
    expect((await aact(b.cookie, "suspend", { id: y.user.id, side: "tester", note: "Spam reports" })).status).toBe(200);
    expect((await aact(a.cookie, "delete-account", { id: y.user.id, note: "Asked by email" })).status).toBe(200);
  });
});

describe("batch 34 §1: a test (Pause, Lift the pause, Stop, Extend, Close now, Allow changes again)", () => {
  it("Pause after another admin's Pause and Lift stops once with both lines; the second press pauses", async () => {
    const a = await admin(), b = await admin();
    const s = await setup();
    const since = await loaded();
    expect((await aact(b.cookie, "pause-test", { id: s.testId, note: "Checking" })).status).toBe(200);
    expect((await aact(b.cookie, "unpause-test", { id: s.testId })).status).toBe(200);
    const stop = await aact(a.cookie, "pause-test", { id: s.testId, note: "A report", since });
    expectStop(stop, "Pause", [line(b.user.email, "paused the test"), line(b.user.email, "lifted the pause")]);
    expect((await db.test.findUniqueOrThrow({ where: { id: s.testId } })).adminPausedAt).toBeNull();
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "A report", since, ...again(stop) })).status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: s.testId } })).adminPausedById).toBe(a.user.id);
  });

  it("Pause on a test already paused or stopped: refused naming who and when", async () => {
    const a = await admin(), b = await admin();
    const s = await setup(), s2 = await setup();
    const since = await loaded();
    expect((await aact(b.cookie, "pause-test", { id: s.testId, note: "Checking" })).status).toBe(200);
    refused(await aact(a.cookie, "pause-test", { id: s.testId, note: "A report", since }), new RegExp(`^That test was already paused ${byAtRe(b.user.email)}\\.$`));
    expect((await aact(b.cookie, "stop-test", { id: s2.testId, note: "Spam" })).status).toBe(200);
    refused(await aact(a.cookie, "pause-test", { id: s2.testId, note: "A report", since }), new RegExp(`^That test was already stopped ${byAtRe(b.user.email)}\\.$`));
    // The developer's own Stop names them.
    const s3 = await setup();
    expect((await act(s3.testId, "stop", s3.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    refused(await aact(a.cookie, "pause-test", { id: s3.testId, note: "A report", since }), new RegExp(`^That test was already stopped ${byAtRe(s3.dev.user.email)}\\.$`));
  });

  it("Lift the pause after another admin's Lift and Pause again stops once; the second press lifts it", async () => {
    const a = await admin(), b = await admin(), c = await admin();
    const s = await setup();
    expect((await aact(c.cookie, "pause-test", { id: s.testId, note: "Checking" })).status).toBe(200);
    const since = await loaded();
    expect((await aact(b.cookie, "unpause-test", { id: s.testId })).status).toBe(200);
    expect((await aact(c.cookie, "pause-test", { id: s.testId, note: "Checking again" })).status).toBe(200);
    const stop = await aact(a.cookie, "unpause-test", { id: s.testId, since });
    expectStop(stop, "Lift the pause", [line(b.user.email, "lifted the pause"), line(c.user.email, "paused the test")]);
    expect((await aact(a.cookie, "unpause-test", { id: s.testId, since, ...again(stop) })).status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: s.testId } })).adminPausedAt).toBeNull();
  });

  it("Lift the pause, Extend or Pause after another admin's Close now: refused naming who closed it and when", async () => {
    const a = await admin(), b = await admin();
    const s = await setup();
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking" })).status).toBe(200);
    const since = await loaded();
    expect((await aact(b.cookie, "close-paused", { id: s.testId })).status).toBe(200);
    const closed = new RegExp(`^That test was already closed ${byAtRe(b.user.email)}\\.$`);
    refused(await aact(a.cookie, "unpause-test", { id: s.testId, since }), closed);
    refused(await aact(a.cookie, "extend-pause", { id: s.testId, days: "7", since }), closed);
    refused(await aact(a.cookie, "close-paused", { id: s.testId, since }), closed);
    refused(await aact(a.cookie, "stop-test", { id: s.testId, note: "Spam", since }), closed);
  });

  it("Stop after another admin's Lift the pause, or after an Extend, stops once; the second press stops the test", async () => {
    const a = await admin(), b = await admin();
    const s = await setup(), s2 = await setup();
    for (const t of [s, s2]) expect((await aact(b.cookie, "pause-test", { id: t.testId, note: "Checking" })).status).toBe(200);
    const since = await loaded();
    expect((await aact(b.cookie, "unpause-test", { id: s.testId })).status).toBe(200);
    expect((await aact(b.cookie, "extend-pause", { id: s2.testId, days: "7" })).status).toBe(200);
    const stop = await aact(a.cookie, "stop-test", { id: s.testId, note: "Spam", since });
    expectStop(stop, "Stop (close)", [line(b.user.email, "lifted the pause")]);
    expect((await aact(a.cookie, "stop-test", { id: s.testId, note: "Spam", since, ...again(stop) })).status).toBe(200);
    const stop2 = await aact(a.cookie, "stop-test", { id: s2.testId, note: "Spam", since });
    expectStop(stop2, "Stop (close)", [line(b.user.email, "extended the closing date")]);
    expect((await aact(a.cookie, "stop-test", { id: s2.testId, note: "Spam", since, ...again(stop2) })).status).toBe(200);
    // Already stopped: who and when.
    refused(await aact(b.cookie, "stop-test", { id: s2.testId, note: "Spam", since }), new RegExp(`^That test was already stopped ${byAtRe(a.user.email)}\\.$`));
  });

  it("Close now after another admin's Extend stops once (the second press closes it); Extend after a Close now is refused", async () => {
    const a = await admin(), b = await admin();
    const s = await setup();
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking" })).status).toBe(200);
    const since = await loaded();
    expect((await aact(b.cookie, "extend-pause", { id: s.testId, days: "14" })).status).toBe(200);
    const stop = await aact(a.cookie, "close-paused", { id: s.testId, since });
    expectStop(stop, "Close now", [line(b.user.email, "extended the closing date")]);
    expect((await aact(a.cookie, "close-paused", { id: s.testId, since, ...again(stop) })).status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: s.testId } })).status).toBe("stopped");
    refused(await aact(b.cookie, "extend-pause", { id: s.testId, days: "7", since }), new RegExp(`^That test was already closed ${byAtRe(a.user.email)}\\.$`));
    // Extend after another admin's Extend: stops once too; and on a test whose pause was lifted: refused naming who lifted it.
    const s2 = await setup();
    expect((await aact(a.cookie, "pause-test", { id: s2.testId, note: "Checking" })).status).toBe(200);
    const since2 = await loaded();
    expect((await aact(b.cookie, "extend-pause", { id: s2.testId, days: "7" })).status).toBe(200);
    const stop2 = await aact(a.cookie, "extend-pause", { id: s2.testId, days: "7", since: since2 });
    expectStop(stop2, "Extend", [line(b.user.email, "extended the closing date")]);
    expect((await aact(a.cookie, "extend-pause", { id: s2.testId, days: "7", since: since2, ...again(stop2) })).status).toBe(200);
    expect((await aact(b.cookie, "unpause-test", { id: s2.testId })).status).toBe(200);
    refused(await aact(a.cookie, "close-paused", { id: s2.testId, since: since2 }), new RegExp(`^That test's pause was already lifted ${byAtRe(b.user.email)}\\.$`));
  });

  it("Allow changes again: after another admin's Allow it is refused naming who and when; after another change to the test it stops once", async () => {
    const a = await admin(), b = await admin();
    const s = await setup();
    const lock = () => db.test.update({ where: { id: s.testId }, data: { criticalCounts: { [CRITICAL_KEYS[0]]: 3 } } });
    await lock();
    const since = await loaded();
    expect((await aact(b.cookie, "allow-critical-changes", { id: s.testId, since })).status).toBe(200);
    refused(await aact(a.cookie, "allow-critical-changes", { id: s.testId, since }), new RegExp(`^That test's locked fields were already given 3 more changes ${byAtRe(b.user.email)}\\.$`));
    await lock();
    const since2 = await loaded();
    expect((await aact(b.cookie, "pause-test", { id: s.testId, note: "Checking" })).status).toBe(200);
    const stop = await aact(a.cookie, "allow-critical-changes", { id: s.testId, since: since2 });
    expectStop(stop, "Allow 3 more changes of the locked fields", [line(b.user.email, "paused the test")]);
    expect(lockedFields(countsOf((await db.test.findUniqueOrThrow({ where: { id: s.testId } })).criticalCounts))).toHaveLength(1);
    expect((await aact(a.cookie, "allow-critical-changes", { id: s.testId, since: since2, ...again(stop) })).status).toBe(200);
    expect(lockedFields(countsOf((await db.test.findUniqueOrThrow({ where: { id: s.testId } })).criticalCounts))).toHaveLength(0);
  });
});

// ---------- holds ----------

function stripeMock() {
  const pis = new Map<string, { status: string; amount: number; capture?: string }>();
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; capture_method?: string }) => {
        const id = "pi_" + randomUUID();
        const status = p.capture_method === "manual" ? "requires_capture" : "succeeded";
        pis.set(id, { status, amount: p.amount, capture: p.capture_method });
        return { id, status, client_secret: `${id}_secret` };
      },
      capture: async (id: string) => { const x = pis.get(id)!; x.status = "succeeded"; return { id, status: "succeeded" }; },
      cancel: async (id: string) => { const x = pis.get(id); if (x) x.status = "canceled"; return { id, status: "canceled" }; },
      retrieve: async (id: string) => ({ id, status: pis.get(id)?.status ?? "canceled", client_secret: `${id}_secret`, latest_charge: id.replace(/^pi_/, "ch_") }),
    },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
    refunds: { create: async () => ({ id: "re_" + randomUUID() }) },
  } as unknown as Stripe);
}
async function chargebackHeld() {
  const { dev, testId } = await setup();
  const { tester, sessionId } = await joined(testId);
  await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
  await db.user.update({ where: { id: tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 12), payoutsReady: true } });
  const row = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
  await startHold(dev.user.id, "chargeback");
  await db.user.update({ where: { id: dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
  const reserve = async () => expect((await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: { seenTotalCents: 800, seenIds: [row.id] } })).then(json)).body.reservedCents).toBe(800);
  return { dev, reserve };
}

describe("batch 34 §1: a hold (chargeback Approve ↔ Don't approve, a payment-hold lift after a Suspend)", () => {
  it("Approve after another admin's Don't approve (the developer reserved again since) stops once; the second press takes it and lifts the hold", async () => {
    stripeMock();
    const a = await admin(), b = await admin();
    const x = await chargebackHeld();
    await x.reserve();
    const since = await loaded();
    expect((await aact(b.cookie, "decline-chargeback", { id: x.dev.user.id, note: "Call us first" })).body.releasedCents).toBe(800);
    // Nothing reserved now: Approve is refused, naming who released it and when.
    refused(await aact(a.cookie, "approve-chargeback", { id: x.dev.user.id, since }), new RegExp(`^Not yet: nothing is reserved \\(\\$8\\.00 is owed; ${esc(b.user.email)} released it at ${T}\\)\\.$`));
    refused(await aact(a.cookie, "decline-chargeback", { id: x.dev.user.id, since }), new RegExp(`^Nothing is reserved on that account \\(${esc(b.user.email)} released it at ${T}\\)\\.$`));
    await x.reserve();
    const stop = await aact(a.cookie, "approve-chargeback", { id: x.dev.user.id, since });
    expectStop(stop, "Approve", [line(b.user.email, "didn't approve lifting the hold (the reservation was released)")]);
    expect((await db.user.findUniqueOrThrow({ where: { id: x.dev.user.id } })).holdStartedAt).not.toBeNull();
    const go = await aact(a.cookie, "approve-chargeback", { id: x.dev.user.id, since, ...again(stop) });
    expect(go.status).toBe(200);
    expect(go.body.lifted).toBe(true);
  });

  it("Don't approve (or Approve) after another admin's Approve: “That hold was already approved (by … at …).”", async () => {
    stripeMock();
    const a = await admin(), b = await admin();
    const x = await chargebackHeld();
    await x.reserve();
    const since = await loaded();
    expect((await aact(b.cookie, "approve-chargeback", { id: x.dev.user.id })).status).toBe(200);
    const approved = new RegExp(`^That hold was already approved ${byAtRe(b.user.email)}\\.$`);
    refused(await aact(a.cookie, "decline-chargeback", { id: x.dev.user.id, since }), approved);
    refused(await aact(a.cookie, "approve-chargeback", { id: x.dev.user.id, since }), approved);
  });

  it("Don't approve after another admin's Don't approve (reserved again since) stops once; the second press releases it", async () => {
    stripeMock();
    const a = await admin(), b = await admin();
    const x = await chargebackHeld();
    await x.reserve();
    const since = await loaded();
    expect((await aact(b.cookie, "decline-chargeback", { id: x.dev.user.id })).status).toBe(200);
    await x.reserve();
    const stop = await aact(a.cookie, "decline-chargeback", { id: x.dev.user.id, since });
    expectStop(stop, "Don't approve: release the reservation", [line(b.user.email, "didn't approve lifting the hold (the reservation was released)")]);
    expect((await aact(a.cookie, "decline-chargeback", { id: x.dev.user.id, since, ...again(stop) })).body.releasedCents).toBe(800);
  });

  it("Approve a payment-hold lift after another admin's Suspend stops once; the second press approves; a second Approve names the first", async () => {
    const a = await admin(), b = await admin();
    const d = await makeUser({ name: "Nora Lane", dev: true });
    await db.user.update({ where: { id: d.user.id }, data: { holdStartedAt: new Date(), holdReason: "unpaid", holdCount: 4 } });
    const since = await loaded();
    expect((await aact(b.cookie, "suspend", { id: d.user.id, side: "developer", note: "Fraud reports" })).status).toBe(200);
    const stop = await aact(a.cookie, "approve-hold", { id: d.user.id, note: "", since });
    expectStop(stop, "Approve", [line(b.user.email, "suspended the developer side")]);
    expect((await db.user.findUniqueOrThrow({ where: { id: d.user.id } })).holdApprovedAt).toBeNull();
    expect((await aact(a.cookie, "approve-hold", { id: d.user.id, note: "", since, ...again(stop) })).status).toBe(200);
    refused(await aact(b.cookie, "approve-hold", { id: d.user.id, note: "", since }), /^This lift was already approved by Team Member at .+\.$/);
  });
});

describe("batch 34 §1: an outage, and Mark replied", () => {
  it("a possible outage's Approve after another admin's Dismiss (and Dismiss after Approve) is refused naming who and when", async () => {
    const a = await admin(), b = await admin();
    const start = new Date(Date.now() - 3 * 3_600_000 - Math.floor(Math.random() * 1e6)), end = new Date(start.getTime() + 40 * 60_000);
    const g1 = `gap:${start.toISOString()}`;
    await db.appState.create({ data: { key: g1, value: end.toISOString() } });
    const since = await loaded();
    expect((await aact(b.cookie, "dismiss-gap", { id: g1, since })).status).toBe(200);
    refused(await aact(a.cookie, "approve-gap", { id: g1, since }), new RegExp(`^That possible outage was already dismissed ${byAtRe(b.user.email)}\\.$`));
    const s2 = new Date(start.getTime() - 5 * 3_600_000), g2 = `gap:${s2.toISOString()}`;
    await db.appState.create({ data: { key: g2, value: new Date(s2.getTime() + 30 * 60_000).toISOString() } });
    expect((await aact(b.cookie, "approve-gap", { id: g2, since })).status).toBe(200);
    refused(await aact(a.cookie, "dismiss-gap", { id: g2, since }), new RegExp(`^That possible outage was already approved ${byAtRe(b.user.email)}\\.$`));
    // An outage over 24 hours: a second Approve names the first.
    const s3 = new Date(s2.getTime() - 40 * 3_600_000);
    const o = await db.outage.create({ data: { startAt: s3, endAt: new Date(s3.getTime() + 25 * 3_600_000), ms: 25 * 3_600_000, needsApproval: true } });
    expect((await aact(b.cookie, "approve-outage", { id: o.id, since })).status).toBe(200);
    refused(await aact(a.cookie, "approve-outage", { id: o.id, since }), new RegExp(`^That outage was already approved ${byAtRe(b.user.email)}\\.$`));
  });

  it("Mark replied after another admin's: refused naming who and when", async () => {
    const a = await admin(), b = await admin();
    const u = await makeUser({ name: "Ana Silva", tester: true });
    const m = await db.contactMessage.create({ data: { userId: u.user.id, topic: "Payments", message: "Where is my payout?" } });
    const since = await loaded();
    expect((await aact(b.cookie, "contact-replied", { id: m.id, since })).status).toBe(200);
    refused(await aact(a.cookie, "contact-replied", { id: m.id, since }), new RegExp(`^${esc(b.user.email)} already marked this replied at ${T}\\.$`));
  });
});

describe("batch 34 §1: the pages send their time and show the stop box", () => {
  it("every admin row carries when it was read; the buttons send it as `since`, and the second press its box's time", async () => {
    const a = await admin();
    const before = new Date().toISOString();
    const s = await setup();
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking" })).status).toBe(200);
    const row = ((await adminPage("mypaused", a.user.id, null)).rows as TestVM[]).find((r) => r.id === s.testId)!;
    expect(row.seen! >= before).toBe(true);
    expect(src("app/admin/PagedList.tsx")).toMatch(/action="unpause-test"[^>]*extra=\{since\(t\)\}/);
    for (const a2 of ["stop-test", "allow-critical-changes", "extend-pause", "close-paused", "approve-chargeback", "decline-chargeback", "contact-replied"]) expect(src("app/admin/PagedList.tsx")).toMatch(new RegExp(`action="${a2}"[^\\n]*extra=\\{since\\(\\w\\)\\}`));
    expect(src("app/admin/PagedList.tsx")).toContain('api("/api/admin/approve-hold", { id, note, ...(seen ? { since: seen } : {}), ...stop.marks() })');
    expect(src("app/admin/AccountActions.tsx")).toContain('action="delete-account" id={acct.id} label="Delete account" danger extra={{ since: acct.at }}');
    expect(src("app/admin/TeamCloseBox.tsx")).toContain("since: preview.at, ...stop.marks()");
    expect(src("app/admin/page.tsx")).toMatch(/action="approve-gap"[^\n]*extra=\{\{ since: seenAt \}\}/);
    // The stop box is the app's own (ChangesBox) under the button, "Since this page loaded:", the press named; the second press is confirmed with the box's time.
    expect(src("app/admin/AdminButton.tsx")).toContain("<ChangesBox changes={stop.changes} press={label} heading={ADMIN_STOP_HEADING} />");
    expect(src("lib/adminStop.ts")).toContain('export const ADMIN_STOP_HEADING = "Since this page loaded:"');
    expect(src("lib/adminStop.ts")).toContain("confirmed: true, ...(boxAt ? { boxAt } : {})");
  });

  it("a test's admin box has its own actions: Pause or Lift the pause, Stop, Allow changes when locked, and Extend / Close now while paused", () => {
    const html = renderToStaticMarkup(createElement(TestActions, { id: "t1", seen: new Date().toISOString(), adminPaused: true, stopped: false, critical: 1, closure: "Closes in 7 days (Fri, Nov 6, 3:10 PM)" }));
    for (const l of ["Lift the pause", "Stop (close)", "Allow 3 more changes of the locked fields", "Extend", "Close now", "Closes in 7 days"]) expect(html).toContain(l);
    expect(html).not.toContain(">Pause<");
    const open = renderToStaticMarkup(createElement(TestActions, { id: "t1", seen: new Date().toISOString(), adminPaused: false, stopped: false, critical: 0, closure: null }));
    expect(open).toContain(">Pause<");
    expect(open).not.toContain("Close now");
    expect(renderToStaticMarkup(createElement(TestActions, { id: "t1", seen: "", adminPaused: false, stopped: true, critical: 0, closure: null }))).toBe("");
  });

  it("a refusal's time is the time alone within a day, the date too when older", () => {
    const now = new Date();
    expect(whenText(new Date(now.getTime() - 60_000))).toMatch(new RegExp(`^${T}$`));
    expect(whenText(new Date(now.getTime() - 3 * 86_400_000))).toMatch(/^\w{3}, \w{3} \d{1,2}, \d{1,2}:\d{2}\s[AP]M$/);
  });
});

describe("batch 34 §4: no Reinstate of the developer side during a payment or chargeback hold", () => {
  it("a payment hold: the developer side's Reinstate is a note and the server refuses an old page's press; the tester side reinstates; after the hold, Reinstate is back", async () => {
    const a = await admin();
    const x = await devOf();
    for (const side of ["developer", "tester"]) expect((await aact(a.cookie, "suspend", { id: x.user.id, side, note: "Fraud reports" })).status).toBe(200);
    await startHold(x.user.id, "unpaid");
    const st = (await accountState(x.user.id))!;
    expect(st.held).toBe("payment");
    const html = renderToStaticMarkup(createElement(AccountActions, { initial: st }));
    expect(html).toContain("Reinstate waits for the payment hold: they pay what they owe first.");
    expect(html.match(/>Reinstate</g)).toHaveLength(1); // the tester side's only
    expect(reinstateHeldLine("payment")).toBe("That developer is on a payment hold: it has to clear before the developer side can be reinstated.");
    const r = await aact(a.cookie, "unsuspend", { id: x.user.id, side: "developer", since: st.at, from: "page" });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "on_hold", message: reinstateHeldLine("payment") });
    expect((await db.user.findUniqueOrThrow({ where: { id: x.user.id } })).devSuspendedAt).not.toBeNull();
    expect((await aact(a.cookie, "unsuspend", { id: x.user.id, side: "tester", since: st.at, from: "page" })).status).toBe(200);
    await db.user.update({ where: { id: x.user.id }, data: { holdStartedAt: null, holdReason: "" } });
    const after = (await accountState(x.user.id))!;
    expect(after.held).toBe("");
    expect(renderToStaticMarkup(createElement(AccountActions, { initial: after }))).not.toContain("Reinstate waits");
    expect((await aact(a.cookie, "unsuspend", { id: x.user.id, side: "developer", since: after.at, from: "page" })).status).toBe(200);
  });

  it("a chargeback hold: “Reinstate waits for the chargeback hold: the team approves it first.” and the refusal names the chargeback hold", async () => {
    const a = await admin();
    const x = await devOf();
    expect((await aact(a.cookie, "suspend", { id: x.user.id, side: "developer", note: "Fraud reports" })).status).toBe(200);
    await startHold(x.user.id, "chargeback");
    const st = (await accountState(x.user.id))!;
    expect(st.held).toBe("chargeback");
    expect(renderToStaticMarkup(createElement(AccountActions, { initial: st }))).toContain("Reinstate waits for the chargeback hold: the team approves it first.");
    const r = await aact(a.cookie, "unsuspend", { id: x.user.id, side: "developer" });
    expect(r.body.error).toMatchObject({ code: "on_hold", message: "That developer is on a chargeback hold: it has to clear before the developer side can be reinstated." });
  });
});