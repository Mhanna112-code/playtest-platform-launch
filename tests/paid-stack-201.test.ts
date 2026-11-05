import React, { type ReactElement } from "react";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as readPOST } from "@/app/api/notifications/read/route";
import { PAID_GROUP, bellKey, groupTitle } from "@/lib/bell";
import { paidAllLine, paidLine } from "@/lib/moneyLines";
import { emailLines, sendSummaries, unreadEntryCount } from "@/lib/server/notify";
import { decideDispute } from "@/lib/server/payments";
import { allReceipt } from "@/lib/server/confirmAll";
import { approveHoldLift, approvedWaitingLine, autoChargeCalls, startHold } from "@/lib/server/holds";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { bookCall, joined, listingBody, sact, seen, settle, setup } from "./fixtures";

vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: vi.fn(), requireOpenPage: vi.fn(), requireOpenDevPage: vi.fn(), adminAway: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-path": "/app/notifications" })) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/app", useSearchParams: () => new URLSearchParams() }));
import { requirePageUser } from "@/lib/server/page-auth";
import Notifications from "@/app/app/notifications/page";
import type { BellEntry } from "@/app/app/notifications/BellList";

// (Owner, Nov 5, §201) The developer's receipt lines lose "Receipt:" ("You paid $10.00 for …") and every payment that went through stacks under ONE "Paid · N
// payments" entry a day, across tests: the developer's Pay, a dispute decision's charge, the tester's Charge and an automatic call charge alike. Failures and other
// payment lines keep their own lines. The end-of-day email stacks them the same way.

const oldReact = globalThis.React;
vi.stubGlobal("React", React);
afterAll(() => { vi.stubGlobal("React", oldReact); });
afterEach(() => setStripeForTests(null));

const DAY = 86_400_000;
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
function find(node: React.ReactNode, predicate: (el: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) { for (const x of node) { const found = find(x, predicate); if (found) return found; } }
  if (React.isValidElement<Record<string, unknown>>(node)) {
    if (predicate(node)) return node;
    return find(node.props.children as React.ReactNode, predicate);
  }
}
async function anotherTest(devCookie: string, title: string) {
  const r = await json(await testsPOST(req("/api/tests", { cookie: devCookie, body: listingBody({ title, productName: title }) })));
  expect(r.status).toBe(200);
  await settle();
  return r.body.id as string;
}
async function sent(testId: string, name: string, pronoun = "she") {
  const j = await joined(testId, name, pronoun);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await settle();
  return { ...j, sub: await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } }) };
}

describe("§201 the developer's payments stack under one 'Paid · N payments' entry a day", () => {
  it("a Pay, a decision charge, a tester's Charge and an automatic call charge on two tests: no 'Receipt', one group, one stacked entry; a failure stays its own", async () => {
    const { dev, testId } = await setup();
    const sky = await anotherTest(dev.cookie, "Sky Lab");
    // 1. The developer's Pay on “Harbor Run” (below the listing, with a reason).
    const ana = await sent(testId, "Ana Silva");
    expect((await pay(dev.cookie, { kind: "submission", id: ana.sub.id, amount: "4.00", tickedCents: 400, reason: "Only half of it was useful" })).status).toBe(200);
    // 2. Ana disputes it; the team decides $10.00 in all: $6.00 more charged.
    expect((await sact(ana.sessionId, "dispute", ana.tester.cookie, { kind: "submission", id: ana.sub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true })).status).toBe(200);
    const admin = await db.user.update({ where: { id: (await makeUser({ name: "Admin" })).user.id }, data: { isAdmin: true } });
    const row = await db.dispute.findFirstOrThrow({ where: { submissionId: ana.sub.id } });
    expect((await decideDispute(admin, row.id, { total: "10.00", tickCents: 600 })).extraCents).toBe(600);
    // 3. Ben's Charge on “Sky Lab” (his review date and deadline passed).
    const ben = await sent(sky, "Ben Okafor", "he");
    // (Cara joins and books her call while “Sky Lab” is still open.)
    const cara = await joined(sky, "Cara Diaz");
    const call = await bookCall(sky, dev.cookie, cara.sessionId, cara.tester.cookie, 48);
    await db.test.update({ where: { id: sky }, data: { openUntil: new Date(Date.now() - 1000) } });
    await db.contract.update({ where: { id: ben.sessionId }, data: { dueAt: new Date(Date.now() - 1000) } });
    await db.submission.update({ where: { id: ben.sub.id }, data: { payBy: new Date(Date.now() - 1000), choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * DAY) } });
    expect((await sact(ben.sessionId, "choose", ben.tester.cookie, { submissionId: ben.sub.id, choice: "charge" })).body).toMatchObject({ choice: "charge", amountCents: 1000 });
    // 4. Cara's listed call on “Sky Lab”, unpaid 7 days after it: charged automatically.
    await db.call.update({ where: { id: call.id }, data: { startsAt: new Date(Date.now() - 8 * DAY), actualMinutes: 30, payBy: new Date(Date.now() - 60_000) } });
    await autoChargeCalls(new Date());
    await db.call.update({ where: { id: call.id }, data: { payBy: null } });

    const paid = await db.notification.findMany({ where: { userId: dev.user.id, text: { startsWith: "You paid " } }, orderBy: { createdAt: "asc" } });
    expect(paid.map((n) => n.text)).toEqual([
      "You paid $4.00 for Ana Silva's written answers on “Harbor Run”",
      expect.stringMatching(/^You paid \$6\.00 for the team's dispute decision on Ana Silva's written answers on “Harbor Run”/),
      "You paid $10.00 for Ben Okafor's written answers on “Sky Lab” (charged by him after 7 days)",
      expect.stringMatching(/^You paid \$15\.00 for Cara Diaz's live call on “Sky Lab” \(.*, charged automatically after 7 days\)$/),
    ]);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { contains: "Receipt" } } })).toBe(0);
    // One group, across both tests: not "own", payment lines, one bell key.
    for (const n of paid) expect(n).toMatchObject({ groupKey: PAID_GROUP, own: false, payment: true, side: "developer" });
    expect(new Set(paid.map((n) => n.testId))).toEqual(new Set([testId, sky]));
    expect(new Set(paid.map(bellKey)).size).toBe(1);
    expect(groupTitle(PAID_GROUP, 2, 4)).toBe("Paid · 4 payments");
    expect(groupTitle(PAID_GROUP, 1, 1)).toBe("Paid · 1 payment");

    // 5. A declined Pay on “Harbor Run”: its failure / hold lines are never in the Paid stack.
    const dee = await sent(testId, "Dee Moss");
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    setStripeForTests({ paymentIntents: { create: async () => { throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError" }); } } } as unknown as Stripe);
    await pay(dev.cookie, { kind: "submission", id: dee.sub.id, amount: "10.00", tickedCents: 1000 });
    setStripeForTests(null);
    const others = await db.notification.findMany({ where: { userId: dev.user.id, payment: true, NOT: { text: { startsWith: "You paid " } } } });
    expect(others.length).toBeGreaterThan(0);
    for (const n of others) expect(n.groupKey, n.text).not.toBe(PAID_GROUP);
    const paidKey = bellKey(paid[0]);
    for (const n of others) expect(bellKey(n), n.text).not.toBe(paidKey);

    // The Notifications page: ONE entry "Paid · 4 payments" holding the four lines (counted: no "· N updates"), the failure beside it.
    const u = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    vi.mocked(requirePageUser).mockResolvedValue(u);
    const entries = find(await Notifications(), (e) => Array.isArray(e.props.entries))!.props.entries as BellEntry[];
    const stacks = entries.filter((e) => e.title?.startsWith("Paid"));
    expect(stacks).toHaveLength(1);
    expect(stacks[0]).toMatchObject({ title: "Paid · 4 payments", counted: true, day: "today" });
    expect(stacks[0].lines.map((l) => l.text).sort()).toEqual(paid.map((n) => n.text).sort());
    expect(entries.some((e) => e.key !== stacks[0].key && e.lines.some((l) => others.some((o) => o.id === l.id)))).toBe(true);

    // The bell's number counts the stack once; expanding it (all its lines read) takes it off.
    const before = await unreadEntryCount(dev.user.id);
    expect((await json(await readPOST(req("/api/notifications/read", { cookie: dev.cookie, body: { ids: paid.map((n) => n.id) } })))).status).toBe(200);
    expect(await unreadEntryCount(dev.user.id)).toBe(before - 1);

    // The end-of-day payment email stacks them under the same heading.
    await db.user.update({ where: { id: dev.user.id }, data: { emailPref: "off" } });
    await sendSummaries(new Date(), [dev.user.id]);
    const mail = await db.outboxEmail.findFirstOrThrow({ where: { to: dev.user.email }, orderBy: { createdAt: "desc" } });
    const text = mail.text.split("\n");
    const at = text.indexOf("• Paid · 4 payments");
    expect(at, mail.text).toBeGreaterThanOrEqual(0);
    expect(text.slice(at + 1, at + 5).every((l) => l.startsWith("  • You paid "))).toBe(true);
    expect(mail.text).not.toContain("Receipt");
  });

  it("the words: one form for every receipt, Confirm all's combined line too; a subscription renewal stacks with them", async () => {
    expect(paidLine(1000, "Ana Silva's written answers on “Harbor Run”")).toBe("You paid $10.00 for Ana Silva's written answers on “Harbor Run”");
    expect(paidAllLine(4200, "Ana Silva's written answers on “Harbor Run” $10.00, Ben Okafor's recording on “Sky Lab” $32.00")).toBe(
      "You paid $42.00 for: Ana Silva's written answers on “Harbor Run” $10.00, Ben Okafor's recording on “Sky Lab” $32.00",
    );
    const d = await makeUser({ dev: true, name: "Nora Lane" });
    await allReceipt(d.user.email, [{ name: "Ana Silva's written answers on “Harbor Run”", cents: 1000 }, { name: "Ben Okafor's recording on “Sky Lab”", cents: 3200 }], "charged");
    const { receipt } = await import("@/lib/server/payments");
    await receipt(d.user.email, "your subscription ($7/month)", 700, "charged", "/app/payments#subscription");
    const rows = await db.notification.findMany({ where: { userId: d.user.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((n) => n.text)).toEqual(["You paid $42.00 for: Ana Silva's written answers on “Harbor Run” $10.00, Ben Okafor's recording on “Sky Lab” $32.00", "You paid $7.00 for your subscription ($7/month)"]);
    for (const n of rows) expect(n).toMatchObject({ groupKey: PAID_GROUP, own: false, payment: true });
    expect(new Set(rows.map(bellKey)).size).toBe(1);
  });

  it("the email: one line of a kind stays plain; deadlines still stack; two kinds stack side by side", () => {
    const n = (id: string, text: string, groupKey: string | null, testId: string | null = null) => ({ id, text, link: "", groupKey, testId });
    const line = (x: { text: string }) => `• ${x.text}`;
    expect(emailLines([n("1", "You paid $4.00 for x", PAID_GROUP, "t1"), n("2", "Other", null)], line)).toEqual(["• You paid $4.00 for x", "• Other"]);
    expect(emailLines([n("1", "You paid $4.00 for x", PAID_GROUP, "t1"), n("2", "Deadline A", "deadlines", "t1"), n("3", "You paid $6.00 for y", PAID_GROUP, "t2"), n("4", "Deadline B", "deadlines", "t2")], line)).toEqual([
      "• Paid · 2 payments", "  • You paid $4.00 for x", "  • You paid $6.00 for y",
      "• Deadlines · 2 tests", "  • Deadline A", "  • Deadline B",
    ]);
  });
});

describe("§201 the team's Approve of a hold lift says what the team did, in one line", () => {
  async function heldPastThree(note: string) {
    const d = await makeUser({ dev: true, name: "Nora Lane" });
    await db.user.update({ where: { id: d.user.id }, data: { holdCount: 3 } });
    await startHold(d.user.id, "unpaid");
    const admin = await db.user.update({ where: { id: (await makeUser({ name: "Admin" })).user.id }, data: { isAdmin: true } });
    const since = new Date();
    await settle();
    const r = await approveHoldLift(admin.id, d.user.id, note);
    const mine = await db.notification.findMany({ where: { userId: d.user.id, createdAt: { gt: since } }, orderBy: { createdAt: "asc" } });
    return { r, mine, d };
  }

  it("lifted at once with a note: one line naming the team, with their note in it (owner, Nov 5)", async () => {
    const { r, mine } = await heldPastThree("Thanks for sorting this out quickly.");
    expect(r.lifted).toBe(true);
    expect(mine.map((n) => n.text)).toEqual(["The team approved lifting your hold: your tests are running again. Their note: “Thanks for sorting this out quickly.”"]);
    expect(mine[0]).toMatchObject({ groupKey: "admindecision", payment: true });
  });

  it("lifted at once without a note: the same one line (no separate 'Your tests are running again')", async () => {
    const { r, mine } = await heldPastThree("");
    expect(r.lifted).toBe(true);
    expect(mine.map((n) => n.text)).toEqual(["The team approved lifting your hold: your tests are running again."]);
  });

  it("approved while money is still owed: says it lifts once paid", async () => {
    const d = await makeUser({ dev: true, name: "Nora Lane" });
    await db.user.update({ where: { id: d.user.id }, data: { holdCount: 3 } });
    await startHold(d.user.id, "unpaid");
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    await db.payment.create({ data: { kind: "review", developerId: d.user.id, testerId: t.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "owed" } });
    const admin = await db.user.update({ where: { id: (await makeUser({ name: "Admin" })).user.id }, data: { isAdmin: true } });
    const since = new Date();
    await settle();
    expect((await approveHoldLift(admin.id, d.user.id, "Pay the rest soon")).lifted).toBe(false);
    const mine = await db.notification.findMany({ where: { userId: d.user.id, createdAt: { gt: since } } });
    expect(mine.map((n) => n.text)).toEqual([`${approvedWaitingLine()}. Their note: “Pay the rest soon”`]);
    expect(approvedWaitingLine()).toBe("The team approved lifting your hold: it lifts once you have paid what you owe");
    await db.payment.updateMany({ where: { developerId: d.user.id, status: "owed" }, data: { status: "cancelled" } });
  });
});
