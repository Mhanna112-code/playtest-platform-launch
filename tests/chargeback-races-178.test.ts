import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { chargebackOpened, disputeAmountChanged, liftHoldIfClear, owedItemName, owedLines, payOwed, payable } from "@/lib/server/holds";
import { approveChargebackHold, chargebackSteps } from "@/lib/server/chargeback";
import { chargeOwedTotal, coveredNames } from "@/lib/server/owedOnce";
import { setStripeForTests } from "@/lib/server/stripe";
import { renderTimes } from "@/lib/tz";
import { bookCall, joined, sact, settle, setup } from "./fixtures";

// (Owner, Nov 4, §178) Three things seen on the local site:
// 1. A chargeback on the very Pay what you owe payment that was lifting the hold (the 0259 card: every payment disputed) was recorded while the lift was under way,
//    and the lift then cleared the hold: an open chargeback with no hold. Either order must leave the account on a chargeback hold.
// 2. The team approved a new chargeback hold the same second it appeared, and the approval was gone a minute later: chargebackOpened cleared it at its very end.
//    Only a NEW chargeback clears an approval; notices about one already recorded never do, and an approval made while the opening is processed stands.
// 3. Two owed lines read the same ("… bb's live call on “excerptexcer…” (Nov 4)": the payment's day): a call is named by its own date and time.

afterEach(() => setStripeForTests(null));

/** A Stripe stand-in: every charge goes through. */
function bank() {
  const st = { made: [] as { id: string; amount: number }[] };
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; capture_method?: string }) => {
        const id = "pi_" + randomUUID();
        st.made.push({ id, ...p });
        return { id, status: p.capture_method === "manual" ? "requires_capture" : "succeeded" };
      },
      retrieve: async (id: string) => ({ id, status: "succeeded", latest_charge: id.replace(/^pi_/, "ch_") }),
      cancel: async (id: string) => ({ id, status: "canceled" }),
      capture: async (id: string) => ({ id, status: "succeeded" }),
    },
    refunds: { create: async () => ({ id: "re_" + randomUUID() }) },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
    customers: { update: async () => ({}) },
    paymentMethods: { retrieve: async () => ({ id: "pm_saved", type: "card", card: { brand: "visa", last4: "0259", exp_month: 12, exp_year: 2030 } }) },
  } as unknown as Stripe);
  return st;
}

/** A developer with a saved card and two testers' written answers sent (testers ready for payouts). */
async function world() {
  const s = await setup();
  const t = [];
  for (const name of ["Ana Silva", "Ben Okafor"]) {
    const j = await joined(s.testId, name);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
    await db.user.update({ where: { id: j.tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 12), payoutsReady: true } });
    t.push({ ...j, sub: await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } }) });
  }
  await settle();
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_saved" } });
  return { ...s, t };
}
type W = Awaited<ReturnType<typeof world>>;
const paid = (w: W, i: number, cents: number) => db.payment.create({ data: { kind: "review", contractId: w.t[i].sessionId, submissionId: w.t[i].sub.id, developerId: w.dev.user.id, testerId: w.t[i].tester.user.id, amountCents: cents, feeCents: cents / 10, testerCents: cents - cents / 10, status: "charged", transferStatus: "sent", stripePaymentIntentId: "pi_" + randomUUID() } });
const user = (id: string) => db.user.findUniqueOrThrow({ where: { id } });
const verified = (w: W) => db.user.update({ where: { id: w.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** An earlier chargeback on this account, long resolved (so this one is reviewed first: the owner's case, a 2nd+ chargeback). */
const earlierChargeback = (w: W) => db.payment.create({ data: { kind: "review", contractId: w.t[1].sessionId, developerId: w.dev.user.id, testerId: w.t[1].tester.user.id, amountCents: 500, feeCents: 50, testerCents: 450, status: "charged", chargeback: "resolved", reversedCents: 500, stripePaymentIntentId: "pi_" + randomUUID() } });

/** A review-first chargeback hold the team approved, the card verified: what's left is Pay what you owe (which lifts it). */
async function approvedHold() {
  const w = await world();
  const st = bank();
  await earlierChargeback(w);
  const p = await paid(w, 0, 1000);
  expect(await chargebackOpened(p.stripePaymentIntentId!, 1000)).toBe(true);
  expect(await approveChargebackHold(w.dev.user.id)).toMatchObject({ allowedToPay: true });
  await verified(w);
  return { w, st, p, dev: w.dev.user.id };
}
/** Pay what you owe's one payment, charged and recorded (its debts paid) but the hold not lifted yet: the moment between the payment and the lift. */
async function paidNotLifted(dev: string) {
  const r = await chargeOwedTotal(await user(dev), await payable(dev), "press", { reviewFirst: "x" });
  expect(r.result).toBe("paid");
  const one = await db.payment.findFirstOrThrow({ where: { developerId: dev, kind: "owed", status: "bundled" } });
  expect((await user(dev)).holdStartedAt).not.toBeNull();
  return one;
}

/** The developer's row locked by another transaction until `release`: each step that needs the lock queues behind it (in order). */
async function lockUser(devId: string) {
  let release!: () => void, ready!: () => void;
  const gate = new Promise<void>((r) => (release = r)), locked = new Promise<void>((r) => (ready = r));
  let pid = 0;
  const done = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${devId} FOR UPDATE`;
    pid = Number((await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid);
    ready();
    await gate;
  }, { timeout: 60_000, maxWait: 20_000 });
  await locked;
  /** Waits until `n` sessions are queued behind the lock (directly or behind one another). */
  const queued = async (n: number) => {
    for (let i = 0; i < 600; i++) {
      const rows = await db.$queryRaw<{ n: bigint }[]>`WITH RECURSIVE w(pid) AS (SELECT a.pid FROM pg_stat_activity a WHERE ${pid}::int = ANY(pg_blocking_pids(a.pid)) UNION SELECT a.pid FROM pg_stat_activity a, w WHERE w.pid = ANY(pg_blocking_pids(a.pid))) SELECT count(*) AS n FROM w`;
      if (Number(rows[0].n) >= n) return;
      await sleep(20);
    }
    throw new Error(`fewer than ${n} steps queued behind the lock`);
  };
  return { queued, release: async () => { release(); await done; } };
}

describe("§178 problem 1: a chargeback on the payment that is lifting the hold always leaves a chargeback hold", () => {
  it("after the lift (the owner's case: the dispute arrived a second after Pay what you owe went through): a new chargeback hold starts", async () => {
    const { st, dev } = await approvedHold();
    expect(await payOwed({ id: dev }, {})).toMatchObject({ lifted: true });
    expect((await user(dev)).holdStartedAt).toBeNull();
    const pi = st.made[0].id;
    expect(await chargebackOpened(pi, 2500)).toBe(true);
    const u = await user(dev);
    expect([!!u.holdStartedAt, u.holdReason, u.chargebackApprovedAt, u.chargebackCardVerifiedAt]).toEqual([true, "chargeback", null, null]);
    expect(await db.payment.findFirstOrThrow({ where: { stripePaymentIntentId: pi, kind: "owed" } })).toMatchObject({ chargeback: "open", reversedCents: 2500 });
    expect((await owedLines(dev)).map((l) => l.amountCents)).toEqual([2500 + 1500]);
    expect(await chargebackSteps(dev)).toMatchObject({ reviewFirst: true, count: 3, approved: false });
  });

  it("before the lift (between the payment going through and the lift): the lift stops, the hold stays, the approval is gone", async () => {
    const { dev } = await approvedHold();
    const one = await paidNotLifted(dev);
    expect(await chargebackOpened(one.stripePaymentIntentId!, 2500)).toBe(true);
    expect(await liftHoldIfClear(dev)).toBe(false);
    const u = await user(dev);
    expect([!!u.holdStartedAt, u.holdReason, u.chargebackApprovedAt]).toEqual([true, "chargeback", null]);
    expect(await chargebackSteps(dev)).toMatchObject({ reviewFirst: true, count: 3, approved: false });
  });

  it("at the same moment, the chargeback first: it is recorded under the lock before the lift's last check, and the lift stops", async () => {
    const { dev } = await approvedHold();
    const one = await paidNotLifted(dev);
    const lock = await lockUser(dev);
    const opening = chargebackOpened(one.stripePaymentIntentId!, 2500);
    await lock.queued(1);
    // The lift's first checks pass now (the chargeback isn't recorded yet); its last check waits for the lock, behind the chargeback.
    const lifting = liftHoldIfClear(dev);
    await lock.queued(2);
    await lock.release();
    expect(await Promise.all([opening, lifting])).toEqual([true, false]);
    const u = await user(dev);
    expect([!!u.holdStartedAt, u.holdReason, u.chargebackApprovedAt]).toEqual([true, "chargeback", null]);
    expect(await db.payment.count({ where: { developerId: dev, chargeback: "open" } })).toBe(1);
    expect(await db.accountEvent.count({ where: { userId: dev, kind: "hold-lifted" } })).toBe(0);
  });

  it("at the same moment, the lift first: it lifts, then the chargeback finds no hold and starts a new one (never an open chargeback with no hold)", async () => {
    const { dev } = await approvedHold();
    const one = await paidNotLifted(dev);
    const was = (await user(dev)).holdStartedAt!;
    const lock = await lockUser(dev);
    const lifting = liftHoldIfClear(dev);
    await lock.queued(1);
    const opening = chargebackOpened(one.stripePaymentIntentId!, 2500);
    await lock.queued(2);
    await lock.release();
    expect(await Promise.all([lifting, opening])).toEqual([true, true]);
    const u = await user(dev);
    expect([!!u.holdStartedAt, u.holdReason, u.chargebackApprovedAt, u.chargebackCardVerifiedAt]).toEqual([true, "chargeback", null, null]);
    expect(u.holdStartedAt!.getTime()).toBeGreaterThan(was.getTime());
    expect((await db.accountEvent.findMany({ where: { userId: dev, kind: { in: ["hold", "hold-lifted"] } }, orderBy: { createdAt: "asc" } })).map((e) => e.kind)).toEqual(["hold", "hold-lifted", "hold"]);
    expect(await db.payment.count({ where: { developerId: dev, chargeback: "open" } })).toBe(1);
  });

  it("a dispute already recorded whose hold never started (the old race, or a run that stopped midway) starts it when Stripe sends it again", async () => {
    const w = await world();
    bank();
    const p = await paid(w, 0, 1000);
    await db.payment.update({ where: { id: p.id }, data: { chargeback: "open", chargebackAt: new Date(), reversedCents: 1000 } });
    expect((await user(w.dev.user.id)).holdStartedAt).toBeNull();
    expect(await chargebackOpened(p.stripePaymentIntentId!, 1000)).toBe(false);
    const u = await user(w.dev.user.id);
    expect([!!u.holdStartedAt, u.holdReason]).toEqual([true, "chargeback"]);
    expect(await db.payment.count({ where: { developerId: w.dev.user.id, chargeback: "open" } })).toBe(1);
  });
});

describe("§178 problem 2: only a new chargeback undoes the team's approval", () => {
  it("an approval made the moment the hold appears, while the chargeback is still being processed, stands", async () => {
    const w = await world();
    bank();
    await earlierChargeback(w);
    const p = await paid(w, 0, 1000);
    const dev = w.dev.user.id;
    let finished = false;
    const opening = chargebackOpened(p.stripePaymentIntentId!, 1000).then((r) => ((finished = true), r));
    let approvedMidway = false;
    for (let i = 0; i < 2000 && !finished; i++) {
      if ((await db.user.findUniqueOrThrow({ where: { id: dev }, select: { holdStartedAt: true } })).holdStartedAt) {
        approvedMidway = !finished;
        await approveChargebackHold(dev);
        break;
      }
      await sleep(2);
    }
    expect(await opening).toBe(true);
    if (!approvedMidway) await approveChargebackHold(dev); // (the opening finished first on a fast machine: the outcome is checked all the same)
    expect(await chargebackSteps(dev)).toMatchObject({ reviewFirst: true, count: 2, approved: true });
    await sleep(50);
    expect((await user(dev)).chargebackApprovedAt).not.toBeNull();
  });

  it("repeated or late notices about the same dispute (created again, updated) never clear it; a resolved one is never reopened; a new dispute does clear it", async () => {
    const w = await world();
    bank();
    const earlier = await earlierChargeback(w);
    const p = await paid(w, 0, 1000);
    const dev = w.dev.user.id;
    expect(await chargebackOpened(p.stripePaymentIntentId!, 1000)).toBe(true);
    await approveChargebackHold(dev);
    await verified(w);
    // charge.dispute.created again (a retry, or a second delivery): nothing changes.
    expect(await chargebackOpened(p.stripePaymentIntentId!, 1000)).toBe(false);
    // charge.dispute.updated with the same amount, then with a new one (followed: nothing of it is paid yet).
    expect(await disputeAmountChanged(p.stripePaymentIntentId!, 1000, "needs_response")).toBe("same");
    expect(await disputeAmountChanged(p.stripePaymentIntentId!, 600, "under_review")).toBe("followed");
    // The earlier chargeback's dispute arriving again (the team resolved it long ago): not reopened.
    expect(await chargebackOpened(earlier.stripePaymentIntentId!, 500)).toBe(false);
    expect((await db.payment.findUniqueOrThrow({ where: { id: earlier.id } })).chargeback).toBe("resolved");
    let u = await user(dev);
    expect([!!u.chargebackApprovedAt, !!u.chargebackCardVerifiedAt]).toEqual([true, true]);
    expect(await chargebackSteps(dev)).toMatchObject({ count: 2, approved: true });
    // A dispute never seen before: the team reviews again.
    const q = await paid(w, 1, 800);
    expect(await chargebackOpened(q.stripePaymentIntentId!, 800)).toBe(true);
    u = await user(dev);
    expect([u.chargebackApprovedAt, u.chargebackCardVerifiedAt]).toEqual([null, null]);
    expect(await chargebackSteps(dev)).toMatchObject({ count: 3, approved: false });
  });

  it("an Approve of a 1st chargeback resolves only the chargebacks open when it is claimed: one that opens during the press stays open, and so does the hold", async () => {
    const w = await world();
    bank();
    const p = await paid(w, 0, 1000);
    const dev = w.dev.user.id;
    await chargebackOpened(p.stripePaymentIntentId!, 1000);
    await verified(w);
    await payOwed({ id: dev }, {}); // a 1st chargeback: reserved on the card, taken on the team's Approve
    const lock = await lockUser(dev);
    const approving = approveChargebackHold(dev);
    await lock.queued(1);
    const q = await paid(w, 1, 800);
    const opening = chargebackOpened(q.stripePaymentIntentId!, 800);
    await lock.queued(2);
    await lock.release();
    await Promise.all([approving, opening]);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).chargeback).toBe("resolved");
    expect((await db.payment.findUniqueOrThrow({ where: { id: q.id } })).chargeback).toBe("open");
    const u = await user(dev);
    expect([!!u.holdStartedAt, u.holdReason, u.chargebackApprovedAt]).toEqual([true, "chargeback", null]);
    expect(await chargebackSteps(dev)).toMatchObject({ reviewFirst: true, count: 2, approved: false });
  });
});

describe("§178 problem 3: an owed line names a call by its own date and time, in the developer's zone", () => {
  it("two reversed $15.50 calls of the same tester a few minutes apart read as two different lines (never the payment's day, never a raw marker)", async () => {
    const s = await setup();
    const dev = s.dev.user.id;
    await db.user.update({ where: { id: dev }, data: { timeZone: "America/Chicago" } });
    const j = await joined(s.testId, "Ana Silva");
    const starts = [new Date("2026-10-27T12:15:00Z"), new Date("2026-10-27T12:21:00Z")];
    const calls = [];
    for (const [i, at] of starts.entries()) {
      const b = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48 + 24 * i);
      calls.push(await db.call.update({ where: { id: b.id }, data: { startsAt: at, actualMinutes: 30 } }));
    }
    const pays = [];
    for (const c of calls) pays.push(await db.payment.create({ data: { kind: "call", callId: c.id, contractId: j.sessionId, developerId: dev, testerId: j.tester.user.id, amountCents: 1550, feeCents: 155, testerCents: 1395, status: "charged", transferStatus: "sent", stripePaymentIntentId: "pi_" + randomUUID(), chargeback: "open", chargebackAt: new Date(), reversedCents: 1550 } }));
    await db.user.update({ where: { id: dev }, data: { holdStartedAt: new Date(), holdReason: "chargeback", holdCount: 1 } });
    const lines = await owedLines(dev);
    expect(lines.map((l) => l.text)).toEqual([
      "Your bank reversed $15.50 you paid for Ana Silva's live call on “Harbor Run” (Tue, Oct 27, 7:15 AM): $15.50 + $15 chargeback fee",
      "Your bank reversed $15.50 you paid for Ana Silva's live call on “Harbor Run” (Tue, Oct 27, 7:21 AM): $15.50 + $15 chargeback fee",
    ]);
    for (const l of lines) expect(`${l.text} ${l.full}`).not.toContain("⟦t:");
    // The receipt's name (a time token, written in each reader's zone with the zone named) and Payments' covered items (the page's own wording).
    expect(renderTimes(await owedItemName(pays[0], true), "America/Chicago")).toBe("a payment your bank had reversed (Ana Silva's live call on “Harbor Run” (Tue, Oct 27, 7:15 AM CDT))");
    const one = await db.payment.create({ data: { kind: "owed", developerId: dev, testerId: dev, amountCents: 1550, feeCents: 1550, testerCents: 0, status: "paying", note: "press" } });
    await db.payment.create({ data: { kind: "call", callId: calls[1].id, contractId: j.sessionId, developerId: dev, testerId: j.tester.user.id, amountCents: 1550, feeCents: 0, testerCents: 0, status: "owed", coveredById: one.id } });
    expect((await coveredNames([one.id])).get(one.id)).toEqual(["Ana Silva's live call on “Harbor Run” (Tue, Oct 27, 7:21 AM) $15.50"]);
    await db.payment.updateMany({ where: { developerId: dev, status: { in: ["paying", "owed"] } }, data: { status: "cancelled", coveredById: null } });
  });
});
