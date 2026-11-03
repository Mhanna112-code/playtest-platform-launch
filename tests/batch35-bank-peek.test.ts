import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { setStripeForTests } from "@/lib/server/stripe";
import { stillWaiting } from "@/lib/server/bankPeek";
import { peekBank, watchBank, type PeekAnswer } from "@/lib/bankConfirm";
import { BANK_CANCEL, CANCEL_HINTS } from "@/lib/bankNotice";
import { BankCheckView } from "@/components/BankCheck";
import { json, makeUser, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 3, batch 35 §158) The bank check finishes by itself even when the return page is blocked (on localhost Chrome's Private Network Access stops Stripe's
// public page from sending the frame back): while the bank's page is open the page peeks (read-only) every few seconds and ends the check once Stripe stops waiting.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const CHECK_URL = "https://hooks.stripe.com/3d_secure_2/hosted?fake=1";
const RETURN_URL = "http://localhost:3400/api/payments/bank-return";
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const confirm = (cookie: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, body })).then(json);
const peek = (cookie: string, body: Record<string, unknown>) => confirm(cookie, { ...body, peek: true });
const withCard = (userId: string) => db.user.update({ where: { id: userId }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
afterEach(() => {
  setStripeForTests(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
(globalThis as unknown as { React: typeof React }).React = React;

/** A Stripe stand-in whose presses wait for the bank's page; it records every call that would change anything. */
function fakeStripe() {
  const status = new Map<string, { status: string; last_payment_error?: unknown }>();
  const changed: string[] = [];
  const setups = new Map<string, Record<string, unknown>>();
  setStripeForTests({
    paymentIntents: {
      create: async (p: Record<string, unknown>) => {
        const id = "pi_" + randomUUID();
        status.set(id, { status: "requires_action" });
        void p;
        return { id, status: "requires_action", client_secret: `${id}_secret`, next_action: { type: "redirect_to_url", redirect_to_url: { url: CHECK_URL, return_url: RETURN_URL } } };
      },
      retrieve: async (id: string) => ({ id, client_secret: `${id}_secret`, ...(status.get(id) ?? { status: "succeeded" }) }),
      confirm: async (id: string) => { changed.push(`confirm ${id}`); return { id, status: "requires_action" }; },
      cancel: async (id: string) => { changed.push(`cancel ${id}`); status.set(id, { status: "canceled" }); return { id, status: "canceled" }; },
      capture: async (id: string) => { changed.push(`capture ${id}`); return { id, status: "succeeded" }; },
    },
    setupIntents: {
      retrieve: async (id: string) => {
        const si = setups.get(id);
        if (!si) throw Object.assign(new Error("No such setupintent"), { code: "resource_missing" });
        return si;
      },
      confirm: async (id: string) => { changed.push(`confirm ${id}`); return { id }; },
      cancel: async (id: string) => { changed.push(`cancel ${id}`); return { id }; },
    },
    refunds: { create: async () => { changed.push("refund"); return { id: "re_" + randomUUID() }; } },
    transfers: { create: async () => { changed.push("transfer"); return { id: "tr_" + randomUUID() }; } },
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
  } as unknown as Stripe);
  return { status, changed, setups };
}

/** Written answers sent on a test (listed at $10). */
async function sentWork() {
  const s = await setup({ writtenCents: "10.00" });
  const j = await joined(s.testId);
  const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
  await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}

describe("§158 the peek: read-only, the developer's own only", () => {
  it("waiting stays waiting (nothing finished, cancelled or charged, however often it's asked); once the bank finished it says done, and only the finish pays", async () => {
    const { dev, tester, sub } = await sentWork();
    await withCard(dev.user.id);
    const st = fakeStripe();
    const r = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.body).toMatchObject({ requiresAction: true, checkUrl: CHECK_URL });
    const before = await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } });
    expect(before).toMatchObject({ status: "needs_action" });
    for (let i = 0; i < 3; i++) {
      const w = await peek(dev.cookie, { paymentId: r.body.paymentId });
      expect(w.status).toBe(200);
      expect(w.body).toEqual({ status: "waiting" });
    }
    expect(await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } })).toEqual(before);
    expect(st.changed).toEqual([]);
    // The bank refused on its page: back to requires_payment_method with the error. Done, but the peek still changes nothing (the finish releases it).
    st.status.set(before.actionPi!, { status: "requires_payment_method", last_payment_error: { code: "payment_intent_authentication_failure" } });
    expect((await peek(dev.cookie, { paymentId: r.body.paymentId })).body).toEqual({ status: "done" });
    expect(await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } })).toEqual(before);
    // The bank confirmed: done; still nothing paid until the page's finish runs.
    st.status.set(before.actionPi!, { status: "succeeded" });
    expect((await peek(dev.cookie, { paymentId: r.body.paymentId })).body).toEqual({ status: "done" });
    expect(await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } })).toEqual(before);
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { startsWith: "Nora Lane paid you" } } })).toBe(0);
    expect(st.changed).toEqual([]);
    // The finish (what end() calls) pays it once; a later peek says done (nothing waits) and changes nothing.
    expect((await confirm(dev.cookie, { paymentId: r.body.paymentId })).status).toBe(200);
    const paid = await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } });
    expect(paid).toMatchObject({ status: "charged", actionPi: null });
    expect((await peek(dev.cookie, { paymentId: r.body.paymentId })).body).toEqual({ status: "done" });
    expect(await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } })).toEqual(paid);
  });

  it("someone else's payment, reservation or card check is refused, and left as it was", async () => {
    const { dev, sub } = await sentWork();
    await withCard(dev.user.id);
    const st = fakeStripe();
    const r = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    const before = await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } });
    const other = await makeUser({ dev: true, name: "Omar Reed" });
    const no = await peek(other.cookie, { paymentId: r.body.paymentId });
    expect(no.status).toBe(404);
    expect(no.body.error).toMatchObject({ code: "not_found" });
    expect((await peek(other.cookie, { paymentId: "nope" })).status).toBe(404);
    expect((await peek(other.cookie, {})).status).toBe(404);
    // A chargeback hold's reservation is answered only for its developer.
    const pi = "pi_" + randomUUID();
    st.status.set(pi, { status: "requires_action" });
    const res = await db.reservation.create({ data: { developerId: dev.user.id, amountCents: 1000, covers: [], status: "needs_action", stripePaymentIntentId: pi } });
    expect((await peek(dev.cookie, { paymentId: res.id })).body).toEqual({ status: "waiting" });
    st.status.set(pi, { status: "requires_capture" });
    expect((await peek(dev.cookie, { paymentId: res.id })).body).toEqual({ status: "done" });
    expect((await peek(other.cookie, { paymentId: res.id })).status).toBe(404);
    expect(await db.reservation.findUniqueOrThrow({ where: { id: res.id } })).toMatchObject({ status: "needs_action" });
    // Verify a card's SetupIntent: its developer's only.
    st.setups.set("seti_1", { id: "seti_1", status: "requires_action", metadata: { userId: dev.user.id, purpose: "chargeback-verify" } });
    expect((await peek(dev.cookie, { setupIntent: "seti_1" })).body).toEqual({ status: "waiting" });
    const theirs = await peek(other.cookie, { setupIntent: "seti_1" });
    expect(theirs.status).toBe(403);
    expect(theirs.body.error).toMatchObject({ code: "bad_setup" });
    st.setups.set("seti_1", { id: "seti_1", status: "succeeded", metadata: { userId: dev.user.id, purpose: "chargeback-verify" } });
    expect((await peek(dev.cookie, { setupIntent: "seti_1" })).body).toEqual({ status: "done" });
    expect((await peek(dev.cookie, { setupIntent: "seti_gone" })).body).toEqual({ status: "done" }); // unknown to Stripe: nothing waits (the finish says not verified)
    expect(await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } })).toEqual(before);
    expect(st.changed).toEqual([]);
  });

  it("which Stripe statuses still wait for the customer", () => {
    for (const s of ["requires_action", "requires_confirmation"]) expect(stillWaiting({ status: s })).toBe(true);
    expect(stillWaiting({ status: "requires_payment_method" })).toBe(true); // not tried yet
    expect(stillWaiting({ status: "requires_payment_method", last_payment_error: { code: "x" } })).toBe(false); // the attempt failed
    expect(stillWaiting({ status: "requires_payment_method", last_setup_error: { code: "x" } })).toBe(false);
    for (const s of ["succeeded", "requires_capture", "processing", "canceled"]) expect(stillWaiting({ status: s })).toBe(false);
  });
});

describe("§158 the page polls while the bank's page is open", () => {
  it("peeks every 3 seconds (a read-only POST with peek: true) and ends the check once, when the peek says done; a failed peek just asks again", async () => {
    vi.useFakeTimers();
    const answers: (PeekAnswer | "error" | "offline")[] = ["waiting", "error", "offline", "waiting", "done"];
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
      expect(url).toBe("/api/payments/confirm");
      bodies.push(JSON.parse(init.body));
      const a = answers.shift() ?? "done";
      if (a === "offline") throw new TypeError("Failed to fetch");
      if (a === "error") return new Response(JSON.stringify({ error: { code: "x", message: "x" } }), { status: 500 });
      return new Response(JSON.stringify({ status: a }), { status: 200 });
    }));
    const onDone = vi.fn();
    const stop = watchBank(() => peekBank({ paymentId: "pay_1" }), onDone);
    await vi.advanceTimersByTimeAsync(2999);
    expect(bodies).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(bodies).toEqual([{ paymentId: "pay_1", peek: true }]);
    await vi.advanceTimersByTimeAsync(3000 * 3);
    expect(bodies).toHaveLength(4);
    expect(onDone).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(bodies).toHaveLength(5);
    expect(onDone).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(bodies).toHaveLength(5); // stopped once done
    expect(onDone).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops when the box closes (no more peeks, never ends it)", async () => {
    vi.useFakeTimers();
    const peekFn = vi.fn(async (): Promise<PeekAnswer> => "waiting");
    const onDone = vi.fn();
    const stop = watchBank(peekFn, onDone);
    await vi.advanceTimersByTimeAsync(6000);
    expect(peekFn).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(peekFn).toHaveBeenCalledTimes(2);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a Verify a card peek asks about its SetupIntent", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ status: "done" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);
    expect(await peekBank({ setupIntent: "seti_1" })).toEqual({ status: "done" });
    expect(JSON.parse((fetchFn.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ setupIntent: "seti_1", peek: true });
  });

  it("the bank's frame: Cancel with its hint (§160; was Close), and the watch wired to end(); the stand-in keeps Confirm / Cancel; every check's peek fits its kind", () => {
    const action = { requiresAction: true as const, paymentId: "p1", clientSecret: "", publishableKey: "", simulated: false, checkUrl: CHECK_URL };
    const real = renderToStaticMarkup(createElement(BankCheckView, { action, finish: async () => ({}), onEnd: () => {}, peek: async () => "waiting" as const }));
    expect(BANK_CANCEL).toBe("Cancel");
    expect(CANCEL_HINTS.press).toBe("Already finished with your bank? It's recorded as paid; otherwise nothing is charged.");
    expect(real).toContain(">Cancel</button>");
    expect(real).toContain("Already finished with your bank? It&#x27;s recorded as paid; otherwise nothing is charged.");
    expect(real.match(/<button/g)).toHaveLength(1); // only Cancel: no stand-in Confirm
    expect(real).toMatch(/<iframe [^>]*>.*data-bank-close-hint.*data-bank-close=/s);
    const standIn = renderToStaticMarkup(createElement(BankCheckView, { action: { ...action, simulated: true, checkUrl: null }, finish: async () => ({}), onEnd: () => {} }));
    expect(standIn).toMatch(/>Confirm<\/button>.*>Cancel<\/button>/);
    expect(standIn).not.toContain(CANCEL_HINTS.press.slice(0, 20));
    const bc = src("components/BankCheck.tsx");
    expect(bc).toContain("return watchBank(() => peek(opened.current), () => void end(), undefined, (r) => setNotice((n) => addNews(n, r)));");
    expect(bc).toMatch(/if \(!action\.checkUrl \|\| !peek\) return;/);
    // The default peek is the payment's (or reservation's) own id; Verify a card passes its SetupIntent's.
    expect(bc).toContain("peek ?? (!finish && a.paymentId ? (since: string) => peekBank({ paymentId: a.paymentId }, since) : undefined)");
    expect(src("components/ChargebackSteps.tsx")).toContain("finish(setupIntent), (since) => peekBank({ setupIntent }, since)");
    // The route answers a peek before anything that changes a payment.
    const route = src("app/api/payments/confirm/route.ts");
    expect(route.indexOf("body.peek === true")).toBeGreaterThan(0);
    expect(route.indexOf("body.peek === true")).toBeLessThan(route.indexOf("confirmStart(u"));
    expect(route.indexOf("body.peek === true")).toBeLessThan(route.indexOf("confirmFinish(u"));
    // The peek module only reads.
    const peekSrc = src("lib/server/bankPeek.ts");
    expect(peekSrc).not.toMatch(/\.(update|updateMany|create|delete|deleteMany|upsert|cancel|confirm|capture)\(|\b(release|finish|expire|fakeConfirm)\w*\(/);
  });
});
