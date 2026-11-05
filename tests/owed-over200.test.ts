import React from "react";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { startHold } from "@/lib/server/holds";
import { setStripeForTests } from "@/lib/server/stripe";
import { OwedBox } from "@/components/OwedBox";
import { OVER_PAY_TICK_LINE, OWED_OVER_TICK, PAY_TICK_CENTS, pressAgainLine } from "@/lib/rules";
import { json, req } from "./helpers";
import { joined, setup } from "./fixtures";

// (Owner, Nov 3, batch 35 §150) "Tick for when Pay what you owe is over $200 (and stop for when it does, with the tick appearing)."

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  setStripeForTests(null);
  vi.unstubAllGlobals();
});

const TICK = `Tick “${OVER_PAY_TICK_LINE}”`;

/** Every charge's amount and whether it was a reservation (manual capture). */
function fakeStripe() {
  const made: { amount: number; manual: boolean }[] = [];
  setStripeForTests({
    paymentIntents: {
      create: async (x: { amount: number; capture_method?: string }) => {
        made.push({ amount: x.amount, manual: x.capture_method === "manual" });
        return { id: "pi_" + randomUUID(), status: x.capture_method === "manual" ? "requires_capture" : "succeeded" };
      },
      capture: async (id: string) => ({ id, status: "succeeded" }),
      cancel: async (id: string) => ({ id, status: "canceled" }),
    },
  } as unknown as Stripe);
  return made;
}

/** A developer on a hold owing one failed payment of `cents` (a chargeback hold: card verified). */
async function held(cents: number, reason: "unpaid" | "chargeback" = "unpaid") {
  const { dev, testId } = await setup();
  const { tester, sessionId } = await joined(testId);
  await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
  const row = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: cents, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
  await startHold(dev.user.id, reason);
  if (reason === "chargeback") await db.user.update({ where: { id: dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
  const press = (body: Record<string, unknown>) => owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body })).then(json);
  /** A tester's Charge during the hold: "owed" (added to what's owed) or "deferred" (came in after the page drew: waits for the lift). */
  const charge = (amountCents: number, status: "owed" | "deferred") => db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents, feeCents: 0, testerCents: 0, status } });
  return { dev, row, press, charge };
}

describe("§150 Pay what you owe over $200 needs the tick", () => {
  it("$200.00 or less needs no tick", async () => {
    const made = fakeStripe();
    const w = await held(PAY_TICK_CENTS);
    const r = await w.press({ seenTotalCents: PAY_TICK_CENTS, seenIds: [w.row.id] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ paid: 1, lifted: true });
    expect(made).toEqual([{ amount: 20_000, manual: false }]);
  });

  it("over $200: refused without the tick (nothing charged), paid with it", async () => {
    const made = fakeStripe();
    const w = await held(23_000);
    const r = await w.press({ seenTotalCents: 23_000, seenIds: [w.row.id] });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "stop_once", message: OWED_OVER_TICK, totalCents: 23_000, ids: [w.row.id] });
    expect(OWED_OVER_TICK).toBe("Tick “I confirm this payment is over $200.” to pay.");
    expect(r.body.error.changes.map((c: { text: string }) => c.text)).toEqual([`${TICK} and press again to pay $230.00.`]);
    // over200 must be exactly true
    expect((await w.press({ seenTotalCents: 23_000, seenIds: [w.row.id], over200: "yes" })).body.error.code).toBe("stop_once");
    expect(made).toEqual([]);
    const ok = await w.press({ seenTotalCents: 23_000, seenIds: [w.row.id], confirmed: true, over200: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ paid: 1, lifted: true });
    expect(made).toEqual([{ amount: 23_000, manual: false }]);
  });

  it("the total crossed $200 since the page drew: stops once naming the tick; the second press needs it and pays the new total", async () => {
    const made = fakeStripe();
    const w = await held(15_000);
    await w.charge(8_000, "owed");
    const stop = await w.press({ seenTotalCents: 15_000, seenIds: [w.row.id] });
    expect([stop.status, stop.body.error.code, stop.body.error.totalCents]).toEqual([409, "stop_once", 23_000]);
    // (Owner, Nov 5, §206) One bullet per change, then the new total with the tick's press-again line as the last bullet.
    const texts: string[] = stop.body.error.changes.map((c: { text: string }) => c.text);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toMatch(/^Added to what you owe meanwhile: .*\$80\.00/);
    expect(texts[1]).toBe("New total $230.00. Tick “I confirm this payment is over $200.” and press again to pay $230.00.");
    // The second press without the tick (the box redrew with it showing, unticked): refused again, nothing charged.
    const again = await w.press({ seenTotalCents: 23_000, seenIds: stop.body.error.ids, confirmed: true });
    expect(again.body.error).toMatchObject({ code: "stop_once", message: OWED_OVER_TICK });
    expect(made).toEqual([]);
    const paid = await w.press({ seenTotalCents: 23_000, seenIds: stop.body.error.ids, confirmed: true, over200: true });
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ paid: 2, lifted: true });
    expect(made).toEqual([{ amount: 23_000, manual: false }]);
  });

  it("a page that ticked already (it showed over $200) gets the plain stop-once line when the total changed", async () => {
    fakeStripe();
    const w = await held(21_000);
    await w.charge(2_000, "owed");
    const stop = await w.press({ seenTotalCents: 21_000, seenIds: [w.row.id], over200: true });
    expect(stop.body.error.changes.map((c: { text: string }) => c.text)).toEqual([expect.stringMatching(/^Added to what you owe meanwhile: .*\$20\.00/), "New total $230.00. Press again to pay $230.00."]);
  });

  it("a tester's Charge that came in after the page drew is left out: it never makes the press need the tick", async () => {
    const made = fakeStripe();
    const w = await held(15_000);
    const late = await w.charge(10_000, "deferred");
    const r = await w.press({ seenTotalCents: 15_000, seenIds: [w.row.id] });
    expect(r.status).toBe(200);
    // The press paid what the page showed ($150, no tick); the late $100 was its own payment right after the lift (§125), never part of the press.
    expect(made).toEqual([{ amount: 15_000, manual: false }, { amount: 10_000, manual: false }]);
    expect((await db.payment.findUniqueOrThrow({ where: { id: late.id } })).status).not.toBe("owed");
  });

  it("a chargeback hold's reservation: the same tick (stop naming it, then reserve with it), also when the total crossed $200", async () => {
    const made = fakeStripe();
    const w = await held(23_000, "chargeback");
    const r = await w.press({ seenTotalCents: 23_000, seenIds: [w.row.id] });
    expect(r.body.error).toMatchObject({ code: "stop_once", message: OWED_OVER_TICK });
    expect(r.body.error.changes[0].text).toBe(`${TICK} and press again to reserve $230.00 on your card: it's taken when the team approves lifting your hold.`);
    expect(made).toEqual([]);
    const ok = await w.press({ seenTotalCents: 23_000, seenIds: [w.row.id], confirmed: true, over200: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ reservedCents: 23_000 });
    expect(made).toEqual([{ amount: 23_000, manual: true }]);

    const x = await held(15_000, "chargeback");
    const made2 = fakeStripe();
    await x.charge(8_000, "owed");
    const stop = await x.press({ seenTotalCents: 15_000, seenIds: [x.row.id] });
    expect(stop.body.error.changes.map((c: { text: string }) => c.text)).toEqual([expect.stringMatching(/^Added to what you owe meanwhile: .*\$80\.00/), "New total $230.00. Tick “I confirm this payment is over $200.” and press again to reserve $230.00 on your card: it's taken when the team approves lifting your hold."]);
    expect(made2).toEqual([]);
    const reserved = await x.press({ seenTotalCents: 23_000, seenIds: stop.body.error.ids, confirmed: true, over200: true });
    expect(reserved.body).toMatchObject({ reservedCents: 23_000 });
    expect(made2).toEqual([{ amount: 23_000, manual: true }]);
  });

  it("the stop-once line's end with the tick, in every wording", () => {
    expect(pressAgainLine(23_000)).toBe("Press again to pay $230.00.");
    expect(pressAgainLine(23_000, null, true)).toBe(`${TICK} and press again to pay $230.00.`);
    expect(pressAgainLine(23_000, { cardVerified: false }, true)).toBe(`${TICK} and press again to verify your card, then reserve $230.00 on it: it's taken when the team approves lifting your hold.`);
  });
});

describe("§150 the owed box shows the tick over $200, and the button waits for it", () => {
  const line = (amountCents: number) => ({ id: "owed", retry: true, amountCents, until: null, text: "Written answers" });
  const render = (cents: number, extra: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(OwedBox, { onHold: true, owed: [line(cents)], ...extra }));
  const button = (html: string) => html.match(/<button\b[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";

  it("over $200: the tick next to the button, unticked; the button disabled until it's ticked", () => {
    const html = render(23_000);
    expect(html).toContain("data-over-tick");
    expect(html).toContain(OVER_PAY_TICK_LINE);
    expect(html).not.toMatch(/<input[^>]*checked/);
    expect(button(html)).toContain("Pay what you owe ($230.00)");
    expect(button(html)).toContain('disabled=""');
  });

  it("$200.00 or less: no tick, the button ready", () => {
    const html = render(20_000);
    expect(html).not.toContain("data-over-tick");
    expect(button(html)).not.toContain('disabled=""');
  });

  it("a chargeback hold's reservation over $200 asks for it too; once reserved (the button disabled anyway) it doesn't", () => {
    expect(render(23_000, { chargeback: true })).toContain("data-over-tick");
    expect(render(23_000, { chargeback: true, reservedCents: 23_000 })).not.toContain("data-over-tick");
  });
});
