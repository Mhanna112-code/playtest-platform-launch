import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { User } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { confirmFinish, expireActions, pieceLocked } from "@/lib/server/confirm";
import { setStripeForTests } from "@/lib/server/stripe";
import { testerRateState } from "@/lib/server/ratings";
import { testV } from "@/lib/server/pulseV";
import { paidSoFar } from "@/lib/server/payments";
import { json, req } from "./helpers";
import { joined, sact, seen, setup } from "./fixtures";

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, adminAway: () => {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/test", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;
afterEach(() => setStripeForTests(null));

async function fixture(call = false) {
  const f = await setup();
  const j = await joined(f.testId, "Alex Morgan", "they");
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  const slot = call ? await db.callSlot.create({ data: { testId: f.testId, startsAt: new Date(Date.now() - 3_600_000), minutes: 20, allowedTesterIds: [] } }) : null;
  const c = call ? await db.call.create({ data: { slotId: slot!.id, contractId: j.sessionId, startsAt: new Date(Date.now() - 3_600_000), minutes: 20, actualMinutes: 20, rateCents: 3000, measuredAt: new Date(), status: "booked" } }) : null;
  const dev = await db.user.update({ where: { id: f.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_test" } });
  let after = "succeeded";
  setStripeForTests({ paymentIntents: {
    create: async () => ({ id: "pi_" + randomUUID(), status: "requires_action", client_secret: "secret_test" }),
    retrieve: async (id: string) => ({ id, status: after }),
    cancel: async (id: string) => ({ id, status: "canceled" }),
  } } as unknown as Stripe);
  const key = c ? { callId: c.id } : { submissionId: sub.id };
  const pay = () => reviewPOST(req("/api/review", { cookie: f.dev.cookie, body: { kind: c ? "call" : "submission", id: c?.id ?? sub.id, amount: "10.00", tickedCents: 1000, seenAt: seen(), confirmed: true, payKey: randomUUID() } })).then(json);
  return { ...f, ...j, sub, c, dev, key, pay, setAfter: (value: string) => { after = value; } };
}

async function parts(f: Awaited<ReturnType<typeof fixture>>) {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: f.tester.user.id } });
  const { default: Page } = await import("@/app/app/sessions/[id]/page");
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: f.sessionId }) }));
  // (Owner, Nov 4, §186) A call's payment tag is in a drop-down of its own now (the Live call part lists them no more): both sections. (Owner, Nov 5, §209) That
  // drop-down is the Live session's "Had (N)".
  return (html.match(/<section id="parts"[\s\S]*?<\/section>/)?.[0] ?? "") + (html.includes("data-calls-had=") ? html.slice(html.indexOf("data-calls-had="), html.indexOf("data-calls-cancelled=")) : "");
}

describe("batch 35 §107: an on-session Pay is not reviewed until confirmed", () => {
  it.each([false, true])("a bank check keeps work waiting, then succeeds (call=%s)", async (call) => {
    const f = await fixture(call);
    const r = await f.pay();
    expect(r.body.requiresAction).toBe(true);
    expect(await db.review.count({ where: f.key })).toBe(0);
    expect(await pieceLocked(f.key)).toBe(true);
    expect(await paidSoFar(f.sessionId)).toBe(0);
    expect((await testerRateState(f.sessionId)).kind).toBe("disabled");
    const html = await parts(f);
    expect(html).toContain("Waiting for review");
    expect(html).not.toContain('data-part-status="paid"');
    expect(html).not.toContain("Payment delayed");
    expect(html).not.toContain("Paid so far for this part: $10.00");
    expect(html).not.toMatch(/<button[^>]*>Dispute/);
    expect(await db.notification.count({ where: { userId: f.tester.user.id, groupKey: "tpaid" } })).toBe(0);
    auth.user = f.dev;
    const { default: DevPage } = await import("@/app/app/tests/[id]/page");
    const devHtml = renderToStaticMarkup(await DevPage({ params: Promise.resolve({ id: f.testId }), searchParams: Promise.resolve({}) }));
    expect(devHtml).toContain("Confirming with your bank");
    await confirmFinish(f.dev, r.body.paymentId);
    expect(await db.review.count({ where: f.key })).toBe(1);
    expect(await paidSoFar(f.sessionId)).toBe(1000);
    expect(await parts(f)).toContain('data-part-status="paid">Paid</span>');
    expect(await db.notification.count({ where: { userId: f.tester.user.id, groupKey: "tpaid" } })).toBe(1);
  });

  it.each([false, true].flatMap((call) => ["canceled", "requires_payment_method", "timeout"].map((outcome) => [call, outcome] as const)))("a failed check frees Pay without marking it paid (call=%s, outcome=%s)", async (call, outcome) => {
    const f = await fixture(call);
    const r = await f.pay();
    expect(r.body.requiresAction).toBe(true);
    if (outcome === "timeout") {
      await db.payment.update({ where: { id: r.body.paymentId }, data: { actionBy: new Date(Date.now() - 1) } });
      await expireActions();
    } else {
      f.setAfter(outcome);
      await expect(confirmFinish(f.dev, r.body.paymentId)).rejects.toMatchObject({ code: "not_confirmed" });
    }
    expect(await pieceLocked(f.key)).toBe(false);
    expect(await db.review.count({ where: f.key })).toBe(0);
    expect(await paidSoFar(f.sessionId)).toBe(0);
    expect(await parts(f)).toContain("Waiting for review");
    expect((await f.pay()).body.requiresAction).toBe(true);
  });

  it("a bank deadline changes the beat fingerprint and the next Pay releases it without a daily sweep", async () => {
    const f = await fixture();
    const first = await f.pay();
    const before = await testV(f.dev.id, f.testId);
    await db.payment.update({ where: { id: first.body.paymentId }, data: { actionBy: new Date(Date.now() - 1) } });
    expect(await testV(f.dev.id, f.testId)).not.toBe(before);
    const next = await f.pay();
    expect(next.body.requiresAction).toBe(true);
    expect(next.body.paymentId).not.toBe(first.body.paymentId);
    expect((await db.payment.findUniqueOrThrow({ where: { id: first.body.paymentId } })).status).toBe("cancelled");
    expect(await db.review.count({ where: f.key })).toBe(0);
  });

  it("Charge is locked and a second Pay cannot reserve another charge", async () => {
    const f = await fixture();
    await db.submission.update({ where: { id: f.sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 86_400_000) } });
    expect((await f.pay()).body.requiresAction).toBe(true);
    for (const choice of ["charge", "letgo"]) {
      const charge = await sact(f.sessionId, "choose", f.tester.cookie, { submissionId: f.sub.id, choice, tickedCents: 1000, seenAt: seen(), confirmed: true });
      expect(charge.body.error.code).toBe("locked");
    }
    expect((await f.pay()).status).toBe(409);
    expect(await db.payment.count({ where: { ...f.key, status: "needs_action" } })).toBe(1);
  });
});
