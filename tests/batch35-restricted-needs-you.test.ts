import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as excerptsPOST } from "@/app/api/excerpts/route";
import { bankToConfirm } from "@/lib/server/confirm";
import { json, req } from "./helpers";
import { act, bookCall, joined, seen, sact, setup } from "./fixtures";

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, requireOpenPage: async () => auth.user, adminAway: () => {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), redirect: () => { throw Error("redirect"); }, notFound: () => { throw Error("not found"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

// Resolve server components, leaving hook-using client components to React's renderer.
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

async function fixture(state: "active" | "held" | "suspended" | "chargeback", withCall = false) {
  const f = await setup();
  const j = await joined(f.testId, "Alex Morgan", "they");
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["A helpful answer", "Another helpful answer"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await db.review.create({ data: { contractId: j.sessionId, submissionId: sub.id, amountCents: 400, agreedCents: 1000, payKey: randomUUID() } });
  const dispute = await db.dispute.create({ data: { contractId: j.sessionId, submissionId: sub.id, testerId: j.tester.user.id, reason: "I answered every question fully." } });
  const excerpt = await db.excerpt.create({ data: { contractId: j.sessionId, testId: f.testId, testerId: j.tester.user.id, submissionId: sub.id, question: "What did you like?", text: "A helpful answer", status: "pending" } });
  const payment = await db.payment.create({ data: { kind: "extra", contractId: j.sessionId, submissionId: sub.id, developerId: f.dev.user.id, testerId: j.tester.user.id, amountCents: 600, feeCents: 120, testerCents: 480, status: "needs_confirmation", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 2 * 86_400_000) } });
  if (withCall) await bookCall(f.testId, f.dev.cookie, j.sessionId, j.tester.cookie);
  const user = await db.user.update({ where: { id: f.dev.user.id }, data: state === "suspended" ? { devSuspendedAt: new Date() } : state === "held" || state === "chargeback" ? { holdStartedAt: new Date(), holdReason: state === "chargeback" ? "chargeback" : "payment" } : {} });
  auth.user = user;
  return { ...f, ...j, sub, dispute, excerpt, payment, user };
}

async function dashboard() {
  const { default: Page } = await import("@/app/app/page");
  return renderToStaticMarkup(await serverTree(await Page({ searchParams: Promise.resolve({}) })));
}

describe("batch 35 §106, revised: the same separate boxes below the developer's name", () => {
  it.each(["active", "held", "suspended", "chargeback"] as const)("shows all three inline action boxes while %s", async (state) => {
    const f = await fixture(state);
    const html = await dashboard();
    const name = html.indexOf("Nora Lane</h1>");
    expect(name).toBeGreaterThan(0);
    for (const marker of ["data-bank-top", "data-dispute-box", "data-excerpt-box"]) {
      expect(html.match(new RegExp(`${marker}=""`, "g"))).toHaveLength(1);
      expect(html.indexOf(`${marker}=""`)).toBeGreaterThan(name);
    }
    expect(html).toContain(`data-bank-waiting="${f.payment.id}"`);
    expect(html).toContain("Confirm with your bank</button>");
    expect(html).toContain("Disputes: add your side");
    expect(html).toContain("Excerpt requests");
    expect(html).toContain("Allow</button>");
    expect(html).toContain("Deny</button>");
    expect(html.match(new RegExp(`id="item-dispute-${f.dispute.id}"`, "g"))).toHaveLength(1);
    expect(html.match(new RegExp(`id="excerpt-${f.excerpt.id}"`, "g"))).toHaveLength(1);
    expect(html.match(/data-scroll-list="rows"/g)!.length).toBeGreaterThanOrEqual(3);
    expect(html.match(/class="card space-y-3"/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it.each(["active", "held", "suspended", "chargeback"] as const)("the existing three presses still work while %s", async (state) => {
    const f = await fixture(state);
    const side = await act(f.testId, "dispute-side", f.dev.cookie, { disputeId: f.dispute.id, text: "They answered the first question well.", seenAt: seen(), confirmed: true });
    expect(side.status).toBe(200);
    const excerpt = await json(await excerptsPOST(req("/api/excerpts", { cookie: f.dev.cookie, body: { action: "decide", excerptId: f.excerpt.id, decision: "allow", seenAt: seen(), confirmed: true } })));
    expect(excerpt.status).toBe(200);
    const bank = await json(await confirmPOST(req("/api/payments/confirm", { cookie: f.dev.cookie, body: { paymentId: f.payment.id, start: true, seenAt: seen(), confirmed: true } })));
    // (Owner, Nov 3, §159) Suspended: Confirm with your bank is refused like Pay; the charge keeps waiting.
    if (state === "suspended") {
      expect(bank.status).toBe(403);
      expect(bank.body.error.message).toContain("Your account is suspended");
      return;
    }
    expect(bank.status).toBe(200);
    const finish = await json(await confirmPOST(req("/api/payments/confirm", { cookie: f.dev.cookie, body: { paymentId: f.payment.id, simulate: "succeeded" } })));
    expect(finish.status).toBe(200);
    expect(await bankToConfirm(f.user.id)).toEqual([]);
    const html = await dashboard();
    expect(html).not.toContain('data-bank-top=""');
    expect(html).not.toContain('data-dispute-box=""');
    expect(html).not.toContain('data-excerpt-box=""');
  });

  it("keeps soonest bank deadlines first and marks the last day", async () => {
    const f = await fixture("active");
    const early = await db.payment.create({ data: { kind: "extra", contractId: f.sessionId, submissionId: f.sub.id, developerId: f.user.id, testerId: f.tester.user.id, amountCents: 100, feeCents: 20, testerCents: 80, status: "needs_confirmation", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 3_600_000) } });
    const html = await dashboard();
    expect(html.indexOf(`data-bank-top-row="${early.id}"`)).toBeLessThan(html.indexOf(`data-bank-top-row="${f.payment.id}"`));
    expect(html).toContain('data-confirm-by="soon"');
  });
});


it("groups paused test actions in one Needs you, bank before booked calls and excerpts", async () => {
  const f = await fixture("held", true);
  const { default: Page } = await import("@/app/app/tests/[id]/page");
  const html = renderToStaticMarkup(await serverTree(await Page({ params: Promise.resolve({ id: f.testId }), searchParams: Promise.resolve({}) })));
  expect(html.match(/id="needs-you"/g)).toHaveLength(1);
  expect(html).toContain(`data-bank-waiting="${f.payment.id}"`);
  expect(html).toContain(`id="excerpt-${f.excerpt.id}"`);
  const bank = html.indexOf('data-restricted-bank=""');
  const calls = html.indexOf('data-restricted-calls=""');
  const excerpts = html.indexOf('data-restricted-excerpts=""');
  expect(bank).toBeGreaterThan(html.indexOf('id="needs-you"'));
  expect(calls).toBeGreaterThan(bank);
  expect(excerpts).toBeGreaterThan(calls);
  expect(html).not.toContain('class="card space-y-2"');
});

it.each([false, true])("Your excerpts is absent from the tester dashboard (suspended: %s)", async (suspended) => {
  const f = await fixture("active");
  await db.excerpt.update({ where: { id: f.excerpt.id }, data: { status: "shown", decidedAt: new Date() } });
  auth.user = await db.user.update({ where: { id: f.tester.user.id }, data: { testerSuspendedAt: suspended ? new Date() : null } });
  const html = await dashboard();
  expect(html).not.toContain('aria-label="Your excerpts"');
  expect(html).not.toContain('data-my-excerpt=');
});

it("the own profile shows accepted excerpts only, and hides the box when none are accepted", async () => {
  const f = await fixture("active");
  const data = { contractId: f.sessionId, testId: f.testId, testerId: f.tester.user.id, submissionId: f.sub.id };
  await db.excerpt.update({ where: { id: f.excerpt.id }, data: { text: "A pending quote stays off the profile" } });
  await db.excerpt.create({ data: { ...data, text: "A declined quote stays off the profile", status: "denied" } });
  const accepted = await db.excerpt.create({ data: { ...data, text: "An accepted quote appears on the profile", status: "shown", decidedAt: new Date() } });
  auth.user = f.tester.user;
  const { default: Page } = await import("@/app/app/testers/[id]/page");
  const profile = async () => renderToStaticMarkup(await serverTree(await Page({ params: Promise.resolve({ id: f.tester.user.id }) })));
  const html = await profile();
  expect(html).toContain("An accepted quote appears on the profile");
  expect(html).not.toContain("A pending quote stays off the profile");
  expect(html).not.toContain("A declined quote stays off the profile");
  expect(html).toContain("Remove");
  await db.excerpt.update({ where: { id: accepted.id }, data: { status: "closed" } });
  expect(await profile()).not.toContain('aria-label="Your excerpts"');
});

