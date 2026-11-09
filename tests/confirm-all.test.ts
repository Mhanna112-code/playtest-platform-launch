import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as allPOST } from "@/app/api/payments/confirm-all/route";
import * as R from "@/lib/rules";
import * as T from "@/lib/confirmAllText";
import { chargebackOpened, owed, owedLines } from "@/lib/server/holds";
import { awayAction, bankToConfirm, confirmItems, expireActions } from "@/lib/server/confirm";
import { confirmAllState } from "@/lib/server/confirmAll";
import { ALL_NOTE, OWED_PAID } from "@/lib/server/owedOnce";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, req } from "./helpers";
import { act, addTo, joined, listingBody, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 3, batch 35 §147) Confirm all: every charge waiting for "Confirm with your bank" (across testers, parts and tests) confirmed as ONE payment with ONE
// bank check; old checks cancelled at Stripe first; approved → each paid once, each tester's share sent, one receipt; refused → each back to its own Confirm with its
// original date; ran out at the earliest date → none confirmed; renewals left out; a dispute on it → its whole amount once + one fee.

const MIN = 60_000;
afterEach(() => setStripeForTests(null));

/** A Stripe stand-in that remembers each PaymentIntent (as batch35-one-card-checks' does). `ask`: the bank asks; `decline`: declined; `declineOnSession`: only a press is declined. */
function bank() {
  const pis = new Map<string, string>();
  const made: { id: string; amount: number; payment_method?: string; off_session?: boolean; description?: string }[] = [];
  const cancelled: string[] = [];
  const transfers: { destination?: string; source_transaction?: string; amount?: number }[] = [];
  const ask = new Set<string>(), decline = new Set<string>(), declineOnSession = new Set<string>();
  const order: string[] = [];
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; payment_method?: string; off_session?: boolean; description?: string }) => {
        const id = "pi_" + randomUUID();
        made.push({ id, ...p });
        order.push(`create:${p.amount}`);
        if (decline.has(p.payment_method ?? "") || (declineOnSession.has(p.payment_method ?? "") && !p.off_session)) throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError" });
        if (ask.has(p.payment_method ?? "")) {
          pis.set(id, "requires_action");
          if (p.off_session) throw Object.assign(new Error("Authentication required."), { code: "authentication_required", raw: { payment_intent: { id, client_secret: `${id}_secret` } } });
          return { id, status: "requires_action", client_secret: `${id}_secret` };
        }
        pis.set(id, "succeeded");
        return { id, status: "succeeded" };
      },
      retrieve: async (id: string) => ({ id, status: pis.get(id) ?? "requires_action", client_secret: `${id}_secret`, latest_charge: id.replace(/^pi_/, "ch_") }),
      cancel: async (id: string) => {
        if (pis.get(id) === "succeeded") throw Object.assign(new Error("This PaymentIntent already succeeded."), { type: "StripeInvalidRequestError", code: "payment_intent_unexpected_state" });
        cancelled.push(id);
        order.push(`cancel:${id}`);
        pis.set(id, "canceled");
        return { id, status: "canceled" };
      },
    },
    transfers: { create: async (p: { destination?: string; source_transaction?: string; amount?: number }) => { transfers.push(p); return { id: "tr_" + randomUUID() }; } },
    refunds: { create: async () => ({ id: "re_" + randomUUID() }) },
  } as unknown as Stripe);
  return { pis, made, cancelled, transfers, ask, decline, declineOnSession, order, approve: (id: string) => pis.set(id, "succeeded") };
}

/**
 * Three charges made while the developer was away, each waiting for their bank on its own check: Ana Silva's written answers on “Harbor Run” ($10), Ben
 * Okafor's on “Sky Lab” ($12), Ana Silva's on “Sky Lab” ($20). Two testers, two tests.
 */
async function world(st: ReturnType<typeof bank>) {
  const s = await setup();
  const t2 = await json(await testsPOST(req("/api/tests", { cookie: s.dev.cookie, body: listingBody({ title: "Sky Lab", productName: "Sky Lab" }) })));
  expect(t2.status).toBe(200);
  await settle();
  const sky = t2.body.id as string;
  const ana = await joined(s.testId, "Ana Silva");
  const ben = await joined(sky, "Ben Okafor", "he");
  const skyTest = await db.test.findUniqueOrThrow({ where: { id: sky } });
  const anaSky = await act(sky, "join", ana.tester.cookie, { listingVersion: skyTest.listingVersion });
  expect(anaSky.status).toBe(200);
  await settle();
  const sessions = [ana.sessionId, ben.sessionId, anaSky.body.sessionId as string];
  const cookies = [ana.tester.cookie, ben.tester.cookie, ana.tester.cookie];
  for (let i = 0; i < 3; i++) await sact(sessions[i], "written", cookies[i], { answers: ["answer", "answer"] });
  await settle();
  const customer = "cus_" + randomUUID();
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: customer, stripePaymentMethodId: "pm_dev" } });
  for (const t of [ana.tester, ben.tester]) await db.user.update({ where: { id: t.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 12), payoutsReady: true } });
  const amounts = [1000, 1200, 2000];
  const items = [];
  for (let i = 0; i < 3; i++) {
    const c = await db.contract.findUniqueOrThrow({ where: { id: sessions[i] } });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessions[i] } });
    const p = await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: c.id, developerId: s.dev.user.id, testerId: c.testerId, amountCents: amounts[i], feeCents: 0, testerCents: 0, status: "needs_confirmation", createdAt: new Date(Date.now() - (5 - i) * 1000) } });
    const pi = "pi_" + randomUUID();
    st.pis.set(pi, "requires_action");
    items.push(await awayAction(p.id, { status: "requires_action", stripePaymentIntentId: pi, clientSecret: "" }));
  }
  st.ask.add("pm_dev");
  return { ...s, ana, ben, sky, items, devId: s.dev.user.id };
}

const press = (cookie: string, body: Record<string, unknown>) => allPOST(req("/api/payments/confirm-all", { cookie, body })).then(json);
const confirm = (cookie: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, body })).then(json);
const seenAll = (w: { items: { id: string; amountCents: number }[] }) => ({ seenTotalCents: w.items.reduce((a, p) => a + p.amountCents, 0), seenIds: w.items.map((p) => p.id) });
const rowsOf = (ids: string[]) => Promise.all(ids.map((id) => db.payment.findUniqueOrThrow({ where: { id } })));
const allOf = (devId: string) => db.payment.findMany({ where: { developerId: devId, kind: "owed", note: ALL_NOTE } });
const NAMES = ["Ana Silva's written answers on “Harbor Run” $10.00", "Ben Okafor's written answers on “Sky Lab” $12.00", "Ana Silva's written answers on “Sky Lab” $20.00"];

describe("§147 Confirm all: one payment, one bank check", () => {
  it("stops for new work on a covered part even with Work sent off", async () => {
    const st = bank();
    const w = await world(st);
    await db.test.update({ where: { id: w.testId }, data: { ignoredAlerts: ["work"] } });
    const body = { ...seenAll(w), seenAt: seen() };
    await settle();
    expect((await addTo(w.ana.sessionId, w.ana.tester.cookie, { text: "Another detail about the opening screen.", confirmed: true })).status).toBe(200);
    const first = await press(w.dev.cookie, body);
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(first.body.error.changes.map((c: { text: string }) => c.text)).toEqual([expect.stringContaining(NAMES[0])]);
    expect(st.cancelled).toHaveLength(0);
    expect(st.made).toHaveLength(0);
    expect((await press(w.dev.cookie, { ...body, confirmed: true, boxAt: first.body.error.now })).status).toBe(200);
    expect(st.made).toHaveLength(1);
  });

  it("the box and Payments offer it for 2+ waiting charges: “Confirm all (3) · $42.00”", async () => {
    const st = bank();
    const w = await world(st);
    const s = await confirmAllState(w.devId);
    expect(s).toMatchObject({ ids: w.items.map((p) => p.id), totalCents: 4200, leftOut: null, open: null });
    expect(T.confirmAllLabel(s.ids.length, s.totalCents)).toBe("Confirm all (3) · $42.00");
  });

  it("ONE PaymentIntent for the three; each old check cancelled at Stripe FIRST; approved → each paid once, each tester's share sent, ONE receipt naming every item", async () => {
    const st = bank();
    const w = await world(st);
    const olds = w.items.map((p) => p.actionPi!);
    const r = await press(w.dev.cookie, seenAll(w));
    expect(r.status).toBe(200);
    expect(st.made).toHaveLength(1);
    expect(st.made[0]).toMatchObject({ amount: 4200, payment_method: "pm_dev" });
    expect(st.made[0].off_session).toBeFalsy(); // a press: the check opens inline
    expect(st.made[0].description).toBe(`Playtest: Confirm all (${NAMES.join(", ")})`);
    // The three old checks were cancelled before the one payment was made.
    expect(st.order).toEqual([...olds.map((pi) => `cancel:${pi}`), "create:4200"]);
    const [one] = await allOf(w.devId);
    expect(one).toMatchObject({ amountCents: 4200, status: "needs_action", actionPi: st.made[0].id });
    expect(r.body.confirm.paymentId).toBe(one.id);
    for (const p of await rowsOf(w.items.map((x) => x.id))) expect(p).toMatchObject({ status: "needs_confirmation", coveredById: one.id, actionPi: null });
    // While it waits, the box shows the one check (with Cancel this check), and no item offers its own Confirm.
    expect(await confirmItems(w.devId)).toEqual([]);
    expect((await confirmAllState(w.devId)).open).toEqual({ id: one.id, cents: 4200, n: 3 });
    expect((await bankToConfirm(w.devId)).map((r) => [r.id, r.lead, !!r.all])).toEqual([[one.id, "Confirm all: $42.00 for 3 payments is waiting for your bank.", true]]);
    // Approved on the bank's page.
    st.approve(one.actionPi!);
    expect((await confirm(w.dev.cookie, { paymentId: one.id })).status).toBe(200);
    for (const p of await rowsOf(w.items.map((x) => x.id))) expect(p).toMatchObject({ status: "charged", coveredById: one.id, stripePaymentIntentId: one.actionPi, settledAt: expect.any(Date), actionPi: null });
    expect(await db.payment.findUniqueOrThrow({ where: { id: one.id } })).toMatchObject({ status: OWED_PAID });
    expect(st.transfers.map((t) => [t.amount, t.source_transaction])).toEqual([1000, 1200, 2000].map((c) => [R.splitFee(c).testerCents, one.actionPi!.replace(/^pi_/, "ch_")]));
    const receipts = await db.notification.findMany({ where: { userId: w.devId, text: { startsWith: "You paid " } } });
    expect(receipts.map((n) => n.text)).toEqual([`You paid $42.00 for: ${NAMES.join(", ")}`]);
    // Each tester sees their part paid as usual.
    const anaLines = (await db.notification.findMany({ where: { userId: w.ana.tester.user.id } })).map((n) => n.text);
    // (Owner, Nov 4, §177) Each bell names WHICH test: Ana has written answers on two tests.
    expect(anaLines.filter((t) => t === "Nora Lane paid $10.00 for your written answers on “Harbor Run”" || t === "Nora Lane paid $20.00 for your written answers on “Sky Lab”")).toHaveLength(2);
    expect((await db.notification.findMany({ where: { userId: w.ben.tester.user.id } })).map((n) => n.text)).toContain("Nora Lane paid $12.00 for your written answers on “Sky Lab”");
    expect(st.made).toHaveLength(1);
    // Confirmed again (another tab): nothing more.
    expect((await confirm(w.dev.cookie, { paymentId: one.id })).status).not.toBe(500);
    expect(st.made).toHaveLength(1);
    expect(st.transfers).toHaveLength(3);
  });

  it("one already approved at the bank: recorded as paid on its own check and left out of the total", async () => {
    const st = bank();
    const w = await world(st);
    st.approve(w.items[0].actionPi!);
    const r = await press(w.dev.cookie, seenAll(w));
    expect(r.status).toBe(200);
    expect(r.body.already).toBe(`Already confirmed with your bank, so recorded as paid: ${NAMES[0]}.`);
    expect(st.made).toHaveLength(1);
    expect(st.made[0]).toMatchObject({ amount: 3200 });
    const [a] = await rowsOf([w.items[0].id]);
    expect(a).toMatchObject({ status: "charged", coveredById: null, stripePaymentIntentId: w.items[0].actionPi });
    const [one] = await allOf(w.devId);
    expect(one.amountCents).toBe(3200);
    st.approve(one.actionPi!);
    await confirm(w.dev.cookie, { paymentId: one.id });
    for (const p of await rowsOf(w.items.map((x) => x.id))) expect(p.status).toBe("charged");
    expect((await db.notification.findMany({ where: { userId: w.devId, text: { startsWith: "You paid $32.00 for: " } } })).map((n) => n.text)).toEqual([`You paid $32.00 for: ${NAMES[1]}, ${NAMES[2]}`]);
  });

  it("the bank refuses the one check: nothing charged; each back to its own Confirm with its ORIGINAL date (a new off-session PaymentIntent each)", async () => {
    const st = bank();
    const w = await world(st);
    const dates = w.items.map((p) => p.actionBy!.getTime());
    await press(w.dev.cookie, seenAll(w));
    const [one] = await allOf(w.devId);
    const r = await confirm(w.dev.cookie, { paymentId: one.id }); // the bank's page ended without approving
    expect(r.status).toBe(402);
    expect(r.body.error.message).toBe(T.ALL_NOT_CONFIRMED);
    expect(st.cancelled).toContain(one.actionPi);
    expect(await db.payment.findUniqueOrThrow({ where: { id: one.id } })).toMatchObject({ status: "cancelled" });
    const now = await rowsOf(w.items.map((x) => x.id));
    for (let i = 0; i < 3; i++) {
      expect(now[i]).toMatchObject({ status: "needs_confirmation", coveredById: null });
      expect(now[i].actionPi).toBeTruthy();
      expect(now[i].actionPi).not.toBe(w.items[i].actionPi);
      expect(now[i].actionBy!.getTime()).toBe(dates[i]);
    }
    // One combined charge + one new off-session check each (made the way a charge made while away is).
    expect(st.made.slice(1).map((m) => [m.amount, m.off_session])).toEqual([[1000, true], [1200, true], [2000, true]]);
    expect((await confirmItems(w.devId)).map((i) => i.id)).toEqual(w.items.map((p) => p.id));
    // They're new confirms again: in the dashboard box, and the one bell line for charges waiting for the bank is sent again (unread).
    expect((await bankToConfirm(w.devId)).map((r) => r.id).sort()).toEqual(w.items.map((p) => p.id).sort());
    const bell = await db.notification.findFirstOrThrow({ where: { userId: w.devId, reminderKey: "bankwait" }, orderBy: { createdAt: "desc" } });
    expect(bell).toMatchObject({ text: expect.stringMatching(/^Your bank wants you to confirm 3 payments \(\$42\.00 in all\)/), readAt: null });
    expect(await db.payment.count({ where: { id: { in: w.items.map((p) => p.id) }, status: { in: ["charged", "failed"] } } })).toBe(0);
  });

  it("Cancel this check (another tab): the same: each back to its own Confirm", async () => {
    const st = bank();
    const w = await world(st);
    await press(w.dev.cookie, seenAll(w));
    const [one] = await allOf(w.devId);
    const r = await press(w.dev.cookie, { cancel: one.id });
    expect(r.status).toBe(200);
    expect(r.body.line).toBe(T.ALL_CANCELLED);
    expect((await confirmItems(w.devId))).toHaveLength(3);
    expect(st.cancelled).toContain(one.actionPi);
  });

  it("the card is declined at the one payment: nothing charged; each back to its own Confirm; one declined again on its own follows the usual decline", async () => {
    const st = bank();
    const w = await world(st);
    st.declineOnSession.add("pm_dev");
    const r = await press(w.dev.cookie, seenAll(w));
    expect(r.status).toBe(402);
    expect(r.body.error.message).toBe(`Your card was declined. Nothing was charged. ${T.ALL_BACK}`);
    for (const p of await rowsOf(w.items.map((x) => x.id))) expect(p).toMatchObject({ status: "needs_confirmation", coveredById: null, actionPi: expect.any(String) });
    // Declined outright everywhere: each is declined on its own (a payment hold).
    const st2 = bank();
    const w2 = await world(st2);
    st2.decline.add("pm_dev");
    const r2 = await press(w2.dev.cookie, seenAll(w2));
    expect(r2.status).toBe(402);
    // The first declined starts a payment hold; during a hold the others wait for the lift (§113), as when charges are declined one after another.
    expect((await rowsOf(w2.items.map((x) => x.id))).map((p) => p.status)).toEqual(["failed", "deferred", "deferred"]);
    expect((await db.user.findUniqueOrThrow({ where: { id: w2.devId } })).holdStartedAt).toBeTruthy();
  });

  it("its deadline is the earliest of the items' dates: run out there → every item counts as not confirmed, as if each ran out on its own", async () => {
    const st = bank();
    const w = await world(st);
    await db.payment.update({ where: { id: w.items[1].id }, data: { actionBy: new Date(Date.now() + 10 * MIN) } });
    await press(w.dev.cookie, seenAll(w));
    const [one] = await allOf(w.devId);
    const by = (await db.payment.findUniqueOrThrow({ where: { id: one.id } })).actionBy!.getTime();
    expect(Math.abs(by - (Date.now() + 10 * MIN))).toBeLessThan(5000);
    await expireActions(new Date(Date.now() + 11 * MIN));
    expect(st.cancelled).toContain(one.actionPi);
    // Exactly as when their own checks run out together: the first counts as declined (a payment hold starts), the others then wait for the lift (§113).
    const rows = await rowsOf(w.items.map((x) => x.id));
    expect(rows.map((p) => p.status)).toEqual(["failed", "deferred", "deferred"]);
    for (const p of rows) expect(p).toMatchObject({ coveredById: null, actionPi: null, actionBy: null });
    expect((await db.user.findUniqueOrThrow({ where: { id: w.devId } })).holdStartedAt).toBeTruthy();
    expect(st.made).toHaveLength(1); // no new checks
  });

  it("left open (its 15 minutes end before any date): each back to its own Confirm with its original date", async () => {
    const st = bank();
    const w = await world(st);
    const dates = w.items.map((p) => p.actionBy!.getTime());
    await press(w.dev.cookie, seenAll(w));
    await expireActions(new Date(Date.now() + 16 * MIN));
    const now = await rowsOf(w.items.map((x) => x.id));
    now.forEach((p, i) => expect(p).toMatchObject({ status: "needs_confirmation", coveredById: null, actionBy: new Date(dates[i]) }));
    expect(now.every((p) => p.actionPi)).toBe(true);
  });

  it("a single Confirm at the same moment as Confirm all: exactly one charge per item", async () => {
    for (let run = 0; run < 3; run++) {
      const st = bank();
      const w = await world(st);
      const a = w.items[0];
      st.approve(a.actionPi!); // its own bank page was approved
      await Promise.all([confirm(w.dev.cookie, { paymentId: a.id }), press(w.dev.cookie, seenAll(w))]);
      const [ra] = await rowsOf([a.id]);
      expect(ra).toMatchObject({ status: "charged", stripePaymentIntentId: a.actionPi });
      const ones = await allOf(w.devId);
      // Whatever won, A is never in the one payment, and nothing was charged twice.
      for (const one of ones) expect(await db.payment.count({ where: { id: a.id, coveredById: one.id } })).toBe(0);
      expect(ones.reduce((s, o) => s + (o.status === "cancelled" ? 0 : o.amountCents), 0)).toBeLessThanOrEqual(3200);
      expect(await db.notification.count({ where: { userId: w.devId, text: { startsWith: "You paid $10.00" } } })).toBe(1);
    }
  });

  it("two Confirm all in two tabs at once: one payment", async () => {
    const st = bank();
    const w = await world(st);
    const rs = await Promise.all([press(w.dev.cookie, seenAll(w)), press(w.dev.cookie, seenAll(w))]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await allOf(w.devId)).toHaveLength(1);
    expect(st.made).toHaveLength(1);
    const late = rs.find((r) => r.status === 409)!;
    expect(late.body.error.message).toBe(T.ALL_BUSY);
    // An old tab's own Confirm on one of them is refused plainly.
    const old = await confirm(w.dev.cookie, { paymentId: w.items[0].id, start: true });
    expect(old.status).toBe(409);
    expect(old.body.error.message).toBe(T.IN_CONFIRM_ALL);
  });

  it("stops once when the page showed something else (each change named); the second press goes ahead", async () => {
    const st = bank();
    const w = await world(st);
    const r = await press(w.dev.cookie, { seenTotalCents: 2200, seenIds: w.items.slice(0, 2).map((p) => p.id) });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("stop_once");
    const changes = r.body.error.changes as { text: string }[];
    expect(changes.map((c) => c.text)).toEqual([`Also waiting for your bank now: ${NAMES[2]}`, "Confirm all now covers 3 payments: $42.00."]);
    expect(st.made).toHaveLength(0);
    const again = await press(w.dev.cookie, { seenTotalCents: r.body.error.totalCents, seenIds: r.body.error.ids, confirmed: true });
    expect(again.status).toBe(200);
    expect(st.made[0].amount).toBe(4200);
  });

  it("a renewal keeps its own Confirm: left out of the total, said in a small line", async () => {
    const st = bank();
    const w = await world(st);
    const sub = await db.payment.create({ data: { kind: "subscription", developerId: w.devId, testerId: w.devId, amountCents: 900, feeCents: 900, testerCents: 0, transferStatus: "none", status: "needs_confirmation", note: "sub:sub_x", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 86_400_000) } });
    const s = await confirmAllState(w.devId);
    expect(s.ids).toEqual(w.items.map((p) => p.id));
    expect(s.totalCents).toBe(4200);
    expect(s.leftOut).toBe("Your plan's renewal $9.00 isn't in Confirm all: confirm it on its own.");
    await press(w.dev.cookie, seenAll(w));
    expect(st.made[0].amount).toBe(4200);
    expect(await db.payment.findUniqueOrThrow({ where: { id: sub.id } })).toMatchObject({ actionPi: sub.actionPi, coveredById: null });
  });

  it("a bank dispute on the one payment: its whole amount owed once plus ONE $15 fee; the reversed line lists every item it covered", async () => {
    const st = bank();
    const w = await world(st);
    await press(w.dev.cookie, seenAll(w));
    const [one] = await allOf(w.devId);
    st.approve(one.actionPi!);
    await confirm(w.dev.cookie, { paymentId: one.id });
    expect(await chargebackOpened(one.actionPi!)).toBe(true);
    expect(await chargebackOpened(one.actionPi!)).toBe(false); // delivered twice: once
    const debts = await owed(w.devId);
    expect(debts.map((d) => [d.id, d.amountCents])).toEqual([[one.id, 4200 + R.CHARGEBACK_FEE_CENTS]]);
    for (const p of await rowsOf(w.items.map((x) => x.id))) expect(p).toMatchObject({ status: "charged", chargeback: "" });
    const lines = await owedLines(w.devId);
    expect(lines).toHaveLength(1);
    // (Owner, Nov 4, §193b) The line names the Confirm all payment, when it was made and every item it paid.
    expect(lines[0].text).toMatch(/^Your bank reversed your \$42 Confirm all payment on \w{3}, \w{3} \d+, \d+:\d\d [AP]M \(Ana Silva's written answers on “Harbor Run”, Ben Okafor's written answers on “Sky Lab”, Ana Silva's written answers on “Sky Lab”\): \$42 \+ \$15 chargeback fee$/);
    expect("covers" in lines[0] ? lines[0].covers?.map((c: { text: string }) => c.text) : null).toEqual(NAMES);
  });
  it("over $200: a single Confirm with your bank needs the tick “I confirm this payment is over $200.”; $200 or less doesn't", async () => {
    const st = bank();
    const w = await world(st);
    await db.payment.update({ where: { id: w.items[2].id }, data: { amountCents: 25000 } });
    await db.payment.update({ where: { id: w.items[1].id }, data: { amountCents: 20000 } });
    expect((await confirm(w.dev.cookie, { paymentId: w.items[1].id, start: true })).status).toBe(200); // exactly $200: no tick
    const no = await confirm(w.dev.cookie, { paymentId: w.items[2].id, start: true });
    expect(no.status).toBe(400);
    expect(no.body.error).toMatchObject({ code: "needs_tick", message: "Tick “I confirm this payment is over $200.” to pay." });
    expect((await confirm(w.dev.cookie, { paymentId: w.items[2].id, start: true, over200: true })).status).toBe(200);
    // The box and Payments hand each item its amount (the tick shows over $200).
    expect((await confirmItems(w.devId)).map((i) => i.cents)).toEqual([1000, 20000, 25000]);
  });

  it("Confirm all over $200 needs the tick; a total that crosses $200 since the page drew stops once saying so; the press after needs the tick", async () => {
    const st = bank();
    const w = await world(st);
    await db.payment.update({ where: { id: w.items[2].id }, data: { amountCents: 19500 } });
    // The page showed the first two ($22.00); the third ($195.00) came in since: $217.00 in all.
    const r = await press(w.dev.cookie, { seenTotalCents: 2200, seenIds: w.items.slice(0, 2).map((p) => p.id) });
    expect(r.status).toBe(409);
    const lines = (r.body.error.changes as { text: string }[]).map((c) => c.text);
    expect(lines[lines.length - 1]).toBe("Confirm all now covers 3 payments: $217.00. Tick “I confirm this payment is over $200.” and press again to go ahead.");
    const again = { seenTotalCents: r.body.error.totalCents, seenIds: r.body.error.ids, confirmed: true };
    const noTick = await press(w.dev.cookie, again);
    expect(noTick.status).toBe(400);
    expect(noTick.body.error.message).toBe("Tick “I confirm this payment is over $200.” to pay.");
    expect(st.made).toHaveLength(0);
    expect((await press(w.dev.cookie, { ...again, over200: true })).status).toBe(200);
    expect(st.made[0].amount).toBe(21700);
  });
});
