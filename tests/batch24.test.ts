import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { BankToConfirmBox } from "@/app/app/BankToConfirm";
import { bankTopHeading, confirmByText } from "@/lib/bankTop";
import { bankToConfirm, expireActions } from "@/lib/server/confirm";
import { startHold } from "@/lib/server/holds";
import { CLOSED_BY_TESTER, FINISHED_PART_REASON, testerChanges } from "@/lib/server/testerGate";
import { bankHref } from "@/lib/rules";
import { approveChargebackHold, approvedLiftedLine } from "@/lib/server/chargeback";
import { NO_EMAIL_KEY, emailsDownBell, emailsDownLine, sendEmail } from "@/lib/server/email";
import { setStripeForTests } from "@/lib/server/stripe";
import { renderTimes } from "@/lib/tz";
import { PAYMENT_RULES, TERMS_VERSION } from "@/lib/termsOfUse";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";
import { pay } from "./b15";

// Batch 24 (owner, Oct 29): "Your bank wants you to confirm" at the top of the developer dashboard (section 1); a request closed by the tester's rating says they finished
// their part (section 2).
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const HOUR = 3_600_000, DAY = 86_400_000;
const later = () => new Promise((r) => setTimeout(r, 30));

// ---------- section 1 ----------

/** A developer with Ana Silva in "Harbor Run" and her written answers sent. */
async function withWork() {
  const { dev, testId } = await setup();
  const { tester, sessionId } = await joined(testId);
  await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
  return { dev, testId, tester, sessionId, sub };
}
type Over = Partial<{ kind: string; status: string; submissionId: string | null; callId: string | null; contractId: string | null; testerId: string; amountCents: number; by: Date; owedUntil: Date }>;
/** A charge made while the developer was away, waiting for their bank (status "needs_confirmation" unless said). */
const waiting = (devId: string, testerId: string, o: Over) =>
  db.payment.create({
    data: {
      kind: o.kind ?? "review", submissionId: o.submissionId ?? null, callId: o.callId ?? null, contractId: o.contractId ?? null, developerId: devId, testerId: o.testerId ?? testerId,
      amountCents: o.amountCents ?? 1250, feeCents: 0, testerCents: 0, status: o.status ?? "needs_confirmation", actionPi: "pi_" + randomUUID(), actionBy: o.by ?? new Date(Date.now() + 2 * DAY), owedUntil: o.owedUntil ?? null,
    },
  });
const pulse = (cookie: string) => pulseGET(req("/api/pulse?bank=1", { cookie, method: "GET" })).then(json);
const markup = (rows: Awaited<ReturnType<typeof bankToConfirm>>) => renderToStaticMarkup(createElement(BankToConfirmBox, { rows }));

describe("batch 24 section 1: Your bank wants you to confirm, at the top of the developer dashboard", () => {
  it("a waiting charge shows with its deadline and its link to the piece's Confirm with your bank on the test page", async () => {
    const x = await withWork();
    const by = new Date(Date.now() + 2 * DAY);
    const p = await waiting(x.dev.user.id, x.tester.user.id, { submissionId: x.sub.id, contractId: x.sessionId, by });
    const rows = await bankToConfirm(x.dev.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: p.id, lead: "$12.50 on “Harbor Run” · Ana Silva's written answers", soon: false, href: bankHref(x.testId, p.id) });
    expect(rows[0].href).toBe(`/app/tests/${x.testId}#bank-${p.id}`);
    expect(rows[0].by).toBe(confirmByText(by, new Date()).text);
    expect(rows[0].by).toMatch(/^confirm by [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)$/);
    const html = markup(rows);
    expect(html).toContain(bankTopHeading(1));
    expect(html).toContain("Your bank wants you to confirm (1)");
    expect(html).toContain(`$12.50 on “Harbor Run” · Ana Silva&#x27;s written answers · <span`);
    expect(html).toContain(`href="/app/tests/${x.testId}#bank-${p.id}"`);
    expect(html).toContain("Confirm with your bank →");
    // A plain scroll box about 3 rows tall, everything in it (no "Show N more").
    expect(html).toContain('data-scroll-list="three"');
    expect(html).not.toMatch(/Show \d+ more/);
  });

  it("soonest deadline first; a call, a dispute decision and an automatic retry of what's owed each say what they are for", async () => {
    const x = await withWork();
    const call = await bookCall(x.testId, x.dev.cookie, x.sessionId, x.tester.cookie, 48);
    const d = x.dev.user.id, t = x.tester.user.id;
    const late = await waiting(d, t, { submissionId: x.sub.id, contractId: x.sessionId, by: new Date(Date.now() + 70 * HOUR) });
    const onCall = await waiting(d, t, { kind: "call", callId: call.id, contractId: x.sessionId, amountCents: 1500, by: new Date(Date.now() + 30 * HOUR) });
    const retry = await waiting(d, t, { status: "failed", submissionId: x.sub.id, contractId: x.sessionId, amountCents: 1000, by: new Date(Date.now() + 50 * HOUR), owedUntil: new Date(Date.now() + DAY) });
    const decision = await waiting(d, t, { kind: "dispute", submissionId: x.sub.id, contractId: x.sessionId, amountCents: 500, by: new Date(Date.now() + 60 * HOUR) });
    const rows = await bankToConfirm(d);
    expect(rows.map((r) => r.id)).toEqual([onCall.id, retry.id, decision.id, late.id]);
    const day = call.startsAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    expect(rows.map((r) => r.lead)).toEqual([
      `$15.00 on “Harbor Run” · Ana Silva's call on ${day}`,
      "$10.00 on “Harbor Run” · what you owe",
      "$5.00 on “Harbor Run” · the team's decision on Ana Silva's dispute",
      "$12.50 on “Harbor Run” · Ana Silva's written answers",
    ]);
    expect(markup(rows)).toContain("Your bank wants you to confirm (4)");
  });

  it("a renewal (no test) links to its row on Payments: “$X for your plan · confirm by <date>”", async () => {
    const { dev } = await setup();
    const p = await waiting(dev.user.id, dev.user.id, { kind: "subscription", amountCents: 900 });
    const [row] = await bankToConfirm(dev.user.id);
    expect(row).toMatchObject({ id: p.id, lead: "$9.00 for your plan", href: `/app/payments#bank-${p.id}` });
    expect(markup([row])).toContain(`$9.00 for your plan · <span`);
    // Payments' row for a renewal is the inline box carrying that anchor (marked by HashJump).
    expect(src("components/BankWaiting.tsx")).toContain("id={bankAnchor(paymentId)}");
    expect(src("app/app/payments/ConfirmList.tsx")).toContain("<BankWaiting paymentId={i.id} line={i.text} />");
  });

  it("under 24 hours left the confirm-by part is red and names the day", async () => {
    const at = (iso: string) => new Date(iso);
    expect(confirmByText(at("2026-11-02T15:10:00Z"), at("2026-10-30T15:00:00Z"), "UTC")).toEqual({ text: "confirm by Nov 2, 3:10 PM", soon: false });
    expect(confirmByText(at("2026-11-02T15:10:00Z"), at("2026-11-02T08:00:00Z"), "UTC")).toEqual({ text: "confirm by today, 3:10 PM", soon: true });
    expect(confirmByText(at("2026-11-02T15:10:00Z"), at("2026-11-01T20:00:00Z"), "UTC")).toEqual({ text: "confirm by tomorrow, 3:10 PM", soon: true });
    expect(confirmByText(at("2026-11-02T15:10:00Z"), at("2026-11-01T15:10:00Z"), "UTC").soon).toBe(false); // exactly 24 hours: not yet
    const x = await withWork();
    await waiting(x.dev.user.id, x.tester.user.id, { submissionId: x.sub.id, contractId: x.sessionId, by: new Date(Date.now() + 2 * HOUR) });
    const rows = await bankToConfirm(x.dev.user.id);
    expect(rows[0].soon).toBe(true);
    expect(rows[0].by).toMatch(/^confirm by (today|tomorrow), \d{1,2}:\d{2} (AM|PM)$/);
    const html = markup(rows);
    expect(html).toContain('class="font-medium text-rose-300" data-confirm-by="soon"');
  });

  it("live: a new charge appears on the dashboard's poll; confirming it elsewhere takes the row out", async () => {
    const x = await withWork();
    const empty = await pulse(x.dev.cookie);
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ v: "", restricted: false });
    const p = await waiting(x.dev.user.id, x.tester.user.id, { submissionId: x.sub.id, contractId: x.sessionId });
    const one = await pulse(x.dev.cookie);
    expect(one.body.v).toContain(p.id);
    // Confirmed on the test page (or another tab): the next poll differs and the row is gone.
    expect((await json(await confirmPOST(req("/api/payments/confirm", { cookie: x.dev.cookie, body: { paymentId: p.id, simulate: "succeeded" } })))).status).toBe(200);
    const after = await pulse(x.dev.cookie);
    expect(after.body.v).not.toBe(one.body.v);
    expect(after.body.v).not.toContain(p.id);
    expect(await bankToConfirm(x.dev.user.id)).toEqual([]);
    // The box polls with its own fingerprint and refreshes the page's data (no full reload).
    const box = src("app/app/BankToConfirm.tsx");
    expect(box).toContain('<AutoRefresh query="bank=1" v={bankTopV(rows)} />');
  });

  it("past its date (counted as declined) or cancelled: the row leaves", async () => {
    const x = await withWork();
    const p = await waiting(x.dev.user.id, x.tester.user.id, { submissionId: x.sub.id, contractId: x.sessionId, by: new Date(Date.now() + HOUR) });
    const before = await pulse(x.dev.cookie);
    expect(before.body.v).toContain(p.id);
    // The deadline passes: gone at the next poll, even before the daily job counts it as declined.
    await db.payment.update({ where: { id: p.id }, data: { actionBy: new Date(Date.now() - 1000) } });
    expect((await pulse(x.dev.cookie)).body.v).not.toContain(p.id);
    await expireActions(new Date(), { submissionId: x.sub.id });
    expect((await db.user.findUniqueOrThrow({ where: { id: x.dev.user.id } })).holdStartedAt).not.toBeNull(); // declined: a payment hold
    expect(await bankToConfirm(x.dev.user.id)).toEqual([]);
    // Cancelled.
    const y = await withWork();
    const q = await waiting(y.dev.user.id, y.tester.user.id, { submissionId: y.sub.id, contractId: y.sessionId });
    expect(await bankToConfirm(y.dev.user.id)).toHaveLength(1);
    await db.payment.update({ where: { id: q.id }, data: { status: "cancelled", actionPi: null, actionBy: null } });
    expect(await bankToConfirm(y.dev.user.id)).toEqual([]);
  });

  it("shown on the restricted dashboard during a hold, above the blue box; hidden when empty", async () => {
    const x = await withWork();
    await startHold(x.dev.user.id, "unpaid");
    const p = await waiting(x.dev.user.id, x.tester.user.id, { status: "failed", submissionId: x.sub.id, contractId: x.sessionId, owedUntil: new Date(Date.now() - DAY) });
    const rows = await bankToConfirm(x.dev.user.id);
    expect(rows.map((r) => r.id)).toEqual([p.id]);
    expect(rows[0].href).toBe(bankHref(x.testId, p.id)); // the test's paused view carries the same button
    expect(src("app/app/tests/[id]/page.tsx")).toContain("{bankRows.map((b) => <BankWaiting key={b.id} paymentId={b.id} line={b.line} seenAt={seenAt} />)}");
    // The poll keeps refreshing during a hold or suspension.
    expect((await pulse(x.dev.cookie)).body).toMatchObject({ restricted: false });
    // The page: the box comes first, before the blue box, for the developer side whatever its state.
    const page = src("app/app/page.tsx");
    const box = page.indexOf('{side === "developer" && u.isDeveloper && <BankToConfirm userId={u.id} now={now} />}');
    expect(box).toBeGreaterThan(0);
    expect(box).toBeLessThan(page.indexOf("<RestrictedBox"));
    expect(page.indexOf('<div className="space-y-8">')).toBeLessThan(box);
    // Nothing to confirm: no box at all.
    expect(markup([])).toBe("");
    const { dev } = await setup();
    expect(await bankToConfirm(dev.user.id)).toEqual([]);
  });

  it("phones: the same box, rows stacked and the link full width", () => {
    const html = markup([{ id: "p1", lead: "$1.00 for your plan", by: "confirm by Nov 2, 3:10 PM", soon: false, href: "/app/payments#bank-p1", at: 0 }]);
    expect(html).toContain("flex flex-col gap-2");
    expect(html).toContain("sm:flex-row");
    expect(html).toContain("btn-secondary w-full");
    expect(html).toContain("sm:w-auto");
  });
});

// ---------- section 2 ----------

describe("batch 24 section 2: a request closed by the tester's rating says they finished their part", () => {
  it("rate with a waiting request: closed with “the tester finished their part”, a closure the tester caused", async () => {
    const { dev, testId } = await setup();
    const w = await joined(testId, "Hal", "he");
    await sact(w.sessionId, "written", w.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: w.sessionId } });
    await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    const startsAt = new Date(Date.now() + 72 * HOUR);
    startsAt.setSeconds(0, 0);
    expect((await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [w.sessionId], startsAt: startsAt.toISOString() })).status).toBe(200);
    const r = await db.callRequest.findFirstOrThrow({ where: { contractId: w.sessionId, status: "pending", fromSide: "developer" } });
    await later();
    const loaded = new Date();
    await later();
    expect((await sact(w.sessionId, "rate", w.tester.cookie, { stars: 5, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await db.callRequest.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "closed", closedReason: "the tester finished their part" });
    expect(FINISHED_PART_REASON).toBe("the tester finished their part");
    expect(CLOSED_BY_TESTER.has(FINISHED_PART_REASON)).toBe(true);
    expect(CLOSED_BY_TESTER.has("the tester left")).toBe(true);
    // A closure caused by the tester: never "no longer available" to them.
    const changes = await testerChanges(w.tester.user.id, w.sessionId, testId, loaded);
    expect(changes.map((c) => c.text).some((t) => /no longer available/.test(t))).toBe(false);
    // The developer's request reads it.
    await settle();
    const withdraw = await act(testId, "answer-request", dev.cookie, { contractId: w.sessionId, requestId: r.id, action: "withdraw", seenAt: seen(), confirmed: true });
    expect(withdraw.status).toBe(409);
    expect(withdraw.body.error.message).toBe("This request closed: the tester finished their part.");
    // Leave and the suspension's removal keep "the tester left".
    expect(src("lib/server/tests.ts")).toContain('closedReason: "the tester left"');
    expect(src("lib/server/restrictions.ts")).toContain('closedReason: "the tester left"');
    expect(src("lib/server/ratings.ts")).toContain("closedReason: FINISHED_PART_REASON");
  });
});

// ---------- batch 23 leftovers ----------

/** A Stripe stand-in with manual capture (the chargeback hold's reservation), as in batch 23. */
function stripeMock() {
  const pis = new Map<string, { status: string; amount: number }>();
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; capture_method?: string }) => {
        const id = "pi_" + randomUUID();
        const status = p.capture_method === "manual" ? "requires_capture" : "succeeded";
        pis.set(id, { status, amount: p.amount });
        return { id, status, client_secret: `${id}_secret`, latest_charge: "ch_" + randomUUID() };
      },
      capture: async (id: string) => { const x = pis.get(id)!; x.status = "succeeded"; return { id, status: "succeeded" }; },
      cancel: async (id: string) => ({ id, status: "canceled" }),
      retrieve: async (id: string) => ({ id, status: pis.get(id)?.status ?? "canceled", client_secret: `${id}_secret` }),
    },
    transfers: { create: async () => ({ id: "tr_" + randomUUID() }) },
    refunds: { create: async () => ({ id: "re_" + randomUUID() }) },
  } as unknown as Stripe);
}
const clearEmails = async () => {
  await db.emailQueue.deleteMany({});
  await db.appState.deleteMany({ where: { key: { in: ["email-incident", "email-cap-until"] } } });
};

describe("batch 23 leftovers (added in batch 24)", () => {
  afterEach(() => setStripeForTests(null));

  it("the red box: the missing key says so instead of quoting Resend", () => {
    expect(emailsDownLine(3, "3:10 PM", NO_EMAIL_KEY, false)).toBe("Emails aren't sending: 3 waiting since 3:10 PM. RESEND_API_KEY isn't set on this deploy.");
    expect(emailsDownLine(2, "3:10 PM", "401: API key is invalid", false)).toBe("Emails aren't sending: 2 waiting since 3:10 PM. Resend says: 401: API key is invalid.");
  });

  it("the admins' bell names the day when the incident started on an earlier day", async () => {
    const since = new Date("2026-10-28T15:10:00Z");
    expect(renderTimes(emailsDownBell(since, new Date("2026-10-28T22:00:00Z"), "UTC"), "UTC")).toBe("Emails aren't sending (since 3:10 PM UTC)");
    expect(renderTimes(emailsDownBell(since, new Date("2026-10-29T09:00:00Z"), "UTC"), "UTC")).toBe("Emails aren't sending (since Wed, Oct 28 at 3:10 PM UTC)");
    // A real incident: an email still waiting from yesterday (no incident open), and a new failure today starts one.
    await clearEmails();
    const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true, timeZone: "UTC" } });
    const now = new Date();
    const yesterday = new Date(now.getTime() - 30 * HOUR);
    await db.emailQueue.create({ data: { to: "old@x.test", subject: "Old", text: "x", html: "", createdAt: yesterday, lastError: NO_EMAIL_KEY, nextTryAt: new Date(now.getTime() + HOUR), giveUpAt: new Date(now.getTime() + DAY) } });
    const env = process.env as Record<string, string | undefined>;
    const prev = { node: env.NODE_ENV, outbox: env.ALLOW_DEV_OUTBOX };
    env.NODE_ENV = "production"; // no dev outbox: without a key (tests) the email is queued and fails
    env.ALLOW_DEV_OUTBOX = "";
    try {
      await sendEmail({ to: "new@x.test", subject: "New", text: "x" }, now);
    } finally {
      env.NODE_ENV = prev.node;
      env.ALLOW_DEV_OUTBOX = prev.outbox;
    }
    const bells = await db.notification.findMany({ where: { userId: a.user.id, text: { startsWith: "Emails aren't sending (since " } } });
    expect(bells).toHaveLength(1);
    const day = yesterday.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    expect(bells[0].text).toContain(`(since ${day} at `);
    await clearEmails();
  });

  it("Approve that lifts the hold: one developer notice; the testers still hear their test is running again", async () => {
    stripeMock();
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    await db.user.update({ where: { id: tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 12), payoutsReady: true } });
    const row = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    await startHold(dev.user.id, "chargeback");
    await db.user.update({ where: { id: dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
    const r = await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: { seenTotalCents: 800, seenIds: [row.id] } })).then(json);
    expect(r.body.reservedCents).toBe(800);
    await settle();
    const before = new Date();
    expect((await approveChargebackHold(dev.user.id)).lifted).toBe(true);
    const mine = await db.notification.findMany({ where: { userId: dev.user.id, createdAt: { gte: before }, NOT: { text: { startsWith: "Receipt:" } } } });
    expect(mine.map((n) => n.text)).toEqual([approvedLiftedLine(800)]);
    expect(approvedLiftedLine(800)).toBe("The team approved lifting your hold: the $8.00 reserved on your card was taken, and your tests are running again.");
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "“Harbor Run” is running again" } })).toBe(1);
  });

  it("the Terms' chargeback sentence: Pay what you owe reserves; taken on approval, released otherwise (same version)", () => {
    const text = PAYMENT_RULES.map((r) => r.text).join(" ");
    expect(text).toContain("presses Pay what you owe, which reserves the amount on their card: it's taken when our team approves lifting the hold, and released if they don't approve or after about 7 days.");
    expect(text).not.toContain("pays what they owe, and our team approves");
    expect(TERMS_VERSION).toBe(2);
    expect(src("components/OwedBox.tsx")).toContain("During a chargeback hold the box reserves rather than pays");
  });
});
