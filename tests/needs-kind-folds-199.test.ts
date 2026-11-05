import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { makeUser } from "./helpers";
import { joined, sact, setup } from "./fixtures";

// (Owner, Nov 4, §199) Needs you on the developer's test page: each kind under a person is its own closed drop-down with its count ("Pay (2)"), Rate excepted
// (plain under the name); "Confirm with your bank" works only in Needs you (the Testers list links up to it in every view); one "Applications (N)" drop-down
// above all the names holds every application and ask to rejoin, oldest first.

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

async function page(testId: string) {
  const { default: Page } = await import("@/app/app/tests/[id]/page");
  return renderToStaticMarkup(await serverTree(await Page({ params: Promise.resolve({ id: testId }), searchParams: Promise.resolve({}) })));
}

const src = () => readFileSync("src/app/app/tests/[id]/page.tsx", "utf8");
/** The opening `<details …>` tag of the kind drop-down `kind` inside `html`. */
const kindTag = (html: string, kind: string) => html.match(new RegExp(`<details[^>]*data-needs-kind-fold="${kind}"[^>]*>`))?.[0];

async function world() {
  const f = await setup();
  const t0 = Date.now() - 10 * 86_400_000;
  // Alex: a charge waiting for the bank (on his paid written answers), a dispute, an excerpt request.
  const a = await joined(f.testId, "Alex Morgan", "they");
  await sact(a.sessionId, "written", a.tester.cookie, { answers: ["A helpful answer", "Another helpful answer"] });
  const aSub = await db.submission.findFirstOrThrow({ where: { contractId: a.sessionId } });
  await db.review.create({ data: { contractId: a.sessionId, submissionId: aSub.id, amountCents: 400, agreedCents: 1000, payKey: randomUUID() } });
  const dispute = await db.dispute.create({ data: { contractId: a.sessionId, submissionId: aSub.id, testerId: a.tester.user.id, reason: "I answered every question fully." } });
  const excerpt = await db.excerpt.create({ data: { contractId: a.sessionId, testId: f.testId, testerId: a.tester.user.id, submissionId: aSub.id, question: "What did you like?", text: "A helpful answer", status: "pending" } });
  const charge = await db.payment.create({ data: { kind: "extra", contractId: a.sessionId, submissionId: aSub.id, developerId: f.dev.user.id, testerId: a.tester.user.id, amountCents: 600, feeCents: 120, testerCents: 480, status: "needs_confirmation", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 2 * 86_400_000) } });
  // Dan: he rated the developer (Rate is open) and asked for a call.
  const d = await joined(f.testId, "Dan Reyes", "he");
  await db.rating.create({ data: { testId: f.testId, contractId: d.sessionId, side: "tester", raterId: d.tester.user.id, rateeId: f.dev.user.id, stars: 5 } });
  await db.callRequest.create({ data: { testId: f.testId, contractId: d.sessionId, fromSide: "tester", startsAt: new Date(Date.now() + 3 * 86_400_000), minutes: 30, times: [] } });
  // Eve: sent her written answers (to pay), then left; she asks to rejoin.
  const e = await joined(f.testId, "Eve Brooks", "she");
  await sact(e.sessionId, "written", e.tester.cookie, { answers: ["Her answer", "Her other answer"] });
  const eSub = await db.submission.findFirstOrThrow({ where: { contractId: e.sessionId } });
  await db.contract.update({ where: { id: e.sessionId }, data: { status: "left", endedAt: new Date(), endKind: "left" } });
  // Three requests, created out of order: Fay applied first, then Eve asked to rejoin, then Cara applied.
  const cara = await makeUser({ tester: true, name: "Cara Diaz", pronoun: "she" });
  const fay = await makeUser({ tester: true, name: "Fay Lin", pronoun: "she" });
  const caraApp = await db.application.create({ data: { testId: f.testId, testerId: cara.user.id, note: "Cara would like to try it", listing: {}, createdAt: new Date(t0 + 3000) } });
  const eveApp = await db.application.create({ data: { testId: f.testId, testerId: e.tester.user.id, kind: "rejoin", note: "Eve would like back in", listing: {}, createdAt: new Date(t0 + 2000) } });
  const fayApp = await db.application.create({ data: { testId: f.testId, testerId: fay.user.id, note: "Fay would like to try it", listing: {}, createdAt: new Date(t0 + 1000) } });
  auth.user = await db.user.findUniqueOrThrow({ where: { id: f.dev.user.id } });
  return { f, a, d, e, aSub, eSub, dispute, excerpt, charge, caraApp, eveApp, fayApp };
}

describe("§199 Needs you: each kind a drop-down, Rate plain, one Applications drop-down", () => {
  it("draws every kind (Rate excepted) as a closed drop-down with its count; the applications sit in one group above the names, oldest first", async () => {
    const w = await world();
    const html = await page(w.f.testId);
    const needs = html.indexOf('id="needs-you"');
    // The badge counts the same things as before: Alex's charge, dispute and excerpt request; Eve's written answers; Dan's call request and Rate; 3 applications.
    expect(html).toMatch(/<h2 class="inline">Needs you<\/h2> <span class="text-sm font-normal text-slate-400">9<\/span>/);
    // The people: no applicant is a name of their own; Eve (a rejoiner with something else) keeps a name for her written answers.
    const people = [...html.matchAll(/data-needs-person="([^"]+)"/g)].map((m) => m[1]);
    expect(people.sort()).toEqual([w.a.sessionId, w.d.sessionId, w.e.sessionId].sort());
    for (const app of [w.caraApp, w.eveApp, w.fayApp]) expect(html).not.toContain(`data-needs-person="${app.id}"`);

    // The Applications drop-down: inside Needs you, above every name, closed, "Applications (3)", Fay, Eve (her ask to rejoin), Cara in that order.
    const apps = html.indexOf('data-needs-applications="3"');
    const firstName = Math.min(...people.map((k) => html.indexOf(`data-needs-person="${k}"`)));
    expect(apps).toBeGreaterThan(needs);
    expect(apps).toBeLessThan(firstName);
    const appsTag = html.slice(html.lastIndexOf("<details", apps), html.indexOf(">", apps) + 1);
    expect(appsTag).toContain('data-hold-fold=""');
    expect(appsTag).not.toMatch(/\sopen=""/);
    const group = html.slice(apps, firstName);
    expect(group).toContain("<span>Applications (3)</span></summary>");
    const order = [w.fayApp, w.eveApp, w.caraApp].map((x) => group.indexOf(`id="item-app-${x.id}"`));
    expect(order[0]).toBeGreaterThan(0);
    expect(order[1]).toBeGreaterThan(order[0]);
    expect(order[2]).toBeGreaterThan(order[1]);
    // Each keeps its own Accept / Decline; Eve's reads as an ask to rejoin.
    expect(group.match(/>Accept<\/button>/g)).toHaveLength(3);
    expect(group.match(/>Decline<\/button>/g)).toHaveLength(3);
    expect(group.match(/data-needs-application="/g)).toHaveLength(3);
    expect(group.slice(order[1], order[2])).toContain("asks to rejoin");
    // No application inside a person's drop-down.
    expect(html.slice(firstName).includes("item-app-")).toBe(false);

    const at = (k: string) => html.indexOf(`data-needs-person="${k}"`);
    const slice = (k: string) => { const s = at(k); const next = people.map(at).filter((x) => x > s).sort((x, y) => x - y)[0] ?? html.indexOf('data-call-requests-box=""'); return html.slice(s, next); };
    const alex = slice(w.a.sessionId), dan = slice(w.d.sessionId), eve = slice(w.e.sessionId);
    // Alex: three kinds, each a closed drop-down with its count; the summary still counts "· 3 things".
    expect(alex).toContain("· 3 things");
    for (const [kind, label] of [["bank", "Confirm with your bank (1)"], ["disputes", "Disputes (1)"], ["excerpts", "Excerpt requests (1)"]]) {
      const tag = kindTag(alex, kind)!;
      expect(tag).toContain('data-hold-fold=""');
      expect(tag).toContain(`data-needs-kinds="${kind}"`);
      expect(tag).not.toMatch(/\sopen=""/);
      expect(alex).toContain(`data-needs-kind="${kind}">${label}</span></summary>`);
    }
    expect(kindTag(alex, "bank")).toContain(`data-bank-group="${w.a.sessionId}"`);
    // Things sit inside their kind's drop-down: the charge, the dispute, the excerpt request.
    expect(alex.indexOf(`id="bank-${w.charge.id}"`)).toBeGreaterThan(alex.indexOf('data-needs-kind-fold="bank"'));
    expect(alex.indexOf(`id="item-dispute-${w.dispute.id}"`)).toBeGreaterThan(alex.indexOf('data-needs-kind-fold="disputes"'));
    expect(alex.indexOf(`id="excerpt-${w.excerpt.id}"`)).toBeGreaterThan(alex.indexOf('data-needs-kind-fold="excerpts"'));
    // No h3 sub-headings any more.
    expect(html).not.toMatch(/<h3[^>]*data-needs-kind=/);

    // Eve: her one kind (Pay) is still a drop-down ("Pay (1)"), her part and its Pay drop-downs inside it as before; no application under her name.
    expect(eve).toContain("· 1 thing");
    expect(kindTag(eve, "pay")).toBeTruthy();
    expect(eve).toContain('data-needs-kind="pay">Pay (1)</span></summary>');
    const payFold = eve.indexOf('data-needs-kind-fold="pay"');
    expect(eve.indexOf(`id="piece-${w.eSub.id}"`)).toBeGreaterThan(payFold);
    expect(eve.indexOf(`data-fold="needs-part-${w.eSub.id}"`)).toBeGreaterThan(payFold);
    expect(eve.indexOf(`data-fold="needs-pay-${w.eSub.id}"`)).toBeGreaterThan(eve.indexOf(`data-fold="needs-part-${w.eSub.id}"`));
    expect(eve).not.toContain('data-needs-kind-fold="application"');

    // Dan: the call request is a drop-down; Rate is NOT: its line is plain under the name.
    expect(dan).toContain('data-needs-kind="requests">Call requests (1)</span></summary>');
    expect(dan).toContain(`data-needs-requests="${w.d.sessionId}"`);
    expect(kindTag(dan, "rate")).toBeUndefined();
    expect(dan).not.toContain('data-needs-kind="rate"');
    expect(dan).toMatch(new RegExp(`<div class="min-w-0 space-y-2" data-needs-kinds="rate"><p class="text-sm" data-rate-need="${w.d.sessionId}"><a href="#rate-${w.d.sessionId}">Rate Dan Reyes`));
  });

  it("a person whose only kind is Rate: the line plain under the name", async () => {
    const f = await setup();
    const d = await joined(f.testId, "Dan Reyes", "he");
    await db.rating.create({ data: { testId: f.testId, contractId: d.sessionId, side: "tester", raterId: d.tester.user.id, rateeId: f.dev.user.id, stars: 5 } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: f.dev.user.id } });
    const html = await page(f.testId);
    const dan = html.slice(html.indexOf(`data-needs-person="${d.sessionId}"`));
    expect(dan).toContain(`data-rate-need="${d.sessionId}"`);
    expect(html).not.toContain("data-needs-kind-fold=");
    expect(html).not.toContain("data-needs-applications=");
  });

  it("Confirm with your bank works only in Needs you: the Testers row links up to the charge inside its closed drop-downs", async () => {
    const w = await world();
    const html = await page(w.f.testId);
    // One working box, in Needs you, inside Alex's closed person drop-down and its closed "Confirm with your bank" drop-down.
    expect(html.match(/data-bank-waiting="/g)).toHaveLength(1);
    const person = html.indexOf(`data-needs-person="${w.a.sessionId}"`), fold = html.indexOf('data-needs-kind-fold="bank"'), box = html.indexOf(`id="bank-${w.charge.id}"`);
    expect(person).toBeGreaterThan(html.indexOf('id="needs-you"'));
    expect(fold).toBeGreaterThan(person);
    expect(box).toBeGreaterThan(fold);
    // The tester row: the link up (HoldFold opens every drop-down holding `#bank-<id>`'s target on the click, before the browser scrolls).
    const row = html.slice(html.indexOf(`id="tester-${w.a.sessionId}"`));
    expect(row).toContain(`<a href="#bank-${w.charge.id}" class="block text-xs" data-bank-up="${w.charge.id}">Confirm with your bank in Needs you ↑</a>`);
    expect(html.indexOf(`id="tester-${w.a.sessionId}"`)).toBeGreaterThan(box);
    // The part's Pay more box in the row is greyed with the charge's line only (no working Confirm with your bank there; §188 B's copy stays in Needs you's boxes).
    const waits = row.slice(row.indexOf('data-pay-more-waits=""'));
    expect(waits).toMatch(/^data-pay-more-waits="" data-waits-kind="away"><p class="info">Confirm Alex Morgan&#x27;s \$6\.00 charge with your bank first\./);
    expect(waits.indexOf(`data-bank-up="${w.charge.id}"`)).toBeGreaterThan(0);
    expect(src()).toMatch(/<PayBox more=\{\{ testId: t\.id, contractId: c\.id \}\} awayInNeeds owes=\{owesNow\} kind="submission"/);
    expect(src()).toMatch(/<PayBox more=\{\{ testId: t\.id, contractId: c\.id \}\} awayInNeeds owes=\{owesNow\} kind="call"/);
    expect(src()).toMatch(/<PayBox more=\{\{ testId: t\.id, contractId: c\.id \}\} update owes/);
  });

  it("the Testers list heading: the whole name, cut only by the width it has (§187's fit); the badges and the paid figure never cut", async () => {
    const LONG = "Maximiliana Anastasia Featherstonehaugh-Worthington";
    const f = await setup();
    const j = await joined(f.testId, LONG, "she");
    auth.user = await db.user.findUniqueOrThrow({ where: { id: f.dev.user.id } });
    const html = await page(f.testId);
    const row = html.slice(html.indexOf(`id="tester-${j.sessionId}"`));
    const heading = row.slice(row.indexOf("<summary"), row.indexOf("</summary>"));
    expect(heading).toMatch(new RegExp(`<h3 class="mr-auto min-w-0 max-w-\\[calc\\(100%-1\\.25rem\\)\\] font-semibold text-white" data-tester-fold-name=""><a href="/app/testers/${j.tester.user.id}" class="relative z-10 inline-block min-w-0 max-w-full align-bottom " data-name-link="person"><span class="inline-block min-w-0 max-w-full truncate align-bottom[^"]*" data-cut-fit="person">${LONG}</span></a></h3>`));
    expect(heading).not.toContain("Maximiliana…");
    expect(heading).not.toContain("data-cut-shown");
    expect(heading).toMatch(/<span class="badge shrink-0 whitespace-nowrap">Working · due /);
    expect(heading).toMatch(/<span class="ml-auto shrink-0 whitespace-nowrap[^"]*" data-paid-so-far="0">paid \$0\.00/);
    expect(src()).toContain('data-tester-fold-name=""><NameLink fit text={name} href={personHref} /></h3>');
  });

  it("the restricted view: the charge only in its Needs you (no Applications group: it shows none today); the page's code never draws the box in a tester row", async () => {
    const w = await world();
    auth.user = await db.user.update({ where: { id: w.f.dev.user.id }, data: { holdStartedAt: new Date(), holdReason: "payment" } });
    const html = await page(w.f.testId);
    expect(html.match(/data-bank-waiting="/g)).toHaveLength(1);
    const person = html.indexOf(`data-needs-person="${w.a.sessionId}"`);
    const fold = html.indexOf('data-needs-kind-fold="bank"');
    expect(person).toBeGreaterThan(html.indexOf('id="needs-you"'));
    expect(fold).toBeGreaterThan(person);
    expect(kindTag(html, "bank")).toContain('data-restricted-bank=""');
    expect(html.indexOf(`id="bank-${w.charge.id}"`)).toBeGreaterThan(fold);
    expect(html).not.toContain("data-needs-applications=");
    expect(html).not.toContain("item-app-");
    // The restricted view's kinds are drop-downs too (the disputes and excerpt requests).
    for (const kind of ["disputes", "excerpts"]) expect(kindTag(html, kind)).toBeTruthy();
    // In the code, every tester-row place for a waiting charge is the link up: BankWaiting is drawn only by Needs you's bankKind.
    const code = src();
    expect(code).not.toContain("restricted ? <BankWaiting");
    expect(code.match(/<BankWaiting /g)).toHaveLength(1);
    expect(code).toContain("const bankAt = (pieceId: string) => bankRows.filter((b) => b.pieceId === pieceId).map(bankUp);");
    expect(code).toContain(".map(bankUp)}");
  });
});
