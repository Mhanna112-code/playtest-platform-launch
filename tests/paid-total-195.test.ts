import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { paidForWork, repaidPrincipal, workPaidCents } from "@/lib/server/paymentRows";
import { paidSoFar } from "@/lib/server/payments";
import { CHARGEBACK_FEE_CENTS, raiseNote } from "@/lib/rules";
import { joined, sact, setup } from "./fixtures";

// (Owner, Nov 4, §195) The total paid to a tester so far on a test is shown once, on the right of the row that heads their group (Needs you's person, the Testers
// row, the Call requests box's person); the Pay box no longer says "You've paid <name> $X so far on this test.".

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, requireOpenPage: async () => auth.user, adminAway: () => {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), redirect: () => { throw Error("redirect"); }, notFound: () => { throw Error("not found"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

async function serverTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(React.Children.toArray(node).map(serverTree));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === "function" && element.type.constructor.name === "AsyncFunction") {
    const resolved = await (element.type as (props: unknown) => Promise<ReactNode>)(element.props);
    return serverTree(isValidElement(resolved) && element.key !== null ? cloneElement(resolved, { key: element.key }) : resolved);
  }
  return element.props.children === undefined ? element : cloneElement(element, {}, await serverTree(element.props.children));
}

type Pay = { kind: string; amountCents: number; status?: string; chargebackAt?: Date | null; chargeback?: string; reversedCents?: number | null; repaysId?: string | null; note?: string; submissionId?: string | null; actionPi?: string; actionBy?: Date };
const payment = (f: { dev: { user: { id: string } }; tester: { user: { id: string } }; sessionId: string }, p: Pay) =>
  db.payment.create({ data: { contractId: f.sessionId, developerId: f.dev.user.id, testerId: f.tester.user.id, feeCents: 0, testerCents: 0, status: "charged", stripePaymentIntentId: "pi_" + randomUUID(), ...p } });

describe("§195 what was paid for a tester's work on a test", () => {
  it("counts Pay, Pay more, a decision charge, the tester's Charge and an automatic call charge; never a waiting charge or a chargeback fee; a reversal not paid back is taken off", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva", "she");
    const f = { ...s, ...j };
    await payment(f, { kind: "review", amountCents: 1000 }); // Pay
    await payment(f, { kind: "extra", amountCents: 500 }); // Pay more
    await payment(f, { kind: "dispute", amountCents: 300 }); // the team's decision charge
    await payment(f, { kind: "review", amountCents: 700, status: "not_set_up" }); // the tester's Charge, recorded with payments not set up
    await payment(f, { kind: "call", amountCents: 1250 }); // an automatic call charge
    // Not paid (yet): waiting for the bank, owed after a decline, deferred during a hold.
    await payment(f, { kind: "extra", amountCents: 400, status: "needs_confirmation" });
    await payment(f, { kind: "review", amountCents: 900, status: "failed" });
    await payment(f, { kind: "dispute", amountCents: 200, status: "deferred" });
    // Reversed by the bank, $3 of $8, not repaid: counts $5.
    await payment(f, { kind: "call", amountCents: 800, chargebackAt: new Date(), chargeback: "open", reversedCents: 300 });
    // Reversed whole and repaid ($10 + the $15 fee): counts $10, the repayment and its fee never.
    const repaid = await payment(f, { kind: "extra", amountCents: 1000, chargebackAt: new Date(), chargeback: "resolved" });
    await payment(f, { kind: "chargeback", amountCents: 1000 + CHARGEBACK_FEE_CENTS, repaysId: repaid.id });
    // Reversed whole, its repayment still waiting: not paid back, so it counts $0.
    const waiting = await payment(f, { kind: "review", amountCents: 600, chargebackAt: new Date(), chargeback: "open" });
    await payment(f, { kind: "chargeback", amountCents: 600 + CHARGEBACK_FEE_CENTS, repaysId: waiting.id, status: "deferred" });
    // A chargeback the platform won: counts whole.
    await payment(f, { kind: "review", amountCents: 450, chargebackAt: new Date(), chargeback: "won" });
    const other = await joined(s.testId, "Bea Stone", "she");
    await payment({ ...s, ...other }, { kind: "review", amountCents: 2000 });

    const m = await paidForWork([f.sessionId, other.sessionId]);
    expect(m.get(f.sessionId)).toBe(1000 + 500 + 300 + 700 + 1250 + 500 + 1000 + 0 + 450);
    expect(m.get(other.sessionId)).toBe(2000);
    // paidSoFar (the Pay API's response and the stop-once's payload) keeps its meaning: every charged payment on the contract, the repayment and fee included.
    expect(await paidSoFar(f.sessionId)).toBe(1000 + 500 + 300 + 700 + 1250 + 800 + 1000 + 1000 + CHARGEBACK_FEE_CENTS + 600 + 450);
    expect((await paidForWork([])).size).toBe(0);
  });

  it("follows the bank's amount after a repayment: a lowered amount refunded, a raise charged or still waiting", () => {
    const rev = (reversedCents: number) => ({ id: "p1", kind: "review", status: "charged", amountCents: 2000, reversedCents, chargebackAt: new Date(), chargeback: "resolved" });
    const repayment = { id: "r1", kind: "chargeback", note: "", amountCents: 2000 + CHARGEBACK_FEE_CENTS };
    // $20 reversed and repaid, then lowered to $12: $8 refunded of the repayment. Still all paid back: $20.
    const lowered = repaidPrincipal([repayment], [{ paymentId: "r1", amountCents: 800 }]);
    expect(lowered).toBe(1200);
    expect(workPaidCents([rev(1200)], () => lowered)).toBe(2000);
    // $12 repaid, then raised to $20: the $8 raise charged (no second fee) → $20; still waiting → $8 taken off.
    const small = { id: "r2", kind: "chargeback", note: "", amountCents: 1200 + CHARGEBACK_FEE_CENTS };
    const raise = { id: "r3", kind: "chargeback", note: raiseNote(1200, 2000), amountCents: 800 };
    expect(workPaidCents([rev(2000)], () => repaidPrincipal([small, raise], []))).toBe(2000);
    expect(workPaidCents([rev(2000)], () => repaidPrincipal([small], []))).toBe(1200);
    // Never a repayment row itself, nor a subscription.
    expect(workPaidCents([{ ...repayment, status: "charged", chargebackAt: null, chargeback: "" }, { id: "s", kind: "subscription", status: "charged", amountCents: 900, chargebackAt: null, chargeback: "" }])).toBe(0);
  });
});

describe("§195 the figure by the tester's name; not in the Pay box", () => {
  it("Needs you's person and the Testers row show paid so far; the Pay box keeps its listing only", async () => {
    const s = await setup();
    const long = "Maximiliana Anastasia Featherstonehaugh-Worthington";
    const j = await joined(s.testId, long, "she");
    const f = { ...s, ...j };
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["A helpful answer", "Another helpful answer"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    // $15 that went through (a call's pay), $6 waiting for the bank (in Needs you, not counted); a call request from her (the Call requests box).
    await payment(f, { kind: "call", amountCents: 1500 });
    await payment(f, { kind: "extra", amountCents: 600, status: "needs_confirmation", submissionId: sub.id, actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 2 * 86_400_000) });
    await db.callRequest.create({ data: { testId: f.testId, contractId: j.sessionId, fromSide: "tester", startsAt: new Date(Date.now() + 3 * 86_400_000), minutes: 30, times: [] } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: f.dev.user.id } });
    const { default: Page } = await import("@/app/app/tests/[id]/page");
    const html = renderToStaticMarkup(await serverTree(await Page({ params: Promise.resolve({ id: f.testId }), searchParams: Promise.resolve({}) })));

    // Needs you: the person's summary, the name and "· 3 things" on the left, "paid $15.00 so far" on the right, inside the summary.
    const person = html.indexOf(`data-needs-person="${j.sessionId}"`);
    expect(person).toBeGreaterThan(0);
    const summary = html.slice(person, html.indexOf("</summary>", person));
    expect(summary).toMatch(/data-needs-person-count="">· 3 things<\/span><span class="ml-auto shrink-0 whitespace-nowrap[^"]*" data-paid-so-far="1500">paid \$15\.00 so far<\/span>/);
    // The Testers row: in its name row (the fold's summary), after the badges.
    const row = html.indexOf(`id="tester-${j.sessionId}"`);
    expect(row).toBeGreaterThan(person);
    const heading = html.slice(row, html.indexOf("</summary>", row));
    expect(heading).toContain("data-tester-fold-name=");
    expect(heading).toContain('data-paid-so-far="1500">paid $15.00 so far</span>');
    expect(heading.indexOf("data-paid-so-far")).toBeGreaterThan(heading.indexOf('class="badge"'));
    expect(html).not.toContain("Paid in all");
    // The Call requests box's person: the same figure on the right of "· 1 request".
    const box = html.indexOf(`data-call-requests-person="${j.sessionId}"`);
    expect(box).toBeGreaterThan(0);
    expect(html.slice(box, html.indexOf("</summary>", box))).toMatch(/· 1 request<\/span><span[^>]*data-paid-so-far="1500">paid \$15\.00 so far<\/span>/);
    // Once per group: Needs you's person, the Testers row, the Call requests box's person.
    expect(html.match(/data-paid-so-far="/g)).toHaveLength(3);
    // The Pay box: its listing, no "so far on this test" sentence.
    const pay = html.slice(html.indexOf(`data-fold="needs-pay-${sub.id}"`));
    expect(pay).toContain("Listing: $10.00 for written answers");
    expect(html).not.toContain("so far on this test");
    expect(html).not.toMatch(/You(&#x27;|')ve paid/);
  });
});
