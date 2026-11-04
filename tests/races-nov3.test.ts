import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { decideDispute, decideLockedLine } from "@/lib/server/payments";
// (Batch 35 §162) The developer of setup() is "she": the refusal reads "her bank".
const DECIDE_LOCKED = decideLockedLine("she");
import { setStripeForTests } from "@/lib/server/stripe";
import { chargebackOpened, disputeAmountChanged, owed, payOwed } from "@/lib/server/holds";
import { signUp } from "@/lib/server/passwords";
import { finishGoogleSignup, startGoogleSignup } from "@/lib/server/google";
import { addWritten, stopTest } from "@/lib/server/tests";
import { updateWaiting } from "@/lib/moneyLines";
import { pressLabelOf } from "@/lib/pressLabels";
import { keptRefusalLine } from "@/lib/keptRefusal";
import { pressAgainLine } from "@/lib/rules";
import { email, json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 3, races) Seven bugs the race recordings found: each test fires both presses at once (or with the second landing while the first is in flight) and
// checks that exactly one outcome happens.

afterEach(() => setStripeForTests(null));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const outcome = <T>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e: e as Error & { code?: string; data?: Record<string, unknown> } }));

/**
 * A Stripe stand-in whose charges wait at a gate until `open()` (`gated: false`: they go through at once). `made`: every charge's amount; `called`: resolves at the
 * first charge.
 */
function gatedStripe(gated = true) {
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  let first!: () => void;
  const called = new Promise<void>((r) => { first = r; });
  const made: number[] = [];
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number }) => {
        made.push(p.amount);
        first();
        if (gated) await gate;
        return { id: "pi_" + randomUUID(), status: "succeeded" };
      },
    },
  } as unknown as Stripe);
  return { made, called, open: () => open() };
}

const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);

/** Ana's written answers paid $4.00, then disputed; an admin; the developer's card saved. */
async function disputed() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful" })).status).toBe(200);
  expect((await sact(j.sessionId, "dispute", j.tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true })).status).toBe(200);
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
  const a = await makeUser({ name: "Admin" });
  const admin = await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  const row = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
  await settle();
  return { ...s, ...j, sub, admin, row };
}
/** What the piece was paid in all (its Pay, every Pay more and the decision's raise), counting what is being charged right now. */
async function paidOnPiece(submissionId: string) {
  const r = await db.review.findFirstOrThrow({ where: { submissionId } });
  const more = await db.payment.aggregate({ where: { submissionId, kind: { in: ["extra", "dispute"] }, status: { in: ["charged", "not_set_up", "pending"] } }, _sum: { amountCents: true } });
  return r.amountCents + (more._sum.amountCents ?? 0);
}

describe("(Nov 3, races) 1: the team's Decide and the developer's Pay more on the same piece", () => {
  it("Decide first, Pay more while its charge is in flight: Pay more stops once naming the team's decision; one charge; paid $10 against the $10 decision", async () => {
    const w = await disputed();
    const st = gatedStripe();
    const loaded = seen();
    await settle();
    const decide = outcome(decideDispute(w.admin, w.row.id, { total: "10.00", tickCents: 600 }));
    await st.called; // the decision's charge is at the bank
    const more = act(w.testId, "pay-extra", w.dev.cookie, { seenAt: loaded, contractId: w.sessionId, submissionId: w.sub.id, amount: "6.00", tickedCents: 600, payKey: randomUUID() });
    await sleep(400);
    st.open();
    const [d, m] = await Promise.all([decide, more]);
    expect(d).toMatchObject({ ok: true, v: { extraCents: 600 } });
    expect([m.status, m.body.error?.code]).toEqual([409, "stop_once"]);
    expect(m.body.error.changes.map((c: { text: string }) => c.text)).toContain("The team decided Ana Silva's dispute: raised the pay to $10.00 ($6.00 more)");
    expect(st.made).toEqual([600]);
    expect(await paidOnPiece(w.sub.id)).toBe(1000);
  });

  it("Pay more first, Decide while its charge is at the bank: Decide waits for it (§70's refusal), nothing is charged twice", async () => {
    const w = await disputed();
    const st = gatedStripe();
    const more = act(w.testId, "pay-extra", w.dev.cookie, { seenAt: seen(), contractId: w.sessionId, submissionId: w.sub.id, amount: "6.00", tickedCents: 600, payKey: randomUUID() });
    await st.called; // Pay more's $6.00 is at the bank
    const decide = outcome(decideDispute(w.admin, w.row.id, { total: "10.00", tickCents: 600 }));
    await sleep(400);
    st.open();
    const [m, d] = await Promise.all([more, decide]);
    expect(m.status).toBe(200);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.e.message).toBe(DECIDE_LOCKED);
    expect(st.made).toEqual([600]);
    expect((await db.dispute.findUniqueOrThrow({ where: { id: w.row.id } })).status).toBe("open");
  });

  it("a Pay more that went through after Decide read the piece (before its claim): the decision charges only what is still due", async () => {
    for (const [moreCents, dueCents] of [[600, 0], [300, 300]]) {
      const w = await disputed();
      const st = gatedStripe(false);
      const c = await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } });
      // Hold the test's lock while Decide reads the piece ($4.00 paid), then the Pay more is recorded and the lock let go.
      let locked!: () => void, release!: () => void;
      const isLocked = new Promise<void>((r) => { locked = r; });
      const held = new Promise<void>((r) => { release = r; });
      const holder = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${w.testId} FOR UPDATE`;
        locked();
        await held;
        await tx.payment.create({ data: { kind: "extra", contractId: c.id, submissionId: w.sub.id, developerId: w.dev.user.id, testerId: c.testerId, amountCents: moreCents, feeCents: 0, testerCents: 0, status: "charged" } });
      }, { timeout: 15_000 });
      await isLocked;
      const [d] = await Promise.all([outcome(decideDispute(w.admin, w.row.id, { total: "10.00", tickCents: 600 })), sleep(400).then(() => release())]);
      await holder;
      expect(d).toMatchObject({ ok: true, v: { extraCents: dueCents } });
      expect(st.made).toEqual(dueCents ? [dueCents] : []);
      expect(await paidOnPiece(w.sub.id)).toBe(400 + moreCents + dueCents);
      const line = (await db.testEvent.findFirstOrThrow({ where: { testId: w.testId, kind: "admin" } })).text;
      expect(line).toBe(dueCents ? "The team decided Ana Silva's dispute: raised the pay to $10.00 ($3.00 more)" : "The team decided Ana Silva's dispute: raised the pay to $10.00, which was already paid: nothing more was charged");
    }
  });

  it("both pressed at the same moment (Promise.all): exactly one charge; the piece ends at the decided $10", async () => {
    for (const lag of [0, 3, 8]) {
      const w = await disputed();
      const st = gatedStripe(false);
      const loaded = seen();
      await settle();
      const [d, m] = await Promise.all([
        outcome(decideDispute(w.admin, w.row.id, { total: "10.00", tickCents: 600 })),
        sleep(lag).then(() => act(w.testId, "pay-extra", w.dev.cookie, { seenAt: loaded, contractId: w.sessionId, submissionId: w.sub.id, amount: "6.00", tickedCents: 600, payKey: randomUUID() })),
      ]);
      // One of them charged $6.00, never both: the piece is paid the decided $10.00.
      expect(st.made).toEqual([600]);
      expect(await paidOnPiece(w.sub.id)).toBe(1000);
      if (!d.ok) expect([d.e.message, m.status]).toEqual([DECIDE_LOCKED, 200]); // Pay more reserved first: Decide waits for it
      else if (m.status !== 200) expect(m.body.error.changes.map((c: { text: string }) => c.text)).toContain("The team decided Ana Silva's dispute: raised the pay to $10.00 ($6.00 more)");
      else expect(d.v.extraCents).toBe(0); // Pay more went through before Decide's claim: nothing more was due
    }
  });
});

describe("(Nov 3, races) 2: Join while the developer's Edit lowers the price", () => {
  it("a Join from a page showing the old listing never joins on the new one: it stops once naming the change (or joins on the listing it showed)", async () => {
    let stopped = 0;
    for (const lag of [0, 2, 4, 6, 8, 10, 14, 20]) {
      const s = await setup();
      const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
      const t = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
      const loaded = seen();
      await settle();
      const [, j] = await Promise.all([
        sleep(lag).then(() => act(s.testId, "edit", s.dev.cookie, { version: t.version, fields: { writtenCents: "6.00" }, confirmed: true })),
        act(s.testId, "join", ana.cookie, { listingVersion: t.listingVersion, seenAt: loaded }),
      ]);
      const c = await db.contract.findFirst({ where: { testId: s.testId, testerId: ana.user.id } });
      if (j.status === 200) {
        // Joined on the listing its page showed: the edit came after the join.
        expect(c!.writtenCents).toBe(1000);
      } else {
        expect([j.status, j.body.error.code]).toEqual([409, "stop_once"]);
        expect(j.body.error.changes.map((x: { text: string }) => x.text)).toEqual(["Nora Lane edited the listing"]);
        expect(c).toBeNull();
        stopped++;
      }
    }
    expect(stopped).toBeGreaterThan(0);
  });
});

describe("(Nov 3, races) 3: Pay what you owe while the bank changes the disputed part", () => {
  async function chargebackHold() {
    const s = await setup();
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const pi = "pi_" + randomUUID();
    const p = await db.payment.create({ data: { kind: "review", contractId: j.sessionId, submissionId: sub.id, developerId: s.dev.user.id, testerId: j.tester.user.id, amountCents: 4000, feeCents: 400, testerCents: 3600, status: "charged", stripePaymentIntentId: pi } });
    await chargebackOpened(pi, 1200); // $12 of the $40 + the $15 fee: $27 owed
    await db.user.update({ where: { id: s.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
    const u = await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } });
    return { ...s, u, p, pi };
  }

  it("never reserves the old amount: either the change is followed and the press stops once on the new total, or the reservation came first and holds the old one", async () => {
    let followed = 0;
    for (const lag of [0, 1, 2, 3, 5, 8, 12]) {
      const w = await chargebackHold();
      expect((await owed(w.u.id)).map((x) => x.amountCents)).toEqual([2700]);
      const [r, change] = await Promise.all([outcome(payOwed(w.u, { seenTotalCents: 2700, seenIds: [w.p.id] })), sleep(lag).then(() => disputeAmountChanged(w.pi, 2000))]);
      const reserved = await db.reservation.findMany({ where: { developerId: w.u.id, status: "reserved" } });
      if (change === "followed") {
        followed++;
        // Owed $35 now: nothing at the old $27; the press stops once with the new total.
        expect(reserved).toEqual([]);
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.e.code).toBe("stop_once");
          expect((r.e.data!.changes as { text: string }[])[0].text).toBe(`What you owe changed: now $35.00. ${pressAgainLine(3500, { cardVerified: true })}`);
          expect(r.e.data!.totalCents).toBe(3500);
        }
        // The second press (its box showed $35.00) reserves $35.00.
        expect(await payOwed(w.u, { seenTotalCents: 3500, seenIds: [w.p.id] })).toMatchObject({ reservedCents: 3500 });
      } else {
        // The reservation came first: the bank's change isn't followed (it's logged) and $27 is what is owed and reserved.
        expect(change).toBe("logged");
        expect(reserved.map((x) => x.amountCents)).toEqual([2700]);
        expect((await owed(w.u.id)).map((x) => x.amountCents)).toEqual([2700]);
      }
    }
    expect(followed).toBeGreaterThan(0);
  });
});

describe("(Nov 3, races) 4: Add to my answers while the developer's Pay is in flight", () => {
  it("the addition is shown as added after the payment once the Pay completes (the Needs you row)", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    const st = gatedStripe();
    const paying = pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    await st.called; // the Pay is at the bank
    const [added] = await Promise.all([sact(j.sessionId, "written-add", j.tester.cookie, { text: "One more thing", seenAt: seen(), confirmed: true }), sleep(300).then(() => st.open())]);
    expect(added.status).toBe(200);
    expect((await paying).status).toBe(200);
    const after = await db.submission.findUniqueOrThrow({ where: { id: sub.id }, include: { review: true } });
    expect(after.review?.amountCents).toBe(1000);
    expect(after.paidUpdateAt).not.toBeNull();
    expect(updateWaiting(after)).toBe(true);
  });

  it("an addition made before the Pay is pressed is what the Pay pays for: no update row", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    expect((await sact(j.sessionId, "written-add", j.tester.cookie, { text: "One more thing", seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    gatedStripe(false);
    expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const after = await db.submission.findUniqueOrThrow({ where: { id: sub.id }, include: { review: true } });
    expect(after.paidUpdateAt).toBeNull();
    expect(updateWaiting(after)).toBe(false);
  });
});

describe("(Nov 3, races) 5: the same email signing up in two tabs", () => {
  const body = (e: string) => ({ email: e, password: "a-long-password", role: "tester", devices: ["Windows PC"], languages: ["English"], name: "Ana Silva", acceptTerms: true, over18: true });
  it("email form: one account; the other tab reads the normal line (not a 500)", async () => {
    const e = email("race");
    const [a, b] = await Promise.all([outcome(signUp(body(e), "http://localhost:3400")), outcome(signUp(body(e), "http://localhost:3400"))]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const lost = (a.ok ? b : a) as { ok: false; e: Error & { status?: number; code?: string } };
    expect(lost.e.message).toBe("An account with that email already exists");
    expect(lost.e.status).toBe(400);
    expect(await db.user.count({ where: { email: e } })).toBe(1);
  });

  it("Google's step in two tabs: one account, both signed into it", async () => {
    const e = email("grace");
    const [t1, t2] = [await startGoogleSignup(e), await startGoogleSignup(e)];
    const step = { role: "tester", devices: ["Windows PC"], languages: ["English"], name: "Ana Silva", acceptTerms: true, over18: true };
    const [a, b] = await Promise.all([outcome(finishGoogleSignup(t1, step)), outcome(finishGoogleSignup(t2, step))]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.v.user.id).toBe(b.v.user.id);
    expect(await db.user.count({ where: { email: e } })).toBe(1);
  });

  it("an email sign-up made during Google's step (never confirmed) is cleared before Google's step signs into it, as Google's sign-in does", async () => {
    const e = email("ghij");
    const token = await startGoogleSignup(e);
    await signUp(body(e), "http://localhost:3400");
    const before = await db.user.findUniqueOrThrow({ where: { email: e } });
    expect(before.passwordHash).not.toBe("");
    expect(before.emailVerifiedAt).toBeNull();
    const r = await finishGoogleSignup(token, { role: "tester", devices: ["Windows PC"], languages: ["English"], name: "Ana Silva", acceptTerms: true, over18: true });
    const after = await db.user.findUniqueOrThrow({ where: { email: e } });
    expect(r.user.id).toBe(before.id);
    expect(after.passwordHash).toBe("");
    expect(after.emailVerifiedAt).not.toBeNull();
    expect(await db.session.count({ where: { userId: before.id } })).toBe(1); // only Google's new session
  });
});

describe("(Nov 3, races) 6: the developer's Stop wins over the tester's Add", () => {
  it("Add's refusal names its press, like Send's", async () => {
    const path = (id: string) => `/api/sessions/${id}/written-add`;
    expect(pressLabelOf(path("x"), { text: "a" })).toBe("Add");
    expect(pressLabelOf("/api/sessions/x/recording-send", { add: true })).toBe("Add");
    expect(pressLabelOf("/api/sessions/x/recording-send", {})).toBe("Send");
    let refused = 0;
    for (const lag of [0, 3, 8]) {
      const s = await setup();
      const j = await joined(s.testId);
      await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
      await settle();
      const dev = await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } });
      const tester = await db.user.findUniqueOrThrow({ where: { id: j.tester.user.id } });
      const body = { text: "One more thing", seenAt: seen(), confirmed: true };
      const [, add] = await Promise.all([
        stopTest(dev, s.testId, { reason: "We have what we need.", seenAt: seen(), confirmed: true }),
        outcome(sleep(lag).then(() => addWritten(tester, j.sessionId, body))),
      ]);
      // Stop won: the refusal under the Add box (and the kept line) names the press.
      const msg = add.ok ? null : add.e.message;
      if (!msg) continue;
      refused++;
      expect(keptRefusalLine(pressLabelOf(path(j.sessionId), body), msg)).toMatch(/^Your Add didn't go through: Nora Lane stopped the test on /);
    }
    // After the Stop, Add always loses the same way.
    const s = await setup();
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    await stopTest(await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } }), s.testId, { reason: "We have what we need.", seenAt: seen(), confirmed: true });
    const late = await outcome(addWritten(await db.user.findUniqueOrThrow({ where: { id: j.tester.user.id } }), j.sessionId, { text: "x", seenAt: seen(), confirmed: true }));
    expect(late.ok).toBe(false);
    if (!late.ok) expect(keptRefusalLine(pressLabelOf(path(j.sessionId), {}), late.e.message)).toMatch(/^Your Add didn't go through: Nora Lane stopped the test on /);
    void refused;
  });
});

describe("(Nov 3, races) 7: a suspended tester's Dismiss all and Add", () => {
  it("Dismiss all is named as Dismiss all (no one test); Dismiss and Add name their own press", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    await db.user.update({ where: { id: j.tester.user.id }, data: { testerSuspendedAt: new Date() } });
    const all = await sact(j.sessionId, "dismiss-removed", j.tester.cookie, { all: true });
    expect([all.status, all.body.error.failed]).toEqual([403, "Your Dismiss all didn't go through"]);
    const one = await sact(j.sessionId, "dismiss-removed", j.tester.cookie, {});
    expect(one.body.error.failed).toBe("Your Dismiss on Harbor Run didn't go through");
    const add = await sact(j.sessionId, "written-add", j.tester.cookie, { text: "x" });
    expect(add.body.error.failed).toBe("Your Add on Harbor Run didn't go through");
    expect(pressLabelOf(`/api/sessions/${j.sessionId}/dismiss-removed`, { all: true })).toBe("Dismiss all");
    expect(pressLabelOf(`/api/sessions/${j.sessionId}/dismiss-removed`, {})).toBe("Dismiss");
  });
});
