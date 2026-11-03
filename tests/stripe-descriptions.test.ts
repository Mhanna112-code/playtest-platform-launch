import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as R from "@/lib/rules";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { chargeDeferred, chargebackOpened, payOwed, startHold } from "@/lib/server/holds";
import { DESCRIPTION_MAX, listWithin, paidRows, stripeDescription, type PayingRow } from "@/lib/server/paymentRows";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, req } from "./helpers";
import { pay, payMore } from "./b15";
import { bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 3) Every PaymentIntent's description reads as the payment's line in Payments' "What you've paid" with the names in full (no 10-character cut), after
// "Playtest: ". One shared builder (paymentRows.stripeDescription, built on the page's own devLine) so the two can't drift; at most 1,000 characters.

const DAY = 86_400_000;
afterEach(() => setStripeForTests(null));

/** A Stripe stand-in that records every PaymentIntent made (with its description). */
function bank() {
  const made: { id: string; amount: number; description?: string; capture_method?: string }[] = [];
  const pis = new Map<string, string>();
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; description?: string; capture_method?: string }) => {
        const id = "pi_" + randomUUID();
        made.push({ id, ...p });
        pis.set(id, p.capture_method === "manual" ? "requires_capture" : "succeeded");
        return { id, status: pis.get(id) };
      },
      retrieve: async (id: string) => ({ id, status: pis.get(id) ?? "succeeded", latest_charge: id.replace(/^pi_/, "ch_") }),
      cancel: async (id: string) => ({ id, status: "canceled" }),
      capture: async (id: string) => ({ id, status: "succeeded" }),
    },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
    customers: { update: async () => ({}) },
  } as unknown as Stripe);
  return made;
}

const LONG = "chargechargecharge";
/** A developer (card saved) whose tester Marc Hanna sent written answers on “chargechargecharge” (names longer than the page's 10-character cut). */
async function world(names = ["Marc Hanna"]) {
  const s = await setup({ title: LONG, productName: LONG });
  await db.user.update({ where: { id: s.dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID() } });
  const t = [];
  for (const name of names) {
    const j = await joined(s.testId, name);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
    t.push({ ...j, sub: await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } }) });
  }
  await settle();
  return { ...s, t };
}
type W = Awaited<ReturnType<typeof world>>;
const row = (w: W, i: number, data: Partial<PayingRow> & { kind: string; amountCents: number; status?: string; chargebackAt?: Date }) =>
  db.payment.create({ data: { contractId: w.t[i].sessionId, submissionId: w.t[i].sub.id, developerId: w.dev.user.id, testerId: w.t[i].tester.user.id, feeCents: 0, testerCents: 0, status: "charged", ...data } as never });
/** The row's line on the developer's Payments page, names in full, with its "how" after a comma: what its description must read (after "Playtest: "). */
async function pageLine(p: Awaited<ReturnType<typeof row>>) {
  const r = (await paidRows([p], "developer")).get(p.id)!;
  return `${r.full}${r.how ? `, ${r.how}` : ""}`;
}

describe("the description reads as the What you've paid line, names in full", () => {
  it("a Pay, a Pay more, a team decision, a tester's Charge, an automatic call charge, a repayment (whole and part)", async () => {
    const w = await world();
    const sub = w.t[0].sub;
    const piece = `Marc Hanna's written answers on “${LONG}”`;
    const cases: [Awaited<ReturnType<typeof row>>, string][] = [];
    cases.push([await row(w, 0, { kind: "review", amountCents: 1000 }), `Playtest: ${piece}`]);
    cases.push([await row(w, 0, { kind: "extra", amountCents: 3900 }), `Playtest: Pay more for ${piece}`]);
    cases.push([await row(w, 0, { kind: "dispute", amountCents: 500 }), `Playtest: The team's dispute decision on ${piece}`]);
    // A recording.
    const rec = await db.submission.create({ data: { contractId: w.t[0].sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
    cases.push([await row(w, 0, { kind: "review", amountCents: 1000, submissionId: rec.id }), `Playtest: Marc Hanna's recording on “${LONG}”`]);
    // Paid through Pay what you owe (a debt settled by the one payment).
    cases.push([await row(w, 0, { kind: "review", amountCents: 800, settledAt: new Date(), owedUntil: new Date() }), `Playtest: ${piece}, paid through Pay what you owe`]);
    // A repayment of a reversed Pay more, whole and part.
    const whole = await row(w, 0, { kind: "extra", amountCents: 3900, chargeback: "resolved", chargebackAt: new Date(), reversedCents: 3900 });
    cases.push([await row(w, 0, { kind: "chargeback", amountCents: 5400, repaysId: whole.id, submissionId: null }), `Playtest: Repaid the reversed $39.00 Pay more for ${piece} ($39.00 + $15.00 chargeback fee)`]);
    const part = await row(w, 0, { kind: "review", amountCents: 44467, chargeback: "resolved", chargebackAt: new Date(), reversedCents: 9600 });
    cases.push([await row(w, 0, { kind: "chargeback", amountCents: 11100, repaysId: part.id, submissionId: null }), `Playtest: Repaid $96 reversed from your $444.67 payment for ${piece} ($96 + $15 chargeback fee)`]);
    for (const [p, want] of cases) {
      expect(await stripeDescription({ payment: p })).toBe(want);
      expect(`Playtest: ${await pageLine(p)}`).toBe(want); // the same as the page's line (its hover: names in full)
    }
    // A tester's Charge: its review is made first, so the line says who charged it.
    await db.review.create({ data: { submissionId: sub.id, contractId: w.t[0].sessionId, amountCents: 1000, agreedCents: 1000, reason: R.CHARGED_BY_TESTER, payKey: "choice:" + sub.id } });
    const charged = await row(w, 0, { kind: "review", amountCents: 1000 });
    expect(await stripeDescription({ payment: charged })).toBe(`Playtest: ${piece}, charged by Marc Hanna after 7 days without a review`);
    expect(`Playtest: ${await pageLine(charged)}`).toBe(await stripeDescription({ payment: charged }));
  });

  it("a live call charged automatically, and a team decision on it", async () => {
    const w = await world();
    const call = await bookCall(w.testId, w.dev.cookie, w.t[0].sessionId, w.t[0].tester.cookie);
    await db.review.create({ data: { callId: call.id, contractId: w.t[0].sessionId, amountCents: 1500, agreedCents: 1500, reason: R.AUTO_CHARGED_CALL, payKey: "autocall:" + call.id, auto: true } });
    const auto = await row(w, 0, { kind: "call", amountCents: 1500, submissionId: null, callId: call.id });
    expect(await stripeDescription({ payment: auto })).toBe(`Playtest: Marc Hanna's live call on “${LONG}”, charged automatically after 7 days`);
    expect(`Playtest: ${await pageLine(auto)}`).toBe(await stripeDescription({ payment: auto }));
    const decided = await row(w, 0, { kind: "dispute", amountCents: 700, submissionId: null, callId: call.id });
    expect(await stripeDescription({ payment: decided })).toBe(`Playtest: The team's dispute decision on Marc Hanna's live call on “${LONG}”`);
  });

  it("Pay what you owe's one payment lists each item as on the page; charges made while away; a reservation; a reversed payment owed again", async () => {
    const w = await world(["Marc Hanna", "Alexandria Montgomery"]);
    const a = await row(w, 0, { kind: "review", amountCents: 800, status: "failed", owedUntil: new Date() });
    const b = await row(w, 1, { kind: "review", amountCents: 1250, status: "deferred" });
    const items = `Marc Hanna's written answers on “${LONG}” $8.00, Alexandria Montgomery's written answers on “${LONG}” $12.50`;
    expect(await stripeDescription({ owed: [a, b] })).toBe(`Playtest: What you owe (${items})`);
    expect(await stripeDescription({ owed: [a, b], charges: true })).toBe(`Playtest: Charges made while you were away (${items})`);
    expect(await stripeDescription({ reserve: [a, b] })).toBe(`Playtest: Reserved for the team's review: ${items}`);
    // A reversed payment owed again reads as its repayment will (what the bank reversed + the fee).
    const rev = await row(w, 0, { kind: "review", amountCents: 1000, chargeback: "open", chargebackAt: new Date(), reversedCents: 1000 });
    const revPart = await row(w, 1, { kind: "review", amountCents: 44467, chargeback: "open", chargebackAt: new Date(), reversedCents: 9600 });
    expect(await stripeDescription({ reserve: [rev, revPart] })).toBe(`Playtest: Reserved for the team's review: Repaid the reversed $10.00 payment for Marc Hanna's written answers on “${LONG}” ($10.00 + $15.00 chargeback fee) $25.00, Repaid $96 reversed from your $444.67 payment for Alexandria Montgomery's written answers on “${LONG}” ($96 + $15 chargeback fee) $111.00`);
  });

  it("a list longer than Stripe's 1,000 characters ends with “… and N more”", async () => {
    const items = Array.from({ length: 40 }, (_, i) => `Alexandria Montgomery's written answers on “The Very Long Harbor Run Test Number ${i + 1}” $12.50`);
    const s = listWithin("Playtest: What you owe (", items, ")");
    expect(s.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    const shown = s.slice("Playtest: What you owe (".length, -1).split(", ").filter((x) => !x.startsWith("…"));
    expect(s.endsWith(`, … and ${40 - shown.length} more)`)).toBe(true);
    expect(shown).toEqual(items.slice(0, shown.length));
    expect(listWithin("Playtest: What you owe (", items.slice(0, 2), ")")).toBe(`Playtest: What you owe (${items[0]}, ${items[1]})`);
    // Through the builder too.
    const w = await world();
    const rows = [];
    for (let i = 0; i < 60; i++) rows.push(await row(w, 0, { kind: "review", amountCents: 100 + i, status: "failed", owedUntil: new Date() }));
    const d = await stripeDescription({ owed: rows });
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(d).toMatch(/, … and \d+ more\)$/);
  });
});

describe("every charge sends it", () => {
  it("Pay, Pay more, a tester's Charge, Pay what you owe's one payment, the reservation, a repayment after the lift", async () => {
    const w = await world(["Marc Hanna", "Alexandria Montgomery"]);
    const made = bank();
    const piece = (i: number) => `${["Marc Hanna", "Alexandria Montgomery"][i]}'s written answers on “${LONG}”`;
    // Pay (the developer's press, through the route the page's Pay button posts to).
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.t[0].sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect(made.at(-1)!.description).toBe(`Playtest: ${piece(0)}`);
    const paid = await db.payment.findFirstOrThrow({ where: { submissionId: w.t[0].sub.id, kind: "review" } });
    expect(paid.stripeDescription).toBe(`Playtest: ${piece(0)}`);
    // Pay more on it.
    expect((await payMore(w.testId, w.dev.cookie, { contractId: w.t[0].sessionId, submissionId: w.t[0].sub.id, amount: "2.00", tickedCents: 200 })).status).toBe(200);
    expect(made.at(-1)!.description).toBe(`Playtest: Pay more for ${piece(0)}`);
    // The tester's Charge on the other piece.
    await db.submission.update({ where: { id: w.t[1].sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
    expect((await sact(w.t[1].sessionId, "choose", w.t[1].tester.cookie, { submissionId: w.t[1].sub.id, choice: "charge", tickedCents: 1000, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(made.at(-1)!.description).toBe(`Playtest: ${piece(1)}, charged by Alexandria Montgomery after 7 days without a review`);
    // Pay what you owe's one payment, during a hold.
    const d1 = await row(w, 0, { kind: "review", amountCents: 800, status: "failed", owedUntil: new Date() });
    await row(w, 1, { kind: "review", amountCents: 1250, status: "failed", owedUntil: new Date() });
    await startHold(w.dev.user.id, "unpaid");
    expect((await owedPOST(req("/api/payments/owed", { cookie: w.dev.cookie, body: {} })).then(json)).body).toMatchObject({ paid: 2, lifted: true });
    expect(made.at(-1)!.description).toBe(`Playtest: What you owe (${piece(0)} $8.00, ${piece(1)} $12.50)`);
    const one = await db.payment.findFirstOrThrow({ where: { developerId: w.dev.user.id, kind: "owed" } });
    expect(one.stripeDescription).toBe(made.at(-1)!.description);
    // A chargeback on it: the reservation lists the reversed payment as its repayment will read.
    await chargebackOpened(one.stripePaymentIntentId!, 1000);
    await db.user.update({ where: { id: w.dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
    expect(await payOwed(w.dev.user, {})).toMatchObject({ reservedCents: 2500 });
    expect(made.at(-1)).toMatchObject({ capture_method: "manual", description: "Playtest: Reserved for the team's review: Repaid $10 reversed from your $20.50 payment ($10 + $15 chargeback fee) $25.00" });
    void d1;
  });

  it("a repayment charged after the lift, and a retry with the same key sends the same description", async () => {
    const w = await world();
    const made = bank();
    const reversed = await row(w, 0, { kind: "extra", amountCents: 3900, chargeback: "resolved", chargebackAt: new Date(), reversedCents: 3900 });
    const repay = await row(w, 0, { kind: "chargeback", amountCents: 5400, status: "deferred", repaysId: reversed.id, submissionId: null });
    await chargeDeferred(w.dev.user.id);
    // (Owner, Nov 3) A repayment that waited for the lift goes into the ONE after-lift payment, listed by its own words.
    const one = await db.payment.findFirstOrThrow({ where: { developerId: w.dev.user.id, kind: "owed" } });
    const want = await stripeDescription({ owed: [await db.payment.findUniqueOrThrow({ where: { id: repay.id } })], charges: true });
    expect(want.startsWith("Playtest: Charges made while you were away (")).toBe(true);
    expect(want).toContain("Repaid the reversed $39.00 Pay more");
    expect(made.map((m) => m.description)).toEqual([want]);
    expect(one.stripeDescription).toBe(want);
    expect(await db.payment.findUniqueOrThrow({ where: { id: repay.id } })).toMatchObject({ status: "charged", coveredById: one.id, testerCents: 0 });
    // The tester renames meanwhile: a charge asked again with the same key keeps the description Stripe has.
    await db.user.update({ where: { id: w.t[0].tester.user.id }, data: { name: "Marcus Hanna-Smith" } });
    const again = await (await import("@/lib/server/paymentRows")).describedOnce(one.id, async () => "a new description");
    expect(again).toBe(want);
    expect(await stripeDescription({ payment: repay })).toContain("Marcus Hanna-Smith"); // a new charge would use the new name
  });

  it("every charge and reservation in the server code passes the shared description; only the subscription keeps its own", () => {
    const files = ["payments.ts", "holds.ts", "owedOnce.ts", "chargeback.ts", "subscription.ts"].map((f) => [f, fs.readFileSync(`src/lib/server/${f}`, "utf8")] as const);
    let calls = 0;
    for (const [f, src] of files) {
      const lines = src.split("\n");
      lines.forEach((l, i) => {
        if (!/(^|[^\w.])(charge|chargePlatform|authorize)\(/.test(l) || /function (charge|chargePlatform|authorize)\(/.test(l) || /^\s*(\/\/|\*)/.test(l)) return;
        calls++;
        const near = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
        if (f === "subscription.ts") expect(l).toContain("`Playtest subscription (${SUBSCRIPTION_PRICE})`");
        else expect(near, `${f}:${i + 1}`).toMatch(/stripeDescription\(|describedOnce\(/);
      });
      // No hand-written description left at a call site.
      if (f !== "subscription.ts") expect(src.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l) && /["`]Playtest: /.test(l) && /(charge|chargePlatform|authorize)\(/.test(l))).toEqual([]);
    }
    expect(calls).toBeGreaterThanOrEqual(10);
    expect(fs.readFileSync("src/lib/server/stripe.ts", "utf8")).not.toContain('description: "Playtest: what you owe, reserved until the team approves lifting your hold"');
  });
});
