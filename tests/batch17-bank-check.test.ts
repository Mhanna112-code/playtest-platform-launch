import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as verifyPOST } from "@/app/api/payments/verify-card/route";
import { GET as bankReturn } from "@/app/api/payments/bank-return/route";
import * as R from "@/lib/rules";
import { owed, retryOwed, startHold, chargebackOpened } from "@/lib/server/holds";
import { bankWaitingOnTest, confirmItems } from "@/lib/server/confirm";
import { setStripeForTests } from "@/lib/server/stripe";
import { BankCheckView } from "@/components/BankCheck";
import { BankWaiting } from "@/components/BankWaiting";
import { ConfirmList } from "@/app/app/payments/ConfirmList";
import { json, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 17 §11 (owner, Oct 28): the bank's check (3D Secure) opens INLINE, directly under the button that charges (Pay, Pay more, Pay what you owe, Subscribe, Verify a
// card); a charge made while the developer was away is confirmed on the TEST PAGE under its piece ("Confirm with your bank"), and Payments and the bell line link there.
// The fake Stripe draws a clearly-marked stand-in in the same place.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const DAY = 86_400_000;
const RETURN_URL = "http://localhost:3400/api/payments/bank-return";
const CHECK_URL = "https://hooks.stripe.com/3d_secure_2/hosted?fake=1";
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const more = (testId: string, cookie: string, body: Record<string, unknown>) => act(testId, "pay-extra", cookie, { seenAt: seen(), confirmed: true, payKey: randomUUID(), ...body });
const confirm = (cookie: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, body })).then(json);
const verify = (cookie: string, body: Record<string, unknown>) => verifyPOST(req("/api/payments/verify-card", { cookie, body })).then(json);
const withCard = (userId: string) => db.user.update({ where: { id: userId }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
afterEach(() => setStripeForTests(null));
// The components are compiled for the browser's JSX runtime; rendering them here needs React in scope.
(globalThis as unknown as { React: typeof React }).React = React;

/**
 * A Stripe stand-in. "action": a press waits for the bank (with `page`, Stripe hands back the bank's check page as redirect_to_url); "away-action": a charge made while
 * away is refused with authentication_required. `status` is what retrieve answers for each PaymentIntent (the test plays the bank by setting it).
 */
function fakeStripe(opts: { mode?: "ok" | "action" | "away-action"; page?: boolean } = {}) {
  const made: Record<string, unknown>[] = [];
  const confirmed: Record<string, unknown>[] = [];
  const status = new Map<string, string>();
  const cancelled: string[] = [];
  const next = () => (opts.page ? { next_action: { type: "redirect_to_url", redirect_to_url: { url: CHECK_URL, return_url: RETURN_URL } } } : {});
  setStripeForTests({
    paymentIntents: {
      create: async (p: Record<string, unknown>) => {
        made.push(p);
        const id = "pi_" + randomUUID();
        const mode = opts.mode ?? "ok";
        if (mode === "action" && !p.off_session) {
          status.set(id, "requires_action");
          return { id, status: "requires_action", client_secret: `${id}_secret`, ...next() };
        }
        if ((mode === "action" || mode === "away-action") && p.off_session) {
          status.set(id, "requires_payment_method");
          throw Object.assign(new Error("Authentication required."), { code: "authentication_required", raw: { payment_intent: { id, client_secret: `${id}_secret` } } });
        }
        status.set(id, "succeeded");
        return { id, status: "succeeded" };
      },
      retrieve: async (id: string) => ({ id, status: status.get(id) ?? "succeeded", client_secret: `${id}_secret` }),
      confirm: async (id: string, p: Record<string, unknown>) => {
        confirmed.push({ id, ...p });
        status.set(id, "requires_action");
        return { id, status: "requires_action", client_secret: `${id}_secret`, ...next() };
      },
      cancel: async (id: string) => { cancelled.push(id); status.set(id, "canceled"); return { id, status: "canceled" }; },
    },
    refunds: { create: async () => ({ id: "re_" + randomUUID() }) },
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
  } as unknown as Stripe);
  return { made, confirmed, cancelled, status, bank: (id: string, ok: boolean) => status.set(id, ok ? "succeeded" : "canceled") };
}

/** Written answers sent on a test (listed at $10). */
async function sentWork(over: Record<string, unknown> = {}) {
  const s = await setup({ writtenCents: "10.00", ...over });
  const j = await joined(s.testId);
  const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
  await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}
const chargeOpen = (subId: string) => db.submission.update({ where: { id: subId }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });

describe("batch 17 §11: the bank's check opens inline, under the button", () => {
  it("the fake draws a clearly-marked stand-in (Confirm / Cancel); a real check is the bank's page in a frame with Cancel; no pop-up anywhere", () => {
    const action = { requiresAction: true as const, paymentId: "p1", clientSecret: "", publishableKey: "", simulated: true, checkUrl: null };
    const standIn = renderToStaticMarkup(createElement(BankCheckView, { action, finish: async () => ({}), onEnd: () => {} }));
    expect(standIn).toContain('data-bank-check="stand-in"');
    expect(standIn).toContain("Stand-in for your bank&#x27;s check");
    expect(standIn).toMatch(/>Confirm<\/button>.*>Cancel<\/button>/);
    const real = renderToStaticMarkup(createElement(BankCheckView, { action: { ...action, simulated: false, checkUrl: CHECK_URL }, finish: async () => ({}), onEnd: () => {} }));
    expect(real).toContain('data-bank-check="bank"');
    expect(real).toContain(`<iframe src="${CHECK_URL.replace(/&/g, "&amp;")}" title="Your bank&#x27;s check"`);
    expect(real).toContain(">Cancel</button>");
    // Under the button that was pressed: Pay / Pay more, Pay what you owe, Subscribe (PressButton) and Verify a card each render the check right after their button.
    expect(src("app/app/tests/[id]/PayBox.tsx")).toMatch(/at least \$0\.50 \(or 0\)<\/span>\s*<\/div>\s*\{bank\.view\}/);
    expect(src("components/OwedBox.tsx")).toMatch(/<\/button>\}\s*\{bank\.view\}/);
    expect(src("components/PressButton.tsx")).toMatch(/<\/button>\s*\{bank\.view\}/);
    expect(src("components/ChargebackSteps.tsx")).toContain("{bank.view}");
    expect(src("lib/bankConfirm.ts")).not.toContain("window.confirm");
    for (const f of ["app/app/tests/[id]/PayBox.tsx", "components/OwedBox.tsx", "components/PressButton.tsx", "app/app/payments/ConfirmList.tsx"]) expect(src(f)).not.toContain("confirmWithBank");
  });

  it("the bank's page returns into the frame and tells the page; only that path may be framed, and only by this site", async () => {
    const html = await (await bankReturn()).text();
    expect(html).toContain('postMessage({bankCheck:"done"},window.location.origin)');
    const cfg = (await import("../next.config")).default;
    const all = await cfg.headers!();
    const ret = all.find((x) => x.source === "/api/payments/bank-return")!;
    const h = Object.fromEntries(ret.headers.map((x) => [x.key, x.value]));
    expect(h["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
    expect(all[0].headers.find((x) => x.key === "Content-Security-Policy")!.value).toContain("frame-src 'self' https://js.stripe.com");
    expect(all[0].headers.find((x) => x.key === "Content-Security-Policy")!.value).toContain("frame-ancestors 'none'");
  });
});

describe("batch 17 §11: Pay with a check", () => {
  it("confirmed: the press asks Stripe with return_url, the page gets the bank's page to show inline (or the stand-in), and Confirm puts it through", async () => {
    const { dev, tester, sub } = await sentWork();
    await withCard(dev.user.id);
    const st = fakeStripe({ mode: "action", page: true });
    const r = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ requiresAction: true, checkUrl: CHECK_URL });
    expect(st.made[0]).toMatchObject({ allowed_payment_method_types: ["card"], return_url: RETURN_URL });
    expect(st.made[0].off_session).toBeUndefined();
    st.bank((await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } })).actionPi!, true); // the bank's page finished: Stripe says it went through
    const done = await confirm(dev.cookie, { paymentId: r.body.paymentId });
    expect(done.status).toBe(200);
    expect(await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } })).toMatchObject({ status: "charged", actionPi: null });
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { startsWith: "Nora Lane paid you $10.00 for your written answers" } } })).toBe(1);
  });

  it("the stand-in's Confirm (fake Stripe: no page to show) puts Pay more through", async () => {
    const { dev, testId, sessionId, sub } = await sentWork();
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200); // paid without Stripe
    await withCard(dev.user.id);
    fakeStripe({ mode: "action" });
    const r = await more(testId, dev.cookie, { contractId: sessionId, submissionId: sub.id, amount: "5.00", tickedCents: 500, note: "Thanks" });
    expect(r.body).toMatchObject({ requiresAction: true, simulated: true, checkUrl: null });
    setStripeForTests(null); // the fake's stand-in: its answer decides
    const done = await confirm(dev.cookie, { paymentId: r.body.paymentId, simulate: "succeeded" });
    expect(done.status).toBe(200);
    expect(await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } })).toMatchObject({ status: "charged", kind: "extra" });
  });

  it("cancelled: nothing was charged, no hold, the line shows under the button and the piece is free again", async () => {
    const { dev, sub } = await sentWork();
    await withCard(dev.user.id);
    const st = fakeStripe({ mode: "action" });
    const r = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    const pi = (await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } })).actionPi!;
    const no = await confirm(dev.cookie, { paymentId: r.body.paymentId, simulate: "failed" });
    expect(no.status).toBe(402);
    expect(no.body.error).toMatchObject({ code: "not_confirmed", message: R.BANK_NOT_CONFIRMED });
    expect(st.cancelled).toContain(pi);
    expect(await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } })).toMatchObject({ status: "cancelled", actionPi: null });
    expect(await db.review.count({ where: { submissionId: sub.id } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).toBeNull();
    // Pressed again and confirmed: paid once.
    const again = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    st.bank((await db.payment.findUniqueOrThrow({ where: { id: again.body.paymentId } })).actionPi!, true);
    expect((await confirm(dev.cookie, { paymentId: again.body.paymentId })).status).toBe(200);
    expect(await db.payment.count({ where: { submissionId: sub.id, status: "charged" } })).toBe(1);
  });
});

describe("batch 17 §11: the piece stays locked while the check is open", () => {
  it("a tester's Charge or Let it go on it is refused until the check ends; the button stays disabled and the page's live refresh waits", async () => {
    const { dev, tester, sessionId, sub } = await sentWork();
    await withCard(dev.user.id);
    await chargeOpen(sub.id);
    fakeStripe({ mode: "action" });
    const r = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.body.requiresAction).toBe(true);
    for (const choice of ["charge", "letgo"]) {
      const c = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice, tickedCents: 1000, seenAt: seen(), confirmed: true });
      expect(c.body.error.message).toBe(R.PIECE_LOCKED);
    }
    // The stand-in's Cancel: free again (nothing charged), so the tester's choice goes through.
    expect((await confirm(dev.cookie, { paymentId: r.body.paymentId, simulate: "failed" })).status).toBe(402);
    const letgo = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "letgo", seenAt: seen(), confirmed: true });
    expect(letgo.status).toBe(200);
    // In the page: the pressed button is disabled while its check is open, and the live refresh waits for it.
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain("disabled={busy || bank.open ||");
    expect(src("components/AutoRefresh.tsx")).toContain("if (refresh && bankCheckOpen()) return;");
  });
});

describe("batch 17 §11: Pay what you owe with a check", () => {
  async function held() {
    const s = await sentWork();
    await withCard(s.dev.user.id);
    const row = await db.payment.create({ data: { kind: "review", submissionId: s.sub.id, contractId: s.sessionId, developerId: s.dev.user.id, testerId: s.tester.user.id, amountCents: 800, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    await startHold(s.dev.user.id, "unpaid");
    return { ...s, row };
  }

  it("confirmed under the button: paid and the hold lifts", async () => {
    const { dev, row } = await held();
    const st = fakeStripe({ mode: "action", page: true });
    const r = await json(await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: {} })));
    expect(r.status).toBe(200);
    expect(r.body.confirm).toHaveLength(1);
    expect(r.body.confirm[0]).toMatchObject({ requiresAction: true, paymentId: row.id, checkUrl: CHECK_URL });
    expect(st.made[0]).toMatchObject({ return_url: RETURN_URL });
    expect((await db.payment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("paying");
    st.bank((await db.payment.findUniqueOrThrow({ where: { id: row.id } })).actionPi!, true);
    expect((await confirm(dev.cookie, { paymentId: row.id })).status).toBe(200);
    expect(await db.payment.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "charged", actionPi: null });
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).toBeNull();
  });

  it("cancelled on the stand-in: still owed, nothing charged, the hold stays", async () => {
    const { dev, row } = await held();
    fakeStripe({ mode: "action" });
    const r = await json(await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: {} })));
    expect(r.body.confirm[0]).toMatchObject({ simulated: true, checkUrl: null });
    expect((await confirm(dev.cookie, { paymentId: row.id, simulate: "failed" })).body.error.message).toBe(R.BANK_NOT_CONFIRMED);
    expect(await db.payment.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "failed", actionPi: null });
    expect((await owed(dev.user.id)).map((p) => p.id)).toEqual([row.id]);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).not.toBeNull();
  });
});

describe("batch 17 §11: a charge made while away is confirmed on the test page", () => {
  it("a tester's Charge: the bell and Payments link straight to “Confirm with your bank” under the piece; it opens the same inline check and goes through", async () => {
    const { dev, tester, testId, sessionId, sub } = await sentWork();
    await withCard(dev.user.id);
    await chargeOpen(sub.id);
    const st = fakeStripe({ mode: "away-action", page: true });
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true })).status).toBe(200);
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id, kind: "review" } });
    expect(p.status).toBe("needs_confirmation");
    const href = `/app/tests/${testId}#bank-${p.id}`;
    expect(R.bankHref(testId, p.id)).toBe(href);
    // The bell line (emailed even with Off): "Confirm this payment by <date>.", linking to the button.
    const n = await db.notification.findFirstOrThrow({ where: { userId: dev.user.id, text: { startsWith: "Your bank wants you to confirm a $10.00 payment. Confirm this payment by " } } });
    expect(n.link).toBe(href);
    expect(n.mustEmail).toBe(true);
    // Payments: no Confirm of its own, a link to the same button.
    const items = await confirmItems(dev.user.id);
    expect(items).toEqual([{ id: p.id, text: expect.stringMatching(/^A payment \$10\.00 on “Harbor Run” · confirm by /), href }]);
    const list = renderToStaticMarkup(createElement(ConfirmList, { items }));
    expect(list).toContain(`href="${href}"`);
    expect(list).toContain("Confirm with your bank →");
    expect(list).not.toContain("<button");
    // The test page: under the piece (the tester's written answers), the box the link marks.
    const rows = await bankWaitingOnTest(dev.user.id, testId);
    expect(rows).toEqual([{ id: p.id, contractId: sessionId, pieceId: sub.id, line: expect.stringMatching(/^Your bank wants you to confirm a \$10\.00 payment for Ana Silva's written answers, made while you were away\. Confirm it by .+\.$/) }]);
    const box = renderToStaticMarkup(createElement(BankWaiting, { paymentId: p.id, line: rows[0].line }));
    expect(box).toContain(`id="bank-${p.id}"`);
    expect(box).toContain("data-[marked]:ring-2");
    expect(box).toContain(">Confirm with your bank</button>");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("{r.sub && bankAt(r.sub.id)}");
    // "Confirm with your bank": the payment is confirmed with return_url so the bank's page shows inline; then it goes through.
    const start = await confirm(dev.cookie, { paymentId: p.id, start: true });
    expect(start.body).toMatchObject({ paymentId: p.id, needs: "action", checkUrl: CHECK_URL });
    expect(st.confirmed[0]).toMatchObject({ id: p.actionPi, payment_method: "pm_x", return_url: RETURN_URL });
    st.bank(p.actionPi!, true);
    expect((await confirm(dev.cookie, { paymentId: p.id })).status).toBe(200);
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "charged" });
    expect(await bankWaitingOnTest(dev.user.id, testId)).toEqual([]);
    expect(await confirmItems(dev.user.id)).toEqual([]);
  });

  it("with the fake: the stand-in's Cancel leaves it waiting (still on the test page); its Confirm puts it through", async () => {
    const { dev, tester, testId, sessionId, sub } = await sentWork();
    await withCard(dev.user.id);
    await chargeOpen(sub.id);
    fakeStripe({ mode: "away-action" });
    await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true });
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: sub.id, kind: "review" } });
    setStripeForTests(null); // no Stripe: the start hands the page the stand-in
    expect((await confirm(dev.cookie, { paymentId: p.id, start: true })).body).toMatchObject({ simulated: true, checkUrl: null });
    expect((await confirm(dev.cookie, { paymentId: p.id, simulate: "failed" })).body.error.message).toBe(R.BANK_NOT_CONFIRMED);
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "needs_confirmation" });
    expect((await bankWaitingOnTest(dev.user.id, testId)).map((b) => b.id)).toEqual([p.id]);
    expect((await confirm(dev.cookie, { paymentId: p.id, simulate: "succeeded" })).status).toBe(200);
    expect(await db.payment.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "charged" });
  });

  it("an automatic retry during a hold: on the test page (the paused view lists it), linked from the bell; a renewal (no test) stays on Payments", async () => {
    const { dev, testId, sessionId, tester } = await sentWork();
    await withCard(dev.user.id);
    const row = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    await startHold(dev.user.id, "unpaid");
    fakeStripe({ mode: "away-action" });
    await retryOwed(dev.user.id);
    const n = await db.notification.findFirstOrThrow({ where: { userId: dev.user.id, text: { startsWith: "Your bank wants you to confirm a $8.00 payment. Confirm this payment by " } } });
    expect(n.link).toBe(R.bankHref(testId, row.id));
    const rows = await bankWaitingOnTest(dev.user.id, testId);
    expect(rows).toMatchObject([{ id: row.id, contractId: sessionId, pieceId: null }]);
    expect(rows[0].line).toMatch(/^Your bank wants you to confirm a \$8\.00 payment for Ana Silva's work, made while you were away\./);
    expect(src("app/app/tests/[id]/page.tsx")).toContain('data-restricted-bank=""');
    // A renewal belongs to no test: Payments keeps its own "Confirm with your bank" (the same inline check), and the bell keeps "Confirm it in Payments".
    const sub = await db.payment.create({ data: { kind: "subscription", developerId: dev.user.id, testerId: dev.user.id, amountCents: 700, feeCents: 700, testerCents: 0, status: "needs_confirmation" } });
    await (await import("@/lib/server/confirm")).awayAction(sub.id, { status: "requires_action", stripePaymentIntentId: "pi_" + randomUUID(), clientSecret: "" });
    // (Batch 25 section 3) The renewal's line opens its own row on Payments.
    expect(await db.notification.count({ where: { userId: dev.user.id, link: `/app/payments#bank-${sub.id}`, text: { startsWith: "Your bank wants you to confirm a $7.00 payment. Confirm it in Payments by " } } })).toBe(1);
    const items = await confirmItems(dev.user.id);
    expect(items.find((i) => i.id === sub.id)).toMatchObject({ href: null });
    const list = renderToStaticMarkup(createElement(ConfirmList, { items: items.filter((i) => i.id === sub.id) }));
    expect(list).toContain(`id="bank-${sub.id}"`);
    expect(list).toContain(">Confirm with your bank</button>");
  });
});

describe("batch 17 §11: Verify a card shows the check inline", () => {
  it("with the fake: the stand-in under the button; Cancel leaves it unverified, Confirm verifies", async () => {
    const { dev, sessionId, tester, sub } = await sentWork();
    const pi = "pi_" + randomUUID();
    await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 160, testerCents: 640, status: "charged", stripePaymentIntentId: pi } });
    expect(await chargebackOpened(pi)).toBe(true);
    expect((await verify(dev.cookie, { check: true })).body).toEqual({ simulated: true, verified: false, standIn: true });
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).chargebackCardVerifiedAt).toBeNull();
    const no = await verify(dev.cookie, { finish: true, simulate: "failed" });
    expect(no.body.error).toMatchObject({ code: "not_verified", message: R.CARD_NOT_VERIFIED });
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).chargebackCardVerifiedAt).toBeNull();
    expect((await verify(dev.cookie, { finish: true, simulate: "succeeded" })).body).toEqual({ verified: true });
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).chargebackCardVerifiedAt).not.toBeNull();
    expect(src("components/ChargebackSteps.tsx")).toContain('{ check: true }');
  });
});
