import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { DECIDE_LOCKED, decideDispute } from "@/lib/server/payments";
import { setStripeForTests } from "@/lib/server/stripe";
import { decidePayChangedLine } from "@/lib/rules";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 3, batch 35 §149) The admin's Decide sets the piece's TOTAL pay and charges only the difference from what is paid now. A Pay more since the admin's page
// loaded: paid < decided -> the difference is charged; paid == decided -> it goes through, nothing charged; paid > decided -> Decide stops once naming it (nothing
// charged, the dispute stays open, the range moves up to what's paid). A Pay more still at the bank: §70's refusal, unchanged.

afterEach(() => setStripeForTests(null));

/** Every charge's amount; `ask`: the next charges want the bank's check (a press's 15-minute one). */
function stripe() {
  const made: number[] = [];
  const st = { made, ask: false };
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number }) => {
        made.push(p.amount);
        const id = "pi_" + randomUUID();
        return st.ask ? { id, status: "requires_action", client_secret: `${id}_secret` } : { id, status: "succeeded" };
      },
      retrieve: async (id: string) => ({ id, status: "requires_action" }),
      cancel: async (id: string) => ({ id, status: "canceled" }),
    },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
  } as unknown as Stripe);
  return st;
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

async function paidOnPiece(submissionId: string) {
  const r = await db.review.findFirstOrThrow({ where: { submissionId } });
  const more = await db.payment.aggregate({ where: { submissionId, kind: { in: ["extra", "dispute"] }, status: { in: ["charged", "not_set_up"] } }, _sum: { amountCents: true } });
  return r.amountCents + (more._sum.amountCents ?? 0);
}
const decidedLine = async (testId: string) => (await db.testEvent.findFirst({ where: { testId, kind: "admin" } }))?.text ?? null;

/** The admin's page loads ($4.00 paid: "$10.00" is a $6.00 raise, ticked), then the developer's Pay more of `moreCents` goes through. */
async function payMoreAfterLoad(moreCents: number) {
  const w = await disputed();
  const st = stripe();
  const loaded = seen();
  await settle();
  const m = await act(w.testId, "pay-extra", w.dev.cookie, { seenAt: seen(), contractId: w.sessionId, submissionId: w.sub.id, amount: (moreCents / 100).toFixed(2), tickedCents: moreCents, payKey: randomUUID() });
  expect(m.status).toBe(200);
  expect(await paidOnPiece(w.sub.id)).toBe(400 + moreCents);
  st.made.length = 0;
  return { ...w, st, loaded };
}

describe("§149: Decide after a Pay more since the admin's page loaded", () => {
  it("paid now ($7.00) is less than the decided $10.00: only the difference ($3.00) is charged and the dispute is decided", async () => {
    const w = await payMoreAfterLoad(300);
    const r = await decideDispute(w.admin, w.row.id, { total: "10.00", tickCents: 600, seenAt: w.loaded });
    expect(r).toEqual({ extraCents: 300 });
    expect(w.st.made).toEqual([300]);
    expect(await paidOnPiece(w.sub.id)).toBe(1000);
    expect(await db.dispute.findUniqueOrThrow({ where: { id: w.row.id } })).toMatchObject({ status: "decided", decidedCents: 1000 });
    expect(await decidedLine(w.testId)).toBe("The team decided Ana Silva's dispute: raised the pay to $10.00 ($3.00 more)");
  });

  it("paid now equals the decided $10.00: it goes through, nothing is charged", async () => {
    const w = await payMoreAfterLoad(600);
    const r = await decideDispute(w.admin, w.row.id, { total: "10.00", tickCents: 600, seenAt: w.loaded });
    expect(r).toEqual({ extraCents: 0 });
    expect(w.st.made).toEqual([]);
    expect(await paidOnPiece(w.sub.id)).toBe(1000);
    expect(await db.dispute.findUniqueOrThrow({ where: { id: w.row.id } })).toMatchObject({ status: "decided", decidedCents: 1000 });
    expect(await decidedLine(w.testId)).toBe("The team decided Ana Silva's dispute: raised the pay to $10.00, which was already paid: nothing more was charged");
  });

  it("paid now ($12.00) is MORE than the decided $10.00: Decide stops once naming it, nothing charged, the dispute stays open, the range moves up; then $10.00 is refused and $12.00 goes through", async () => {
    const w = await payMoreAfterLoad(800);
    const e = await decideDispute(w.admin, w.row.id, { total: "10.00", tickCents: 600, seenAt: w.loaded }).then(() => null, (x: Error & { code?: string; data?: Record<string, unknown> }) => x);
    expect(e?.code).toBe("stop_once");
    const text = "Ana Silva's pay changed since you opened this: the developer paid $8.00 more, now $12.00 paid, more than your $10.00 decision. A decision can only raise the pay: decide $12.00 or more.";
    expect(decidePayChangedLine("Ana Silva", 800, 1200, 1000)).toBe(text);
    expect((e!.data!.changes as { text: string }[]).map((c) => c.text)).toEqual([text]);
    expect(e!.data).toMatchObject({ press: "Decide", minCents: 1200, range: expect.stringMatching(/^\$12\.00 paid · can raise up to /) });
    expect(w.st.made).toEqual([]);
    expect(await db.dispute.findUniqueOrThrow({ where: { id: w.row.id } })).toMatchObject({ status: "open", decidedCents: null, decidedById: null });
    expect(await decidedLine(w.testId)).toBeNull();
    expect(await paidOnPiece(w.sub.id)).toBe(1200);
    // Once: the box's page time moves on with the stop, so the same $10.00 again is the plain refusal (never charged, never a second stop).
    const again = await decideDispute(w.admin, w.row.id, { total: "10.00", tickCents: 600, seenAt: e!.data!.seenAt }).then(() => null, (x: Error & { code?: string }) => x);
    expect([again?.code, again?.message]).toEqual(["bad_amount", "A decision can only raise pay: at least the $12.00 paid for this piece."]);
    // $12.00 (what's paid now): goes through, nothing charged.
    expect(await decideDispute(w.admin, w.row.id, { total: "12.00", seenAt: e!.data!.seenAt })).toEqual({ extraCents: 0 });
    expect(w.st.made).toEqual([]);
    expect(await db.dispute.findUniqueOrThrow({ where: { id: w.row.id } })).toMatchObject({ status: "decided", decidedCents: 1200 });
  });

  it("the same stop through the admin route: 409 stop_once with the line and the new range", async () => {
    const w = await payMoreAfterLoad(800);
    const { POST } = await import("@/app/api/admin/[action]/route");
    const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    const r = await POST(req("/api/admin/decide", { cookie: a.cookie, body: { id: w.row.id, total: "10.00", tickCents: 600, seenAt: w.loaded, note: "" } }), { params: Promise.resolve({ action: "decide" }) }).then(json);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "stop_once", minCents: 1200 });
    expect(r.body.error.changes[0].text).toMatch(/^Ana Silva's pay changed since you opened this: the developer paid \$8\.00 more, now \$12\.00 paid/);
    expect(w.st.made).toEqual([]);
  });

  it("a Pay more still at the developer's bank: Decide is refused (§70, unchanged), nothing charged, the dispute stays open", async () => {
    const w = await disputed();
    const st = stripe();
    const loaded = seen();
    await settle();
    st.ask = true;
    const m = await act(w.testId, "pay-extra", w.dev.cookie, { seenAt: seen(), contractId: w.sessionId, submissionId: w.sub.id, amount: "8.00", tickedCents: 800, payKey: randomUUID() });
    expect(m.status).toBe(200);
    expect(await db.payment.count({ where: { submissionId: w.sub.id, kind: "extra", status: "needs_action" } })).toBe(1);
    st.made.length = 0;
    st.ask = false;
    await expect(decideDispute(w.admin, w.row.id, { total: "10.00", tickCents: 600, seenAt: loaded })).rejects.toThrow(DECIDE_LOCKED);
    expect(st.made).toEqual([]);
    expect((await db.dispute.findUniqueOrThrow({ where: { id: w.row.id } })).status).toBe("open");
  });
});
