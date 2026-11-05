import { randomUUID } from "node:crypto";
import React, { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { DevPaidList, TesterEarnedList } from "@/components/PaymentLists";
import { AdminPersonBoxes } from "@/app/admin/AdminBoxes";
import { developerPaid } from "@/lib/server/paymentLists";
import { paidOutTotal } from "@/lib/server/paymentRows";
import { withDateZone } from "@/lib/server/dateZone";
import { fmtDateTimeIn } from "@/lib/format";
import { CHARGED_BY_TESTER } from "@/lib/rules";
import { POST as testsPOST } from "@/app/api/tests/route";
import { json, makeUser, req } from "./helpers";
import { joined, listingBody, sact, settle, setup } from "./fixtures";

// (Owner, Nov 4, §191) "What you've paid": the items ONE charge paid together (Pay what you owe's one payment, Confirm all's) are one expandable group line (the
// charge's amount, date, Stripe link in the team's copy), each item inside named exactly (the tester, the part, a call by its date AND time, the test, what kind of
// payment; a repayment names the payment the bank reversed). Everything paid on its own keeps its line. The total is exactly paidOutTotal's, never counted twice.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, adminAway() {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/payments", useRouter: () => ({ refresh() {} }), useSearchParams: () => new URLSearchParams(), notFound() { throw new Error("notFound"); } }));
// Every line drawn (the long-list rule shows 8, then "Show N more": its own tests cover it).
vi.mock("@/components/LongList", async () => {
  const R = await import("react");
  return { LongList: ({ children, className }: { children: ReactNode; className?: string }) => R.createElement("ul", { className }, children) };
});
(globalThis as unknown as { React: typeof React }).React = React;

function find(node: ReactNode, is: (e: ReactElement<Record<string, unknown>>) => boolean): ReactElement | undefined {
  if (Array.isArray(node)) { for (const n of node) { const f = find(n, is); if (f) return f; } return; }
  if (!isValidElement(node)) return;
  const e = node as ReactElement<Record<string, unknown>>;
  return is(e) ? e : find(e.props.children as ReactNode, is);
}
const sectionOf = (html: string, side: "developer" | "tester") => html.match(new RegExp(`<section[^>]*data-paid-list="${side}"[\\s\\S]*?</section>`))?.[0] ?? "";
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/<[^>]+>/g, "");
/** One group's markup (its <li data-paid-group>). */
const groupOf = (html: string, id: string) => html.match(new RegExp(`<li[^>]*data-paid-group="${id}"[\\s\\S]*?</details></li>`))?.[0] ?? "";

async function ownList(u: User, side: "developer" | "tester") {
  auth.user = u;
  const { default: Payments } = await import("@/app/app/payments/page");
  const tree = await Payments({ searchParams: Promise.resolve({}) });
  const el = find(tree, (e) => e.type === (side === "developer" ? DevPaidList : TesterEarnedList));
  expect(el).toBeTruthy();
  return renderToStaticMarkup(el!);
}
async function adminView(userId: string) {
  const a = await makeUser({ dev: true, name: "Team Admin" });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true, timeZone: "America/New_York" } });
  const tree = await AdminPersonBoxes({ userId, adminId: a.user.id, developer: true, tester: true });
  const el = find(tree, (e) => "theirs" in e.props);
  const key = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  try { return renderToStaticMarkup(el!); } finally { process.env.STRIPE_SECRET_KEY = key; }
}
const asOwn = (html: string) => html.replace(/ · <a href="https:\/\/dashboard\.stripe\.com\/[^"]*" target="_blank" rel="noreferrer" data-stripe-link="">Stripe<\/a>/g, "").replace(/href="\/app\/find\//g, 'href="/app/tests/');

/**
 * A developer (Nora Lane, New York) who paid every way: a Pay, one confirmed with her bank, Pay what you owe (3 items: written answers, an automatic call charge, a
 * Pay more's chargeback repayment + fee), Confirm all (2 testers on 2 tests: a tester's Charge, the team's dispute decision), a chargeback won after it was repaid
 * (the repayment refunded inside its group), a Pay what you owe payment the bank reversed (its group marked; its repayment inside a later group), and repayments of
 * each kind of reversed payment (a tester's Charge, the team's decision, the automatic call charge, part of a Pay).
 */
async function world() {
  const s = await setup();
  const devId = s.dev.user.id;
  await db.user.update({ where: { id: devId }, data: { timeZone: "America/New_York" } });
  const r2 = await json(await testsPOST(req("/api/tests", { cookie: s.dev.cookie, body: listingBody({ productName: "Second Run", title: "Second Run" }) })));
  expect(r2.status).toBe(200);
  const test2 = r2.body.id as string;
  const people: { sessionId: string; testerId: string; subId: string }[] = [];
  for (const [testId, name, pronoun] of [[s.testId, "Ana Silva", "she"], [s.testId, "Ben Okafor", "he"], [s.testId, "Cid Moreau", "he"], [test2, "Dee Park", "she"]]) {
    const j = await joined(testId, name, pronoun);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["answer", "answer"] });
    people.push({ sessionId: j.sessionId, testerId: j.tester.user.id, subId: (await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } })).id });
  }
  await settle();
  const [ana, ben, cid, dee] = people;
  // Ben's live call on Tue, Oct 27, 3:25 PM (New York), charged automatically after 7 days; Cid's written answers charged by him.
  const slot = await db.callSlot.create({ data: { testId: s.testId, startsAt: new Date("2026-10-27T19:25:00Z"), minutes: 30, allowedTesterIds: [] } });
  const call = await db.call.create({ data: { slotId: slot.id, contractId: ben.sessionId, startsAt: slot.startsAt, minutes: 30 } });
  await db.review.create({ data: { callId: call.id, contractId: ben.sessionId, amountCents: 1000, auto: true, payKey: randomUUID() } });
  await db.review.create({ data: { submissionId: cid.subId, contractId: cid.sessionId, amountCents: 1200, reason: CHARGED_BY_TESTER, payKey: randomUUID() } });

  const pi = () => "pi_" + randomUUID().replace(/-/g, "").slice(0, 20);
  let at = Date.parse("2026-10-20T15:00:00Z");
  const next = () => new Date((at += 3_600_000));
  const part = (x: typeof ana, call?: string) => ({ contractId: x.sessionId, ...(call ? { callId: call } : { submissionId: x.subId }), developerId: devId, testerId: x.testerId });
  const pay = (x: typeof ana, cents: number, over: Record<string, unknown> = {}, callId?: string) =>
    db.payment.create({ data: { kind: callId ? "call" : "review", ...part(x, callId), amountCents: cents, feeCents: Math.round(cents / 10), testerCents: cents - Math.round(cents / 10), status: "charged", transferStatus: "sent", stripePaymentIntentId: pi(), createdAt: next(), ...over } });
  const one = (note: string, cents: number, over: Record<string, unknown> = {}) => db.payment.create({ data: { kind: "owed", developerId: devId, testerId: devId, amountCents: cents, feeCents: cents, testerCents: 0, status: "bundled", note, stripePaymentIntentId: pi(), settledAt: new Date(), createdAt: next(), ...over } });
  const covered = (g: { id: string; stripePaymentIntentId: string | null }, over: Record<string, unknown> = {}) => ({ settledAt: new Date(), coveredById: g.id, stripePaymentIntentId: g.stripePaymentIntentId, ...over });
  const repay = (orig: { id: string; contractId: string | null; testerId: string }, cents: number, g: { id: string; stripePaymentIntentId: string | null }, over: Record<string, unknown> = {}) =>
    db.payment.create({ data: { kind: "chargeback", repaysId: orig.id, contractId: orig.contractId, developerId: devId, testerId: orig.testerId, amountCents: cents, feeCents: cents, testerCents: 0, status: "charged", transferStatus: "none", createdAt: next(), ...covered(g), ...over } });

  // Paid on their own.
  const own = await pay(ana, 1000);
  const bank = await pay(cid, 800, { settledAt: new Date() }); // a single Confirm with your bank
  const morePaid = await pay(ben, 100, { kind: "extra", chargebackAt: new Date(), chargeback: "resolved" }); // the bank reversed it; repaid in G1
  const wonPay = await pay(ana, 500, { chargebackAt: new Date(), chargeback: "won" }); // repaid in G3, then the platform won: its repayment refunded
  const testerCharge = await pay(cid, 1200, { chargebackAt: new Date(), chargeback: "resolved" });
  const decision = await pay(ben, 500, { kind: "dispute", chargebackAt: new Date(), chargeback: "resolved" }, call.id);
  const autoCall = await pay(ben, 1550, { chargebackAt: new Date(), chargeback: "resolved" }, call.id);
  const partly = await pay(ana, 44467, { chargebackAt: new Date(), chargeback: "resolved", reversedCents: 9600 });
  // G1: Pay what you owe (3 items).
  const g1 = await one("press", 1000 + 1000 + 1600);
  const g1a = await pay(ana, 1000, { owedUntil: new Date(), ...covered(g1) });
  const g1b = await pay(ben, 1000, { owedUntil: new Date(), ...covered(g1) }, call.id);
  const g1c = await repay(morePaid, 1600, g1);
  // G2: Confirm all (2 testers on 2 tests).
  const g2 = await one("press:all", 1200 + 1300);
  const g2a = await pay(cid, 1200, covered(g2));
  const g2b = await pay(dee, 1300, { kind: "dispute", ...covered(g2) });
  // G4: a Pay what you owe payment the bank reversed (it covered two items), repaid in G3.
  const g4 = await one("press", 300 + 400, { chargebackAt: new Date(), chargeback: "resolved" });
  const g4a = await pay(ana, 300, { kind: "extra", owedUntil: new Date(), ...covered(g4) });
  const g4b = await pay(dee, 400, { owedUntil: new Date(), ...covered(g4) });
  // G3: the won chargeback's repayment (refunded) and G4's repayment.
  const g3 = await one("press", 2000 + 2200);
  const g3a = await repay(wonPay, 2000, g3, { status: "refunded" });
  const g3b = await repay({ id: g4.id, contractId: null, testerId: devId }, 2200, g3);
  // G5: repayments of each kind of reversed payment.
  const g5 = await one("press", 2700 + 2000 + 3050 + 11100);
  const g5a = await repay(testerCharge, 2700, g5);
  const g5b = await repay(decision, 2000, g5);
  const g5c = await repay(autoCall, 3050, g5);
  const g5d = await repay(partly, 11100, g5);
  return {
    ...s, devId, test2, g: { g1, g2, g3, g4, g5 },
    own: { own, bank, morePaid, wonPay, testerCharge, decision, autoCall, partly },
    items: { g1a, g1b, g1c, g2a, g2b, g3a, g3b, g4a, g4b, g5a, g5b, g5c, g5d },
    groupOf: { g1: [g1a, g1b, g1c], g2: [g2a, g2b], g3: [g3a, g3b], g4: [g4a, g4b], g5: [g5a, g5b, g5c, g5d] },
  };
}

describe("§191 What you've paid groups the items one charge paid", () => {
  it("one group line per Pay what you owe / Confirm all; covered items only inside; the rest their own lines; the total unchanged", async () => {
    const w = await world();
    const dev = await db.user.findUniqueOrThrow({ where: { id: w.devId } });
    const paid = await withDateZone("America/New_York", () => developerPaid(w.devId));
    // Every listed payment is drawn exactly once: on its own line or inside one group.
    const drawn = paid.entries!.flatMap((e) => ("pay" in e ? [e.pay.id] : e.group.items.map((p) => p.id)));
    expect(drawn.sort()).toEqual(paid.list.map((p) => p.id).sort());
    expect(new Set(drawn).size).toBe(drawn.length);
    const groups = paid.entries!.filter((e) => "group" in e).map((e) => ("group" in e ? e.group : null)!);
    expect(groups.map((g) => g.id).sort()).toEqual(Object.values(w.g).map((g) => g.id).sort());
    for (const [k, items] of Object.entries(w.groupOf)) expect(groups.find((g) => g.id === w.g[k as keyof typeof w.g].id)!.items.map((p) => p.id).sort()).toEqual(items.map((p) => p.id).sort());
    expect(groups.find((g) => g.id === w.g.g2.id)!.label).toBe("Confirm all");
    expect(groups.find((g) => g.id === w.g.g1.id)!.label).toBe("Pay what you owe");
    // Own lines: the Pay, the single Confirm with your bank, and every reversed original (repaid inside a group).
    expect(paid.entries!.filter((e) => "pay" in e).map((e) => ("pay" in e ? e.pay.id : "")).sort()).toEqual(Object.values(w.own).map((p) => p.id).sort());

    // The total: exactly paidOutTotal for the same rows (as before §191), and by hand: everything that went through, the refunded repayment out, each reversal
    // not won taken off (the Pay more, the tester's Charge, the decision, the automatic charge, $96 of the partly reversed Pay, and G4's whole $7.00).
    const ones = await db.payment.findMany({ where: { developerId: w.devId, kind: "owed", chargebackAt: { not: null } } });
    expect(paid.totalCents).toBe(paidOutTotal(paid.list, ones));
    const listed = paid.list.filter((p) => p.status !== "refunded").reduce((a, p) => a + p.amountCents, 0);
    expect(paid.totalCents).toBe(listed - 100 - 1200 - 500 - 1550 - 9600 - 700);
    // Summing the drawn lines (each group's items, each own line) gives the same total: nothing counted twice.
    const fromLines = paidOutTotal([...paid.entries!.flatMap((e) => ("pay" in e ? [e.pay] : e.group.items))], ones);
    expect(fromLines).toBe(paid.totalCents);

    const html = sectionOf(await ownList(dev, "developer"), "developer");
    expect(text(html)).toContain(`Total $${(paid.totalCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    // Covered items appear only inside their group: no own line for them, and the "how" words of the group are gone.
    for (const p of Object.values(w.items)) {
      expect(html.match(new RegExp(`data-paid-group-item="${p.id}"`, "g"))).toHaveLength(1);
    }
    expect(text(html)).not.toContain("paid through Pay what you owe");
    expect(text(html)).not.toContain("confirmed with Confirm all");
    expect(text(html)).toContain("confirmed with your bank"); // the single Confirm keeps its line
    // Closed by default (a <details> without open), one per charge, at the charge's amount and date.
    expect(html.match(/<details/g)).toHaveLength(5);
    expect(html).not.toMatch(/<details[^>]*open/);
    const g1 = text(groupOf(html, w.g.g1.id));
    expect(g1).toContain(`Pay what you owe · $36.00 · ${fmtDateTimeIn(w.g.g1.createdAt, "America/New_York")}`);
    expect(text(groupOf(html, w.g.g2.id))).toContain(`Confirm all · $25.00 · ${fmtDateTimeIn(w.g.g2.createdAt, "America/New_York")}`);
  });

  it("each item inside a group names exactly what it was", async () => {
    const w = await world();
    const dev = await db.user.findUniqueOrThrow({ where: { id: w.devId } });
    const html = sectionOf(await ownList(dev, "developer"), "developer");
    const item = (id: string) => text(html.match(new RegExp(`<li[^>]*data-paid-group-item="${id}"[\\s\\S]*?</li>`))?.[0] ?? "");
    const i = w.items;
    // Pay what you owe: written answers; the automatic call charge (the call by its date AND time); a Pay more's repayment + fee.
    expect(item(i.g1a.id)).toBe("Ana Silva's written answers on “Harbor Run” · $10.00");
    expect(item(i.g1b.id)).toBe("The automatic charge for Ben Okafor's live call on “Harbor Run” (Tue, Oct 27, 3:25 PM), after 7 days without a review · $10.00");
    expect(item(i.g1c.id)).toBe("Repaid: your $1.00 Pay more for Ben Okafor's written answers on “Harbor Run” that your bank reversed · $1.00 + $15.00 chargeback fee");
    // Confirm all: a tester's Charge, the team's dispute decision on another test.
    expect(item(i.g2a.id)).toBe("Cid Moreau charged for his written answers on “Harbor Run”, after 7 days without a review · $12.00");
    expect(item(i.g2b.id)).toBe("The team's dispute decision on Dee Park's written answers on “Second Run” · $13.00");
    // A chargeback won after it was repaid: the repayment inside its group, refunded (not counted: the total test).
    expect(item(i.g3a.id)).toBe("Repaid: your $5.00 Pay for Ana Silva's written answers on “Harbor Run” that your bank reversed · $5.00 + $15.00 chargeback fee · refunded (your bank's chargeback was reversed)");
    // The repayment of a Pay what you owe payment the bank reversed names that payment and when it was made.
    expect(item(i.g3b.id)).toBe(`Repaid: your $7.00 Pay what you owe payment on ${fmtDateTimeIn(w.g.g4.createdAt, "America/New_York")} (Pay more for Ana Silva's written answers on “Harbor Run”, Dee Park's written answers on “Second Run”) that your bank reversed · $7.00 + $15.00 chargeback fee`);
    // Each kind of reversed payment, named as what it was.
    expect(item(i.g5a.id)).toBe("Repaid: the $12.00 Cid Moreau charged for his written answers on “Harbor Run” that your bank reversed · $12.00 + $15.00 chargeback fee");
    expect(item(i.g5b.id)).toBe("Repaid: the team's $5.00 dispute decision on Ben Okafor's live call on “Harbor Run” (Tue, Oct 27, 3:25 PM) that your bank reversed · $5.00 + $15.00 chargeback fee");
    expect(item(i.g5c.id)).toBe("Repaid: the automatic $15.50 charge for Ben Okafor's live call on “Harbor Run” (Tue, Oct 27, 3:25 PM) that your bank reversed · $15.50 + $15.00 chargeback fee");
    expect(item(i.g5d.id)).toBe("Repaid: $96.00 of your $444.67 Pay for Ana Silva's written answers on “Harbor Run” that your bank reversed · $96.00 + $15.00 chargeback fee");
    // The reversed originals keep their own lines, marked.
    for (const p of [w.own.morePaid, w.own.wonPay, w.own.testerCharge, w.own.decision, w.own.autoCall]) {
      const li = html.match(new RegExp(`<li[^>]*>(?:(?!</li>)[\\s\\S])*?${fmtDateTimeIn(p.createdAt, "America/New_York")}(?:(?!</li>)[\\s\\S])*?</li>`))?.[0] ?? "";
      // (§218) The one the platform then won says so.
      expect(text(li), p.id).toContain(p === w.own.wonPay ? "your bank reversed this, then decided in your favour (chargeback won)" : "your bank reversed this (chargeback)");
    }
    expect(text(html)).toContain("your bank reversed $96.00 of this (chargeback)");
    // A Pay what you owe payment the bank reversed: its group line says so.
    expect(text(groupOf(html, w.g.g4.id))).toMatch(/^▸Pay what you owe · \$7\.00 · .* · your bank reversed this \(chargeback\)/);
    // Hooks: items keep data-paid-what (and link their test); each group carries its payment's id.
    expect(groupOf(html, w.g.g1.id)).toContain(`data-paid-group-item="${i.g1a.id}"`);
    expect(groupOf(html, w.g.g1.id)).toContain(`href="/app/tests/${w.testId}"`);
    expect(groupOf(html, w.g.g2.id)).toContain(`href="/app/tests/${w.test2}"`);
  });

  it("the team's copy shows the same groups; the group links the ONE PaymentIntent", async () => {
    const w = await world();
    const dev = await db.user.findUniqueOrThrow({ where: { id: w.devId } });
    const own = sectionOf(await ownList(dev, "developer"), "developer");
    const team = sectionOf(await adminView(w.devId), "developer");
    expect(team).not.toBe("");
    expect(asOwn(team)).toBe(own);
    for (const g of Object.values(w.g)) {
      const box = groupOf(team, g.id);
      // One Stripe link in the group, on its line (the summary), to the charge's PaymentIntent; none on the items inside. (Owner, Nov 4, §192) A refund line inside it
      // links the PaymentIntent it was refunded from (that same charge).
      const refundRows = box.match(/data-paid-refund="/g)?.length ?? 0;
      expect(box.match(/data-stripe-link=""/g)).toHaveLength(1 + refundRows);
      expect(box.match(/<summary[\s\S]*?<\/summary>/)![0]).toContain(`href="https://dashboard.stripe.com/test/payments/${g.stripePaymentIntentId}"`);
    }
  });

  it("the tester's earnings are unchanged: each covered item on its own line", async () => {
    const w = await world();
    const cid = await db.user.findUniqueOrThrow({ where: { id: w.items.g2a.testerId } });
    const html = sectionOf(await ownList(cid, "tester"), "tester");
    expect(html).not.toContain("data-paid-group");
    expect(text(html)).toContain("You get $10.80 from Nora Lane for your written answers on “Harbor Run”");
  });
});
