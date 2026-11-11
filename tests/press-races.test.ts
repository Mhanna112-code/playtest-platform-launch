import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as subPOST } from "@/app/api/payments/subscription/route";
import { POST as helpPOST } from "@/app/api/help/route";
import { POST as verifyPOST } from "@/app/api/payments/verify-card/route";
import { POST as payoutPOST } from "@/app/api/payments/payout/route";
import { POST as notifyPOST } from "@/app/api/account/notify/route";
import { POST as alertsPOST } from "@/app/api/account/tester-alerts/route";
import { POST as excerptsPOST } from "@/app/api/excerpts/route";
import { TOPICS } from "@/lib/helpTopics";
import { setStripeForTests, cardSetupUrl, payoutSetupUrl, saveCardFromCheckout } from "@/lib/server/stripe";
import { chargebackOpened } from "@/lib/server/holds";
import { finishCardCheck } from "@/lib/server/chargeback";
import { answerRequest } from "@/lib/server/requests";
import { reportNoShow } from "@/lib/server/calls";
import { decideDispute } from "@/lib/server/payments";
import { blockUser } from "@/lib/server/blocks";
import { previewTeamClose, teamClose } from "@/lib/server/teamClose";
import { cancelOwedCheck } from "@/lib/server/owedOnce";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 3, batch 35 §157) Every press is safe when the same action was already done in another tab or by someone else at the same moment: exactly one outcome,
// never a double effect, never a 500, and a refusal that names what happened. Each test fires the two presses at once (Promise.all) where the race is the point.

afterEach(() => setStripeForTests(null));

type Out = { ok: true; v: unknown } | { ok: false; e: Error & { code?: string; status?: number } };
const outcome = <T>(p: Promise<T>): Promise<Out> => p.then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e: e as Error & { code?: string } }));
const userRow = (id: string) => db.user.findUniqueOrThrow({ where: { id } });
const withCard = (userId: string) => db.user.update({ where: { id: userId }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const confirm = (cookie: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, body })).then(json);
const ex = (cookie: string, body: Record<string, unknown>) => excerptsPOST(req("/api/excerpts", { cookie, body })).then(json);
/** Of two responses, exactly one went through (200); the other is the refusal returned. */
function oneOf<T extends { status: number }>(a: T, b: T) {
  const ok = [a, b].filter((r) => r.status === 200);
  expect(ok).toHaveLength(1);
  return { won: ok[0], lost: (a.status === 200 ? b : a) as T & { body: { error: { message: string; code: string } } } };
}
function oneOut(a: Out, b: Out) {
  const ok = [a, b].filter((r) => r.ok);
  expect(ok).toHaveLength(1);
  const lost = (a.ok ? b : a) as Extract<Out, { ok: false }>;
  return { won: ok[0] as Extract<Out, { ok: true }>, lost: lost.e };
}

/** A Stripe stand-in: PaymentIntents ("action": a press waits for the bank) plus whatever `more` adds. */
function fakeStripe(mode: "ok" | "action" = "ok", more: Record<string, unknown> = {}) {
  const status = new Map<string, string>();
  const made: string[] = [];
  setStripeForTests({
    paymentIntents: {
      create: async (p: Record<string, unknown>) => {
        const id = "pi_" + randomUUID();
        made.push(id);
        if (mode === "action" && !p.off_session) {
          status.set(id, "requires_action");
          return { id, status: "requires_action", client_secret: `${id}_secret` };
        }
        status.set(id, "succeeded");
        return { id, status: "succeeded" };
      },
      retrieve: async (id: string) => ({ id, status: status.get(id) ?? "succeeded", client_secret: `${id}_secret` }),
      cancel: async (id: string) => { status.set(id, "canceled"); return { id, status: "canceled" }; },
    },
    refunds: { create: async () => ({ id: "re_" + randomUUID() }) },
    ...more,
  } as unknown as Stripe);
  return { made, bank: (id: string, ok: boolean) => status.set(id, ok ? "succeeded" : "canceled") };
}

/** Nora's test, Ana joined and sent written answers. */
async function sentWork() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}
/** ... and paid $4.00 of the $10.00 (a dispute is possible). */
async function paidWork() {
  const w = await sentWork();
  expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful" })).status).toBe(200);
  await settle();
  return w;
}
/** ... and Ana disputed it; an admin. */
async function disputed() {
  const w = await paidWork();
  expect((await sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.sub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true })).status).toBe(200);
  const a = await makeUser({ name: "Admin" });
  const admin = await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  const row = await db.dispute.findFirstOrThrow({ where: { submissionId: w.sub.id } });
  await settle();
  return { ...w, admin, row };
}

describe("§157 1: Subscribe while another tab's Subscribe waits for the bank", () => {
  it("two Subscribes at once: one bank check; the other reads the waiting line; confirmed once: one activation, one receipt", async () => {
    process.env.FREE_UNTIL = new Date(Date.now() - 86_400_000).toISOString();
    try {
      const dev = await makeUser({ dev: true, name: "Nora Lane" });
      await withCard(dev.user.id);
      const st = fakeStripe("action");
      const subscribe = () => subPOST(req("/api/payments/subscription", { cookie: dev.cookie, body: { action: "subscribe" } })).then(json);
      const { won, lost } = oneOf(...((await Promise.all([subscribe(), subscribe()])) as [Awaited<ReturnType<typeof subscribe>>, Awaited<ReturnType<typeof subscribe>>]));
      expect(won.body.requiresAction).toBe(true);
      expect(lost.status).toBe(409);
      expect(lost.body.error.message).toBe("Your Subscribe is already waiting for your bank: finish that check, or cancel it.");
      expect(await db.payment.count({ where: { developerId: dev.user.id, kind: "subscription" } })).toBe(1);
      // A later press (another tab) while it waits: the same line.
      expect((await subscribe()).body.error.message).toBe("Your Subscribe is already waiting for your bank: finish that check, or cancel it.");
      st.bank((await db.payment.findUniqueOrThrow({ where: { id: won.body.paymentId } })).actionPi!, true);
      const [c1, c2] = await Promise.all([confirm(dev.cookie, { paymentId: won.body.paymentId }), confirm(dev.cookie, { paymentId: won.body.paymentId })]);
      expect([c1.status, c2.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
      expect([c1.status, c2.status]).not.toContain(500);
      expect((await userRow(dev.user.id)).subscriptionStatus).toBe("active");
      expect(await db.notification.count({ where: { userId: dev.user.id, text: { startsWith: "You paid $7.00 for your subscription" } } })).toBe(1);
      expect(await db.notification.count({ where: { userId: dev.user.id, text: { startsWith: "You're subscribed" } } })).toBe(1);
      await db.user.update({ where: { id: dev.user.id }, data: { subscriptionStatus: "ended", subscriptionEndReason: "cancelled" } });
    } finally {
      delete process.env.FREE_UNTIL;
    }
  });
});

describe("§157 2: Contact us sent twice", () => {
  it("the same message from two tabs at once goes to the team once; the other reads 'You already sent this message.'", async () => {
    const u = await makeUser({ dev: true, name: "Nora Lane" });
    const send = () => helpPOST(req("/api/help", { cookie: u.cookie, body: { topic: TOPICS[0], message: "A different question about my account." } })).then(json);
    const body = { topic: TOPICS[0], message: "My payment didn't show up, please look." };
    const sendSame = () => helpPOST(req("/api/help", { cookie: u.cookie, body })).then(json);
    const { lost } = oneOf(...((await Promise.all([sendSame(), sendSame()])) as [Awaited<ReturnType<typeof sendSame>>, Awaited<ReturnType<typeof sendSame>>]));
    expect(lost.status).toBe(409);
    expect(lost.body.error.message).toBe("You already sent this message.");
    expect(await db.contactMessage.count({ where: { userId: u.user.id } })).toBe(1);
    // A different message still goes.
    expect((await send()).status).toBe(200);
  });
});

describe("§157 3: a call request answered at the same moment", () => {
  async function requested() {
    const w = await sentWork();
    const startsAt = new Date(Date.now() + 48 * 3_600_000);
    startsAt.setUTCSeconds(0, 0);
    expect((await act(w.testId, "request-time", w.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [w.sessionId], startsAt: startsAt.toISOString() })).status).toBe(200);
    const q = await db.callRequest.findFirstOrThrow({ where: { contractId: w.sessionId, status: "pending", fromSide: "developer" } });
    return { ...w, q, dev: { ...w.dev, row: await userRow(w.dev.user.id) }, tester: { ...w.tester, row: await userRow(w.tester.user.id) } };
  }

  // (Owner, Nov 11, §380 DO) The time clash is checked before the stop-once box, so the second Accept usually reads the clash with the call the first one just
  // booked ("You already have a call at …"); it reads "You already accepted …" only when it got past that check before the booking. Two Accepts from two tabs
  // is no longer a normal path (one page at a time, §380): what matters is that exactly one call is booked and nothing else changes.
  it("two Accepts (two tabs): booked once; the other reads the clash with that call (or 'You already accepted this request at …')", async () => {
    const w = await requested();
    const accept = () => outcome(answerRequest(w.tester.row, w.sessionId, { requestId: w.q.id, action: "accept" }));
    const { lost } = oneOut(...((await Promise.all([accept(), accept()])) as [Out, Out]));
    expect(lost.message).toMatch(/^(You already have a call at .+\.|You already accepted this request at \d{1,2}:\d{2} [AP]M\.)$/);
    const calls = await db.call.findMany({ where: { contractId: w.sessionId } });
    expect(calls).toHaveLength(1);
    expect(await db.callRequest.findUniqueOrThrow({ where: { id: w.q.id } })).toMatchObject({ status: "booked", callId: calls[0].id });
    expect(await db.callRequest.count({ where: { contractId: w.sessionId } })).toBe(1);
    expect(await db.callSet.count({ where: { contractId: w.sessionId } })).toBe(0);
  });

  it("Accept and Withdraw at once: exactly one happens; the other names it", async () => {
    const w = await requested();
    const page = { seenAt: seen(), confirmed: true };
    const [a, d] = await Promise.all([
      outcome(answerRequest(w.tester.row, w.sessionId, { requestId: w.q.id, action: "accept", ...page })),
      outcome(answerRequest(w.dev.row, w.sessionId, { requestId: w.q.id, action: "withdraw", ...page })),
    ]);
    const { lost } = oneOut(a, d);
    const q = await db.callRequest.findUniqueOrThrow({ where: { id: w.q.id } });
    if (a.ok) {
      expect(q.status).toBe("booked");
      expect(lost.message).toMatch(/^This time was booked at /);
    } else {
      expect(q.status).toBe("withdrawn");
      expect(lost.message).toBe("Nora Lane withdrew this request, so your Accept didn't go through."); // (§185) said once, no time; (§385) the standard form
      expect(await db.call.count({ where: { contractId: w.sessionId } })).toBe(0);
    }
  });
});

describe("§157 4: Verify a card when it's already verified", () => {
  async function chargebackHold() {
    const w = await paidWork();
    const pi = "pi_" + randomUUID();
    await db.payment.create({ data: { kind: "review", submissionId: w.sub.id, contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 800, feeCents: 160, testerCents: 640, status: "charged", stripePaymentIntentId: pi } });
    expect(await chargebackOpened(pi)).toBe(true);
    return w;
  }

  it("two Verify presses at once: verified once; the other (and any later one) reads 'Your card is already verified.' without using a card attempt", async () => {
    const w = await chargebackHold();
    const verify = () => verifyPOST(req("/api/payments/verify-card", { cookie: w.dev.cookie, body: {} })).then(json);
    const { won, lost } = oneOf(...((await Promise.all([verify(), verify()])) as [Awaited<ReturnType<typeof verify>>, Awaited<ReturnType<typeof verify>>]));
    expect(won.body.verified).toBe(true);
    expect(lost.body.error.message).toBe("Your card is already verified.");
    const attempts = await db.actionLog.count({ where: { userId: w.dev.user.id } });
    expect((await verify()).body.error.message).toBe("Your card is already verified.");
    expect(await db.actionLog.count({ where: { userId: w.dev.user.id } })).toBe(attempts);
  });

  it("two bank checks finishing at once: one verifies and replaces the card, recorded as a card change; the other is refused and changes nothing", async () => {
    const w = await chargebackHold();
    await db.user.update({ where: { id: w.dev.user.id }, data: { stripeCustomerId: "cus_x", stripePaymentMethodId: "pm_old" } });
    const si = (id: string, pm: string) => ({ id, status: "succeeded", created: Math.floor(Date.now() / 1000) + 5, customer: "cus_x", payment_method: pm, metadata: { userId: w.dev.user.id, purpose: "chargeback-verify" }, latest_attempt: null });
    fakeStripe("ok", {
      setupIntents: { retrieve: async (id: string) => si(id, id === "seti_a" ? "pm_a4242" : "pm_b1111") },
      paymentMethods: { retrieve: async (id: string) => ({ id, card: { brand: "visa", last4: id.slice(-4), exp_month: 1, exp_year: 2031 } }) },
      customers: { update: async () => ({}) },
    });
    const { won, lost } = oneOut(...((await Promise.all([outcome(finishCardCheck(w.dev.user.id, "seti_a")), outcome(finishCardCheck(w.dev.user.id, "seti_b"))])) as [Out, Out]));
    expect(won.v).toEqual({ verified: true });
    expect(lost.message).toBe("Your card is already verified.");
    const u = await userRow(w.dev.user.id);
    expect(["pm_a4242", "pm_b1111"]).toContain(u.stripePaymentMethodId);
    const logs = await db.actionLog.findMany({ where: { userId: w.dev.user.id, testId: "account", text: { contains: '"field":"card"' } } });
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0].text)).toMatchObject({ before: "Visa ending _old", after: `Visa ending ${u.stripePaymentMethodId!.slice(-4)}` });
  });
});

describe("§157 5: Add a card in two tabs", () => {
  function cardStripe() {
    const customers: string[] = [];
    const sessions = new Map<string, { customer: string; metadata: Record<string, string>; pm: string }>();
    let n = 0;
    fakeStripe("ok", {
      customers: { create: async () => { const id = "cus_" + randomUUID(); customers.push(id); await new Promise((r) => setTimeout(r, 30)); return { id }; }, update: async () => ({}) },
      checkout: {
        sessions: {
          create: async (p: { customer: string; metadata: Record<string, string> }) => { const id = `cs_${++n}`; sessions.set(id, { customer: p.customer, metadata: p.metadata, pm: `pm_${n}${n}${n}${n}` }); return { id, url: `https://checkout.stripe.test/${id}` }; },
          retrieve: async (id: string) => { const s = sessions.get(id)!; return { id, customer: s.customer, metadata: s.metadata, setup_intent: { payment_method: s.pm } }; },
        },
      },
      paymentMethods: { retrieve: async (id: string) => ({ id, card: { brand: "visa", last4: id.slice(-4), exp_month: 2, exp_year: 2032 } }) },
    });
    return { customers, sessions };
  }

  it("the first card from two tabs: one Stripe customer; both returns are on it; the later return stops once naming the card change, then saves on top", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane", savedCard: false });
    const st = cardStripe();
    const u = await userRow(dev.user.id);
    const t0 = seen();
    await settle();
    const [a, b] = await Promise.all([cardSetupUrl(u, "http://localhost:3400", { since: t0, tab: "tab-a" }), cardSetupUrl(u, "http://localhost:3400", { since: t0, tab: "tab-b" })]);
    expect(st.customers).toHaveLength(1);
    expect(new Set([...st.sessions.values()].map((s) => s.customer)).size).toBe(1);
    const ids = [a, b].map((x) => x.split("/").pop()!);
    const [ra, rb] = await Promise.all(ids.map((id) => saveCardFromCheckout(dev.user.id, id)));
    const stops = [ra, rb].filter((r) => r.stop);
    expect(stops).toHaveLength(1);
    expect(stops[0].stop!.since).toBe(t0);
    expect(await db.actionLog.count({ where: { userId: dev.user.id, testId: "account", text: { contains: '"field":"card"' } } })).toBe(1);
    // Change card again from the stop box (its time): it saves on top.
    const again = await cardSetupUrl(u, "http://localhost:3400", { since: seen(), tab: stops[0].stop!.tab });
    expect((await saveCardFromCheckout(dev.user.id, again.split("/").pop()!)).stop).toBeUndefined();
  });
});

describe("§157 6: payout setup", () => {
  it("a first setup in two tabs makes ONE Express account; pressed once connected: 'Your payout account is already connected.'", async () => {
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    const accounts: string[] = [];
    fakeStripe("ok", {
      accounts: { create: async () => { const id = "acct_" + randomUUID(); accounts.push(id); await new Promise((r) => setTimeout(r, 30)); return { id }; } },
      accountLinks: { create: async (p: { account: string }) => ({ url: `https://connect.stripe.test/${p.account}` }) },
    });
    const u = await userRow(t.user.id);
    const [a, b] = await Promise.all([payoutSetupUrl(u, "http://localhost:3400"), payoutSetupUrl(u, "http://localhost:3400")]);
    expect(accounts).toHaveLength(1);
    expect(a).toBe(b);
    await db.user.update({ where: { id: t.user.id }, data: { payoutsReady: true } });
    const res = await payoutPOST(new Request("http://localhost:3400/api/payments/payout", { method: "POST", headers: { cookie: t.cookie }, body: new FormData() }));
    expect(res.headers.get("location")).toBe("http://localhost:3400/app/payments?error=payout_ready#payout");
    expect(accounts).toHaveLength(1);
  });
});

describe("§157 7: Confirm with your bank finished in a second tab", () => {
  it("the second tab's finish after the first: 'You already confirmed this payment.'; charged once", async () => {
    const w = await sentWork();
    await withCard(w.dev.user.id);
    const st = fakeStripe("action");
    const r = await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 });
    expect(r.body.requiresAction).toBe(true);
    st.bank((await db.payment.findUniqueOrThrow({ where: { id: r.body.paymentId } })).actionPi!, true);
    const [a, b] = await Promise.all([confirm(w.dev.cookie, { paymentId: r.body.paymentId }), confirm(w.dev.cookie, { paymentId: r.body.paymentId })]);
    expect([a.status, b.status]).not.toContain(500);
    const later = await confirm(w.dev.cookie, { paymentId: r.body.paymentId });
    expect(later.status).toBe(409);
    expect(later.body.error.message).toBe("You already confirmed this payment.");
    expect(await db.payment.count({ where: { submissionId: w.sub.id, status: "charged" } })).toBe(1);
  });
});

describe("§157 8: Report a problem with a call at the same moment", () => {
  it("both sides report at once: one report kept; the other reads 'A problem with this call was already reported.'", async () => {
    const w = await sentWork();
    const booked = await bookCall(w.testId, w.dev.cookie, w.sessionId, w.tester.cookie);
    await db.call.update({ where: { id: booked.id }, data: { startsAt: new Date(Date.now() - 3_600_000) } });
    const [a, b] = await Promise.all([
      outcome(reportNoShow(await userRow(w.dev.user.id), booked.id, { kind: "no_show", note: "They never came" })),
      outcome(reportNoShow(await userRow(w.tester.user.id), booked.id, { kind: "late", note: "Started 20 minutes late" })),
    ]);
    const { lost } = oneOut(a, b);
    expect(lost.message).toBe("A problem with this call was already reported.");
    const call = await db.call.findUniqueOrThrow({ where: { id: booked.id } });
    expect(call.noShowBy).toBe(a.ok ? "developer" : "tester");
  });
});

describe("§157 9 and 10: Dispute and Add your side at the same moment", () => {
  it("two Disputes at once: one dispute; the other reads the usual line (never a 500)", async () => {
    const w = await paidWork();
    const dispute = () => sact(w.sessionId, "dispute", w.tester.cookie, { kind: "submission", id: w.sub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true });
    const { lost } = oneOf(...((await Promise.all([dispute(), dispute()])) as [Awaited<ReturnType<typeof dispute>>, Awaited<ReturnType<typeof dispute>>]));
    expect(lost.status).toBe(409);
    expect(lost.body.error.message).toBe("You already disputed this payment. A part can be disputed once.");
    expect(await db.dispute.count({ where: { submissionId: w.sub.id } })).toBe(1);
  });

  it("two Add your side presses at once: one side kept; the other reads 'You already added your side.'", async () => {
    const w = await disputed();
    const side = (text: string) => act(w.testId, "dispute-side", w.dev.cookie, { disputeId: w.row.id, text });
    const [a, b] = await Promise.all([side("Tab A's side"), side("Tab B's side")]);
    const { lost } = oneOf(a, b);
    expect(lost.status).toBe(409);
    expect(lost.body.error.message).toBe("You already added your side.");
    expect((await db.dispute.findUniqueOrThrow({ where: { id: w.row.id } })).devSide).toBe(a.status === 200 ? "Tab A's side" : "Tab B's side");
  });
});

describe("§157 11: Rate at the same moment", () => {
  it("the tester's Rate in two tabs at once: one rating; the other reads 'You already rated Nora Lane.' (never a 500)", async () => {
    const w = await paidWork();
    await act(w.testId, "stop", w.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true });
    await settle();
    const rate = () => sact(w.sessionId, "rate", w.tester.cookie, { stars: 4 });
    const { lost } = oneOf(...((await Promise.all([rate(), rate()])) as [Awaited<ReturnType<typeof rate>>, Awaited<ReturnType<typeof rate>>]));
    expect(lost.status).toBe(409);
    expect(lost.body.error.message).toBe("You already rated Nora Lane.");
    expect(await db.rating.count({ where: { contractId: w.sessionId, side: "tester" } })).toBe(1);
  });
});

describe("§157 12 and 13: a draft deleted or opened in two tabs", () => {
  async function draft() {
    const s = await setup();
    const draftId = (await act(s.testId, "next-round", s.dev.cookie, { seenAt: seen(), confirmed: true })).body.id as string;
    return { ...s, draftId };
  }

  it("Delete draft twice at once: deleted once; the other (and a later press) reads 'You already deleted this draft.'", async () => {
    const w = await draft();
    const del = () => act(w.draftId, "delete-draft", w.dev.cookie, {});
    const { lost } = oneOf(...((await Promise.all([del(), del()])) as [Awaited<ReturnType<typeof del>>, Awaited<ReturnType<typeof del>>]));
    expect(lost.status).toBe(409);
    expect(lost.body.error.message).toBe("You already deleted this draft.");
    expect((await del()).body.error.message).toBe("You already deleted this draft.");
    expect(await db.test.findUnique({ where: { id: w.draftId } })).toBeNull();
  });

  it("Open twice at once: opened once (one 'opened' line); the other reads 'This test is already open.'", async () => {
    const w = await draft();
    const open = () => act(w.draftId, "open", w.dev.cookie, {});
    const { lost } = oneOf(...((await Promise.all([open(), open()])) as [Awaited<ReturnType<typeof open>>, Awaited<ReturnType<typeof open>>]));
    expect(lost.body.error.message).toBe("This test is already open.");
    expect(await db.testEvent.count({ where: { testId: w.draftId, kind: "opened" } })).toBe(1);
  });
});

describe("§157 14: Block at the same moment", () => {
  it("two Blocks at once: the session ends once and its line is sent once; (§380) the other is silent", async () => {
    const w = await sentWork();
    const me = await userRow(w.dev.user.id);
    const rs = await Promise.all([blockUser(me, w.tester.user.id), blockUser(me, w.tester.user.id)]);
    expect(rs.filter((r) => (r as { already?: boolean }).already)).toHaveLength(1); // (Owner, Nov 11, §380)
    expect(await db.block.count({ where: { blockerId: me.id, blockedId: w.tester.user.id } })).toBe(1);
    expect(await db.notification.count({ where: { userId: w.tester.user.id, text: { startsWith: "Your session on Harbor Run ended" } } })).toBe(1);
  });
});

describe("§157 15: Allow / Deny after the tester removed the request", () => {
  it("removed first: 'Ana Silva withdrew this request.'; Remove and Allow at once: never an Allow on a removed request", async () => {
    const w = await sentWork();
    const ANSWER = "The harbour level felt great, but the second boss was far too hard for me.";
    await db.submission.update({ where: { id: w.sub.id }, data: { answers: [ANSWER, "Nowhere really."] } });
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const ask = async () => (await ex(w.tester.cookie, { action: "request", submissionId: w.sub.id, index: 0, text: "the second boss was far too hard" })).body.id as string;
    const id = await ask();
    expect((await ex(w.tester.cookie, { action: "remove", excerptId: id })).status).toBe(200);
    const r = await ex(w.dev.cookie, { action: "decide", excerptId: id, decision: "allow" });
    expect(r.body.error.message).toBe("Ana Silva withdrew this request.");
    const id2 = await ask();
    const [rm, al] = await Promise.all([ex(w.tester.cookie, { action: "remove", excerptId: id2 }), ex(w.dev.cookie, { action: "decide", excerptId: id2, decision: "allow" })]);
    // Remove always goes through (the tester may also remove a shown excerpt); Allow either came first (then removed) or reads the withdrawal, never a 500.
    expect(rm.status).toBe(200);
    if (al.status !== 200) expect(al.body.error.message).toBe("Ana Silva withdrew this request.");
    expect(await db.excerpt.findUnique({ where: { id: id2 } })).toBeNull();
  });
});

describe("§157 16 and 17: the email setting and the tester's Alerts", () => {
  it("the email setting saved in another tab stops this tab's Save once ('Email: Daily → Off'); the second press saves", async () => {
    const u = await makeUser({ dev: true, name: "Nora Lane" });
    await db.user.update({ where: { id: u.user.id }, data: { emailPref: "daily" } });
    const t0 = seen();
    await settle();
    const save = (body: Record<string, unknown>) => notifyPOST(req("/api/account/notify", { cookie: u.cookie, body })).then(json);
    expect((await save({ emailPref: "off", seenAt: t0, tab: "tab-a" })).status).toBe(200);
    await settle(); // (Windows' clock can lag the database's by ~15 ms)
    const stop = await save({ emailPref: "weekly", seenAt: t0, tab: "tab-b" });
    expect(stop.status).toBe(409);
    expect(stop.body.error.code).toBe("stop_once");
    expect(stop.body.error.changes.map((c: { text: string }) => c.text)).toEqual(["Email: Daily → Off"]);
    expect((await save({ emailPref: "weekly", seenAt: t0, tab: "tab-b", confirmed: true, boxAt: stop.body.error.now })).status).toBe(200);
    expect((await userRow(u.user.id)).emailPref).toBe("weekly");
  });

  it("Alerts sends the state it means: 'off' twice (a stale page) leaves it Off; nothing flips back", async () => {
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    const set = (alerts: string) => alertsPOST(req("/api/account/tester-alerts", { cookie: t.cookie, body: { alerts } })).then(json);
    const [a, b] = await Promise.all([set("off"), set("off")]);
    expect([a.body.off, b.body.off]).toEqual([true, true]);
    expect([a.body.unchanged, b.body.unchanged].filter(Boolean)).toHaveLength(1);
    expect((await userRow(t.user.id)).testerAlertsOff).toBe(true);
    expect((await set("on")).body).toEqual({ off: false });
    expect((await userRow(t.user.id)).testerAlertsOff).toBe(false);
  });
});

describe("§157 18 and 19: the same admin in two tabs", () => {
  it("Decide from two tabs at once: one decision; the other reads 'You already decided this dispute in another tab at …'", async () => {
    const w = await disputed();
    const decide = (load: string) => outcome(decideDispute(w.admin, w.row.id, { total: "10.00", tickCents: 600, load }));
    const { lost } = oneOut(...((await Promise.all([decide("load-a"), decide("load-b")])) as [Out, Out]));
    expect(lost.message).toMatch(/^You already decided this dispute in another tab at \d{1,2}:\d{2} [AP]M\.$/);
    expect(await db.payment.count({ where: { disputeId: w.row.id } })).toBe(1);
  });

  it("Close open reviews for $0 from two tabs at once: closed once; the other names it ('You already closed 1 open review for $0 in another tab at …')", async () => {
    const w = await sentWork();
    const a = await makeUser({ name: "Admin" });
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    const scope = { developerId: w.dev.user.id };
    const pv = await previewTeamClose(scope);
    const close = (load: string) => teamClose(a.user.id, scope, { reason: "Spam account", pieces: pv.pieces, load });
    const lines = (await Promise.all([close("load-a"), close("load-b")])).map((r) => r.line).sort();
    expect(lines[0]).toBe("1 closed");
    expect(lines[1]).toMatch(/^You already closed 1 open review for \$0 in another tab at \d{1,2}:\d{2} [AP]M\.$/);
    expect(await db.review.count({ where: { submissionId: w.sub.id } })).toBe(1);
  });
});

describe("§157 20: Cancel this check pressed twice", () => {
  it("two Cancels at once: cancelled once; the other (and a later press) reads 'You already cancelled this check.'", async () => {
    const w = await sentWork();
    fakeStripe("ok");
    const pi = "pi_" + randomUUID();
    const p = await db.payment.create({ data: { kind: "review", submissionId: w.sub.id, contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "paying", actionPi: pi, actionBy: new Date(Date.now() + 600_000) } });
    const { won, lost } = oneOut(...((await Promise.all([outcome(cancelOwedCheck(w.dev.user.id, p.id)), outcome(cancelOwedCheck(w.dev.user.id, p.id))])) as [Out, Out]));
    expect(won.v).toMatchObject({ cancelled: true });
    expect(lost.message).toBe("You already cancelled this check.");
    await expect(cancelOwedCheck(w.dev.user.id, p.id)).rejects.toThrow("You already cancelled this check.");
  });
});
