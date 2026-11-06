import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { setStripeForTests } from "@/lib/server/stripe";
import { bankWaitsLine, bankWaitsOf } from "@/lib/server/payments";
import { checkPiOf, watchBank, type PeekResult } from "@/lib/bankConfirm";
import { payMoreWaits } from "@/lib/bankNotice";
import { NO_NOTICE, addNews } from "@/components/BankCheck";
import { fmtDateTimeIn } from "@/lib/format";
import { json, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner bug, Nov 4, batch 35 §174) A Pay more on a live CALL whose card asks the bank every time: the tester disputed that call while the bank box was open, and
// the Pay more box above the developer's own open bank box turned grey with "Your $2.00 payment for this part is waiting for your bank: finish or cancel it first."

const CHECK_URL = "https://hooks.stripe.com/3d_secure_2/hosted?fake=1";
const RETURN_URL = "http://localhost:3400/api/payments/bank-return";
const TAB = "tab-bank-call";
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const devs: string[] = [];
afterAll(async () => {
  await db.payment.updateMany({ where: { developerId: { in: devs }, status: { notIn: ["charged", "bundled", "not_set_up"] } }, data: { status: "cancelled", actionPi: null, actionBy: null } });
});
afterEach(() => setStripeForTests(null));

/** A Stripe stand-in whose presses wait for the bank's page (the card that asks the bank every time). */
function fakeStripe() {
  const status = new Map<string, { status: string }>();
  const changed: string[] = [];
  setStripeForTests({
    paymentIntents: {
      create: async () => {
        const id = "pi_" + randomUUID();
        status.set(id, { status: "requires_action" });
        return { id, status: "requires_action", client_secret: `${id}_secret_x`, next_action: { type: "redirect_to_url", redirect_to_url: { url: CHECK_URL, return_url: RETURN_URL } } };
      },
      retrieve: async (id: string) => ({ id, client_secret: `${id}_secret_x`, ...(status.get(id) ?? { status: "succeeded" }) }),
      cancel: async (id: string) => { changed.push(`cancel ${id}`); status.set(id, { status: "canceled" }); return { id, status: "canceled" }; },
    },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
  } as unknown as Stripe);
  return { status, changed };
}

const peek = (cookie: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, headers: { "x-tab": TAB }, body: { ...body, peek: true } })).then(json);
const finish = (cookie: string, body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie, headers: { "x-tab": TAB }, body })).then(json);

/** A live call with Ana that took place and was paid $15.00, then the developer's Pay more $2.00 on it open at the bank (the owner's Nov 4 case). */
async function payMoreOpen() {
  const s = await setup();
  devs.push(s.dev.user.id);
  const j = await joined(s.testId);
  const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
  const start = new Date(Date.now() - 3 * 3_600_000);
  await db.call.update({ where: { id: call.id }, data: { startsAt: start, measuredMinutes: 30, measuredAt: new Date(Date.now() - 2 * 3_600_000) } });
  await db.review.create({ data: { contractId: j.sessionId, callId: call.id, amountCents: 1500, agreedCents: 1500, payKey: randomUUID() } });
  await db.payment.create({ data: { kind: "call", contractId: j.sessionId, callId: call.id, developerId: s.dev.user.id, testerId: j.tester.user.id, amountCents: 1500, feeCents: 300, testerCents: 1200, status: "charged", settledAt: new Date() } });
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID() } });
  await settle();
  const st = fakeStripe();
  const r = await act(s.testId, "pay-extra", s.dev.cookie, { seenAt: seen(), confirmed: true, contractId: j.sessionId, callId: call.id, amount: "2.00", tickedCents: 200, payKey: randomUUID(), tab: TAB });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(r.body).toMatchObject({ requiresAction: true, checkUrl: CHECK_URL });
  await settle();
  const since = new Date().toISOString(); // the moment the bank box opened
  await settle();
  return { ...s, ...j, call, st, paymentId: r.body.paymentId as string, pi: checkPiOf(r.body.clientSecret as string), since, when: fmtDateTimeIn(start, "UTC") };
}

describe("§174 a Pay more on a CALL open at the bank", () => {
  it("the tester's dispute of that very call is a line in the open box's notice (the peek, with the window's own PaymentIntent)", async () => {
    const o = await payMoreOpen();
    expect((await peek(o.dev.cookie, { paymentId: o.paymentId, pi: o.pi, since: o.since })).body).toEqual({ status: "waiting" });
    const d = await sact(o.sessionId, "dispute", o.tester.cookie, { kind: "call", id: o.call.id, reason: "I think this deserves more pay.", seenAt: seen(), confirmed: true });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    const r = await peek(o.dev.cookie, { paymentId: o.paymentId, pi: o.pi, since: o.since });
    expect(r.status).toBe(200);
    // (Owner, Nov 4, §177) The line names WHICH call (its date and time; UTC in tests). The peek sends no page: the test's own page, so no "On “…”:" prefix.
    expect(r.body).toEqual({ status: "waiting", changes: [`Ana Silva disputed the pay for her live call on ${o.when}`], still: "Complete still pays $2.00 as pressed; or press Cancel.", links: [expect.objectContaining({ text: "Ana Silva", kind: "person" })] }); // (§270) the line's green links
    // The page's watch hands it to the notice as it arrives.
    let notice = NO_NOTICE;
    await new Promise<void>((done) => {
      const stop = watchBank(async () => r.body as PeekResult, () => undefined, 1, (a) => { notice = addNews(notice, a); stop(); done(); });
    });
    expect(notice.lines).toEqual([`Ana Silva disputed the pay for her live call on ${o.when}.`]);
  });

  it("Cancel under the frame answers at once (a refusal the box shows, so it closes): cancelled at Stripe, nothing charged", async () => {
    const o = await payMoreOpen();
    const r = await finish(o.dev.cookie, { paymentId: o.paymentId });
    expect(r.status).toBe(402);
    expect(r.body.error.code).toBe("not_confirmed");
    expect((await db.payment.findUniqueOrThrow({ where: { id: o.paymentId } })).status).toBe("cancelled");
    expect(o.st.changed).toEqual([`cancel ${o.pi}`]);
  });

  it("the waiting line names its payment: the box's own open check is that payment, another charge on the part is not", async () => {
    const o = await payMoreOpen();
    const w = await bankWaitsOf(db, { callId: o.call.id }, "Ana Silva");
    expect(w).toEqual({ id: o.paymentId, kind: "own", cents: 200, line: "Your $2.00 payment for this part is waiting for your bank: finish or cancel it first." });
    expect(await bankWaitsLine(db, { callId: o.call.id }, "Ana Silva")).toBe(w!.line);
    // Its Cancel: nothing waits any more.
    await finish(o.dev.cookie, { paymentId: o.paymentId });
    expect(await bankWaitsOf(db, { callId: o.call.id }, "Ana Silva")).toBeNull();
  });
});

describe("§174 the Pay more box never greys itself for its own bank check", () => {
  const LINE = "Your $2.00 payment for this part is waiting for your bank: finish or cancel it first.";
  it("not while its bank box is open, nor for the check it just ended; another payment's wait still greys it", () => {
    // A redraw drawn while the box's own check is open (the owner's case).
    expect(payMoreWaits(LINE, "pay_own", { open: true, checkId: "pay_own" })).toBeUndefined();
    // Any line while the box's own check is open: its button is already disabled and its bank box is under it.
    expect(payMoreWaits("Confirm Ana Silva's $10.00 charge with your bank first.", "pay_other", { open: true, checkId: "pay_own" })).toBeUndefined();
    // A redraw drawn before the check ended, landing after Cancel closed it.
    expect(payMoreWaits(LINE, "pay_own", { open: false, checkId: "pay_own" })).toBeUndefined();
    // Another payment on the part (a charge made while away, another tab's Pay more): greyed with its line, as §159 says.
    expect(payMoreWaits("Confirm Ana Silva's $10.00 charge with your bank first.", "pay_other", { open: false, checkId: "pay_own" })).toBe("Confirm Ana Silva's $10.00 charge with your bank first.");
    expect(payMoreWaits(LINE, "pay_x", { open: false, checkId: "" })).toBe(LINE);
    expect(payMoreWaits(undefined, undefined, { open: false, checkId: "" })).toBeUndefined();
  });

  it("the box reads the line through it (greying, the line, the disabled button), notes its own check before opening it, and the page passes the id to every Pay more", () => {
    const box = src("app/app/tests/[id]/PayBox.tsx");
    // (Owner, Nov 4, §188 B) Through payMoreWaits, with the check this box cancelled itself (un-greyed at once).
    expect(box).toContain("const bankWaits = payMoreWaits(p.bankWaits, p.bankWaitsId, { open: bank.open, checkId: ownCheck, cancelled: cancelled?.id });");
    expect(box).toMatch(/setOwnCheck\(r\.paymentId\);\s+try \{ res = await bank\.check/);
    // Greyed except the waiting row, which holds Cancel this check (own press) or Confirm with your bank (a charge made while away).
    expect(box).toContain('data-pay-greyed={bankWaits ? "" : undefined}');
    expect(src("app/globals.css")).toContain("[data-pay-greyed] > :not([data-pay-more-waits]) { opacity: 0.6; }");
    expect(box).toContain('data-pay-more-waits="" data-waits-kind={waitKind ?? ""}>');
    expect(box).toContain("!!bankWaits ||");
    expect(box).not.toMatch(/p\.bankWaits \?|p\.bankWaits &&|!!p\.bankWaits/);
    const page = src("app/app/tests/[id]/page.tsx");
    const boxes = page.match(/<PayBox more=[^\n]*/g) ?? [];
    expect(boxes.length).toBe(3);
    for (const b of boxes) expect(b).toMatch(/bankWaits=\{waitsOf\(([^)]+)\)\} bankWaitsId=\{waitsIdOf\(\1\)\} bankWaitsKind=\{waitsKindOf\(\1\)\}/);
  });
});
