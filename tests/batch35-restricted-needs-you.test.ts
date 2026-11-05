import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as excerptsPOST } from "@/app/api/excerpts/route";
import { bankToConfirm } from "@/lib/server/confirm";
import { json, makeUser, req } from "./helpers";
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


// (Owner, Nov 4, §175) The charges waiting for the bank are grouped under each tester's name (the green profile link): groups in the order of their oldest charge,
// charges oldest first inside a group, each with its own Confirm with your bank; the line names the piece by the tester's pronoun.
describe("§175 Confirm with your bank grouped by tester", () => {
  async function twoTesters(state: "active" | "held") {
    const f = await fixture("active");
    const b = await joined(f.testId, "Bea Stone", "she");
    await sact(b.sessionId, "written", b.tester.cookie, { answers: ["Her answer", "Her other answer"] });
    const bSub = await db.submission.findFirstOrThrow({ where: { contractId: b.sessionId } });
    const at = (ms: number) => new Date(f.payment.createdAt.getTime() + ms);
    const wait = (contractId: string, submissionId: string, testerId: string, cents: number, createdAt: Date) =>
      db.payment.create({ data: { kind: "extra", contractId, submissionId, developerId: f.dev.user.id, testerId, amountCents: cents, feeCents: 0, testerCents: cents, status: "needs_confirmation", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 2 * 86_400_000), createdAt } });
    const bea1 = await wait(b.sessionId, bSub.id, b.tester.user.id, 700, at(1000));
    const alex2 = await wait(f.sessionId, f.sub.id, f.tester.user.id, 800, at(2000));
    if (state === "held") auth.user = await db.user.update({ where: { id: f.dev.user.id }, data: { holdStartedAt: new Date(), holdReason: "payment" } });
    const { default: Page } = await import("@/app/app/tests/[id]/page");
    const html = renderToStaticMarkup(await serverTree(await Page({ params: Promise.resolve({ id: f.testId }), searchParams: Promise.resolve({}) })));
    return { f, b, bea1, alex2, html };
  }

  it.each(["active", "held"] as const)("one group per tester under their green name, oldest first (%s)", async (state) => {
    const { f, b, bea1, alex2, html } = await twoTesters(state);
    const where = html.indexOf('id="needs-you"');
    expect(where).toBeGreaterThan(0);
    // (Owner, Nov 4, §181) Each person is ONE drop-down holding everything in Needs you about them; their charges sit in it under "Confirm with your bank".
    const alexPerson = html.indexOf(`data-needs-person="${f.sessionId}"`), bePerson = html.indexOf(`data-needs-person="${b.sessionId}"`);
    const alexGroup = html.indexOf(`data-bank-group="${f.sessionId}"`);
    const beaGroup = html.indexOf(`data-bank-group="${b.sessionId}"`);
    expect(alexPerson).toBeGreaterThan(where);
    expect(alexGroup).toBeGreaterThan(alexPerson);
    // Alex's oldest thing is the oldest of all: Alex's drop-down first, then Bea's.
    expect(bePerson).toBeGreaterThan(alexGroup);
    expect(beaGroup).toBeGreaterThan(bePerson);
    expect(html.match(/data-bank-group="/g)).toHaveLength(2);
    expect(html.match(/data-needs-person="/g)).toHaveLength(2);
    if (state === "held") {
      expect(html.indexOf('data-restricted-bank=""')).toBeGreaterThan(alexPerson);
      expect(html.match(/data-restricted-bank=""/g)).toHaveLength(2);
    }
    // Each summary is the tester's green profile link.
    expect(html.slice(alexPerson, alexGroup)).toMatch(new RegExp(`<a href="/app/testers/${f.tester.user.id}"[^>]*data-name-link="person"`));
    expect(html.slice(bePerson, beaGroup)).toMatch(new RegExp(`<a href="/app/testers/${b.tester.user.id}"[^>]*data-name-link="person"`));
    // Alex's two charges inside Alex's drop-down, oldest first; Bea's in hers.
    const p1 = html.indexOf(`data-bank-waiting="${f.payment.id}"`), p2 = html.indexOf(`data-bank-waiting="${alex2.id}"`), p3 = html.indexOf(`data-bank-waiting="${bea1.id}"`);
    expect(p1).toBeGreaterThan(alexGroup);
    expect(p2).toBeGreaterThan(p1);
    expect(bePerson).toBeGreaterThan(p2);
    expect(p3).toBeGreaterThan(beaGroup);
    // The lines name the piece by the pronoun, not the name the heading carries.
    expect(html).toContain("Your bank wants you to confirm a $7.00 payment for her written answers, made while you were away.");
    expect(html).toContain("Your bank wants you to confirm a $6.00 payment for their written answers, made while you were away.");
    // (§180, §181) Each drop-down is closed at first; the summary is the green name, then "· N things", then (§195) "paid $0.00 so far" (Alex: two charges, the dispute, the excerpt request;
    // Bea: her written answers to pay and her charge, or only the charge while held).
    const alexTag = html.slice(alexPerson - 200, alexPerson + 100);
    expect(alexTag).toMatch(/<details class="[^"]*" data-hold-fold="" data-needs-person="/);
    expect(alexTag).not.toMatch(/<details[^>]*\sopen=""[^>]*data-needs-person=/);
    expect(html.match(/data-needs-person-toggle=""/g)).toHaveLength(2);
    expect(html.slice(alexPerson, alexGroup)).toMatch(/<summary[^>]*data-needs-person-toggle=""[^>]*>.*data-name-link="person".*· 4 things<\/span><span[^>]*data-paid-so-far="0">paid \$0\.00<span class="hidden sm:inline"> so far<\/span><\/span><\/span><\/summary>/);
    expect(html.slice(bePerson, beaGroup)).toMatch(new RegExp(`· ${state === "held" ? "1 thing" : "2 things"}</span><span[^>]*data-paid-so-far="0">paid \\$0\\.00<span class="hidden sm:inline"> so far</span></span></span></summary>`));
    // (Owner, Nov 4, §199; was §181's sub-heading only with more than one kind) Each kind is a closed drop-down of its own with its count, even a person's only kind.
    expect(html.slice(alexPerson, bePerson)).toContain('data-needs-kind="bank">Confirm with your bank (2)</span>');
    expect(html.slice(bePerson)).toContain('data-needs-kind="bank">Confirm with your bank (1)</span>');
    const alexBank = html.slice(alexPerson, bePerson).match(/<details[^>]*data-needs-kind-fold="bank"[^>]*>/)![0];
    expect(alexBank).toContain(`data-bank-group="${f.sessionId}"`);
    expect(alexBank).toContain('data-hold-fold=""');
    expect(alexBank).not.toMatch(/\sopen=""/);
    // (§180) The lines name no test on its own page (no “title”).
    for (const id of [f.payment.id, alex2.id, bea1.id]) {
      const box = html.slice(html.indexOf(`data-bank-waiting="${id}"`));
      expect(box.slice(0, box.indexOf("</p>"))).not.toContain("“");
    }
    if (state === "active") {
      // The links up from each tester's row still land on the charge (inside its group).
      expect(html).toContain(`href="#bank-${bea1.id}"`);
      expect(html).toContain(`data-bank-up="${bea1.id}"`);
    }
  });
});

// (Owner, Nov 4, §181) "Is it possible in Needs you to have all notifications about the same person under each name" ("expandable"; summary: the name and
// "· N things"; "the parts should have big drop down with their name then part and pay/pay more as own dropdowns").
describe("§181 Needs you: one drop-down per person", () => {
  it("holds everything about each person, oldest first; each part and its Pay are drop-downs of their own; all closed at first", async () => {
    const f = await fixture("active"); // Alex: a dispute, an excerpt request, a charge waiting for the bank (his written answers are paid)
    const b = await joined(f.testId, "Bea Stone", "she");
    await sact(b.sessionId, "written", b.tester.cookie, { answers: ["Her answer", "Her other answer"] });
    const bSub = await db.submission.findFirstOrThrow({ where: { contractId: b.sessionId } });
    const ask = await db.callRequest.create({ data: { testId: f.testId, contractId: b.sessionId, fromSide: "tester", startsAt: new Date(Date.now() + 3 * 86_400_000), minutes: 30, times: [] } });
    const cara = await makeUser({ tester: true, name: "Cara Diaz", pronoun: "she" });
    const app = await db.application.create({ data: { testId: f.testId, testerId: cara.user.id, note: "I would like to try it", listing: {} } });
    const { default: Page } = await import("@/app/app/tests/[id]/page");
    const html = renderToStaticMarkup(await serverTree(await Page({ params: Promise.resolve({ id: f.testId }), searchParams: Promise.resolve({}) })));
    // The person whose oldest waiting thing is oldest first. (Owner, Nov 4, §199; was §181's person of their own) An applicant who hasn't joined is not a name:
    // her application is in the Applications drop-down above the names.
    expect([...html.matchAll(/data-needs-person="([^"]+)"/g)].map((m) => m[1])).toEqual([f.sessionId, b.sessionId]);
    const at = (k: string) => html.indexOf(`data-needs-person="${k}"`);
    const appsAt = html.indexOf('data-needs-applications="1"');
    expect(appsAt).toBeGreaterThan(html.indexOf('id="needs-you"'));
    expect(appsAt).toBeLessThan(at(f.sessionId));
    const alex = html.slice(at(f.sessionId), at(b.sessionId)), bea = html.slice(at(b.sessionId), html.indexOf('data-call-requests-box=""')), cara1 = html.slice(appsAt, at(f.sessionId));
    // The count on Needs you is still every thing; each summary is the green name and "· N things", then (Owner, Nov 4, §195) a tester's paid so far on the right
    // (none for an applicant who hasn't joined).
    expect(html).toMatch(/<h2 class="inline">Needs you<\/h2> <span class="text-sm font-normal text-slate-400">6<\/span>/);
    expect(alex).toMatch(/data-name-link="person".*· 3 things<\/span><span[^>]*data-paid-so-far="0">paid \$0\.00<span class="hidden sm:inline"> so far<\/span><\/span><\/span><\/summary>/);
    expect(bea).toMatch(/data-name-link="person".*· 2 things<\/span><span[^>]*data-paid-so-far="0">paid \$0\.00<span class="hidden sm:inline"> so far<\/span><\/span><\/span><\/summary>/);
    expect(cara1).toMatch(/<span>Applications \(1\)<\/span><\/summary>/);
    expect(html).not.toContain("parts to pay");
    expect(html).not.toContain("charges waiting");
    // Everything about Alex in his: the charge, the dispute (Add your side), the excerpt request; (§199) each kind a drop-down with its count.
    expect(alex).toContain(`data-bank-waiting="${f.payment.id}"`);
    expect(alex).toContain(`id="item-dispute-${f.dispute.id}"`);
    expect(alex).toContain(`id="excerpt-${f.excerpt.id}"`);
    for (const h of ['data-needs-kind="bank">Confirm with your bank (1)</span>', 'data-needs-kind="disputes">Disputes (1)</span>', 'data-needs-kind="excerpts">Excerpt requests (1)</span>']) expect(alex).toContain(h);
    // Bea: her written answers (a drop-down named plainly, the Pay box its own drop-down inside it), then her call request.
    const part = bea.indexOf(`id="piece-${bSub.id}"`), fold = bea.indexOf(`data-fold="needs-part-${bSub.id}"`), pay = bea.indexOf(`data-fold="needs-pay-${bSub.id}"`), req1 = bea.indexOf(`data-needs-requests="${b.sessionId}"`);
    expect(part).toBeGreaterThan(0);
    expect(fold).toBeGreaterThan(part);
    expect(pay).toBeGreaterThan(fold);
    expect(req1).toBeGreaterThan(pay);
    expect(bea).toContain(">Written answers</summary>");
    expect(bea).toContain(">Pay</summary>");
    expect(bea).toContain('data-needs-kind="pay">Pay (1)</span>');
    expect(bea).toContain('data-needs-kind="requests">Call requests (1)</span>');
    // (§181) Her call request: one line in Needs you ("1 call request ↓", no buttons) jumping to her drop-down in the Call requests box.
    expect(bea).toContain(`href="#call-requests-person-${b.sessionId}">1 call request ↓</a>`);
    // Cara: her application with Accept / Decline, in the Applications drop-down (no kind drop-down there).
    expect(cara1).toContain(`id="item-app-${app.id}"`);
    expect(cara1).toContain("Accept</button>");
    expect(cara1).not.toContain("data-needs-kind=");
    // Every drop-down (person, part, Pay; the Call requests box's person) is closed at first, and none remembers its state; the Call requests box itself is open.
    const box = html.indexOf('data-call-requests-box=""');
    expect(box).toBeGreaterThan(html.indexOf('id="needs-you"'));
    const holds = [...html.matchAll(/<details[^>]*data-hold-fold=""[^>]*>/g)].map((m) => m[0]);
    // Applications; Alex and his 3 kinds; Bea, her 2 kinds, her part and its Pay; the Call requests box and its person.
    expect(holds.length).toBe(12);
    for (const d of holds.filter((x) => !x.includes("data-call-requests-box"))) expect(d).not.toMatch(/\sopen=""/);
    expect(holds.find((x) => x.includes("data-call-requests-box"))).toMatch(/\sopen=""/);
    // The box: one drop-down per person ("· 1 request"), her request inside it with Accept / Decline; no Needs you row with buttons.
    const inBox = html.slice(html.indexOf(`id="call-requests-person-${b.sessionId}"`));
    expect(inBox).toMatch(/data-name-link="person".*· 1 request<\/span><span[^>]*data-paid-so-far="0">paid \$0\.00<span class="hidden sm:inline"> so far<\/span><\/span><\/span><\/summary>/);
    expect(inBox.indexOf(`id="req-${ask.id}"`)).toBeGreaterThan(0);
    expect(inBox).toContain("Decline</button>");
    expect(html).not.toContain(`id="needs-req-${ask.id}"`);
    expect(html.match(/data-needs-person-toggle=""/g)).toHaveLength(2);
  });
});
