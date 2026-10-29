import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { GET as healthGET } from "@/app/api/health/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { POST as confirmPOST } from "@/app/api/payments/confirm/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import {
  EMAIL_CAP_LINE, EMAIL_DEGRADED_KEYWORD, emailHealth, emailsDownLine, nextUtcDay, retryEmails, sendEmail, setEmailTransportForTests, shortError,
} from "@/lib/server/email";
import { startHold } from "@/lib/server/holds";
import { approveChargebackHold, chargebackSteps, declineChargebackReserve, expireReservations, notApprovedLine } from "@/lib/server/chargeback";
import { ALREADY_CONFIRMED, CONFIRM_EXPIRED } from "@/lib/server/confirm";
import { fakeExpire, getStripe, setStripeForTests } from "@/lib/server/stripe";
import { adminPage, type ChargebackVM } from "@/lib/server/adminLists";
import { RESERVE_EXPIRED, reserveShortLine, reservedLine, splitFee } from "@/lib/rules";
import { mergeElsewhere, replaceLine } from "@/lib/editMerge";
import { GroupNote, TheirsNote } from "@/components/FieldNote";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 23 (owner, Oct 29): emails never get lost and the owner hears when sending fails (sections 1 to 3), Edit keeps what you typed (section 5), a chargeback hold's
// Pay what you owe reserves and Approve takes it (section 6), Suspend's Preview above the boxes (section 7), "Confirm with your bank" stops once like Pay (section 9).
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

// ---------- sections 1 to 3: emails ----------

type Sent = { id: string; to: string };
/** A stand-in for Resend: answers with `answer()` per try and records every post (tests never reach Resend). */
function resend(answer: (row: Sent, n: number) => { ok: true } | { ok: false; status: number; body: string }, delayMs = 0) {
  const posts: Sent[] = [];
  setEmailTransportForTests(async (row) => {
    posts.push(row);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return answer(row, posts.filter((p) => p.id === row.id).length);
  });
  return posts;
}
const clean = async () => {
  await db.emailQueue.deleteMany({});
  await db.appState.deleteMany({ where: { key: { in: ["email-incident", "email-cap-until"] } } });
};

describe("batch 23 sections 1 to 3: failed emails wait and retry; the owner is told", () => {
  beforeEach(async () => {
    await clean();
    vi.stubEnv("RESEND_API_KEY", "re_test_only");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    setEmailTransportForTests(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await clean();
  });

  it("Resend failing then recovering: stored first, waits 5 minutes, then sent once (Idempotency-Key = the row id)", async () => {
    const t0 = new Date();
    const posts = resend((_r, n) => (n === 1 ? { ok: false, status: 503, body: JSON.stringify({ message: "Service unavailable." }) } : { ok: true }));
    const r = await sendEmail({ to: "ana@x.test", subject: "Hi", text: "x" }, t0);
    expect(r.via).toBe("queued");
    const row = await db.emailQueue.findUniqueOrThrow({ where: { id: r.via === "queued" ? r.id : "" } });
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastError: "503: Service unavailable" });
    expect(row.nextTryAt.getTime()).toBe(t0.getTime() + 5 * MIN);
    expect(await retryEmails(new Date(t0.getTime() + 4 * MIN))).toBe(0); // not due yet
    expect(await retryEmails(new Date(t0.getTime() + 5 * MIN))).toBe(1);
    expect(await db.emailQueue.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "sent", attempts: 2, lastError: "" });
    expect(await retryEmails(new Date(t0.getTime() + 60 * MIN))).toBe(0); // never twice
    expect(posts.filter((p) => p.id === row.id)).toHaveLength(2); // the failure and the one that went
    expect(src("lib/server/email.ts")).toContain('"Idempotency-Key": `email-${row.id}`');
    // The incident ended with it.
    expect(await db.appState.findUnique({ where: { key: "email-incident" } })).toBeNull();
  });

  it("the waits: 5, 15, 30 minutes, then hourly; 48 hours of failures → failed for good (kept, never deleted)", async () => {
    const t0 = new Date();
    const posts = resend(() => ({ ok: false, status: 500, body: "Internal error" }));
    await sendEmail({ to: "ana@x.test", subject: "Hi", text: "x" }, t0);
    const waits: number[] = [];
    let at = t0;
    for (let i = 0; i < 80; i++) {
      const row = await db.emailQueue.findFirstOrThrow({});
      if (row.status !== "pending") break;
      waits.push((row.nextTryAt.getTime() - at.getTime()) / MIN);
      at = row.nextTryAt;
      await retryEmails(at);
    }
    expect(waits.slice(0, 5)).toEqual([5, 15, 30, 60, 60]);
    const row = await db.emailQueue.findFirstOrThrow({});
    expect(row.status).toBe("failed");
    expect(row.failedAt!.getTime() - t0.getTime()).toBe(48 * HOUR); // the last try is at the 48 hours
    expect(posts.length).toBe(row.attempts);
    // Kept: the admin's list shows it until cleared, and clearing keeps the row.
    const h = await emailHealth();
    expect(h).toMatchObject({ waiting: 0, failedCount: 1 });
    expect(h.failed[0]).toMatchObject({ to: "ana@x.test", subject: "Hi", lastError: "500: Internal error" });
    const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    expect((await json(await adminPOST(req("/api/admin/emails-clear", { cookie: a.cookie, body: { id: "all" } }), { params: Promise.resolve({ action: "emails-clear" }) }))).status).toBe(200);
    expect((await emailHealth()).failedCount).toBe(0);
    expect(await db.emailQueue.count({ where: { id: row.id } })).toBe(1);
  });

  it("Resend's daily limit (429 / quota) waits until the next day's first sweep without burning tries; the red box says so plainly", async () => {
    const t0 = new Date();
    let capped = true;
    const posts = resend(() => (capped ? { ok: false, status: 429, body: JSON.stringify({ name: "daily_quota_exceeded", message: "You have reached your daily email sending quota." }) } : { ok: true }));
    const first = await sendEmail({ to: "ana@x.test", subject: "One", text: "x" }, t0);
    // A second email meanwhile isn't even tried: it waits with the first.
    const second = await sendEmail({ to: "ben@x.test", subject: "Two", text: "x" }, new Date(t0.getTime() + MIN));
    expect([first.via, second.via]).toEqual(["queued", "queued"]);
    expect(posts).toHaveLength(1);
    const tomorrow = nextUtcDay(t0);
    for (const r of await db.emailQueue.findMany({})) expect(r).toMatchObject({ attempts: 0, errorKind: "cap", lastError: EMAIL_CAP_LINE, nextTryAt: tomorrow });
    expect(await retryEmails(new Date(t0.getTime() + HOUR))).toBe(0);
    expect(posts).toHaveLength(1);
    const h = await emailHealth();
    expect(h).toMatchObject({ waiting: 2, cap: true });
    expect(emailsDownLine(h.waiting, "3:10 PM", h.error, h.cap)).toBe("Emails aren't sending: 2 waiting since 3:10 PM. Resend's daily limit was reached (free plan: 100 a day). Emails will go out tomorrow, or upgrade the plan.");
    capped = false;
    expect(await retryEmails(tomorrow)).toBe(2);
    expect(await db.emailQueue.count({ where: { status: "sent" } })).toBe(2);
    // A plain rate limit (429 without a quota) is retried as usual.
    expect(shortError(429, JSON.stringify({ name: "rate_limit_exceeded", message: "Too many requests." }))).toBe("429: Too many requests");
  });

  it("the red box and the admins' bell (once per incident, in-app)", async () => {
    const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    const t0 = new Date();
    resend(() => ({ ok: false, status: 401, body: JSON.stringify({ message: "API key is invalid" }) }));
    await sendEmail({ to: "ana@x.test", subject: "One", text: "x" }, t0);
    await sendEmail({ to: "ben@x.test", subject: "Two", text: "x" }, t0);
    const bells = await db.notification.findMany({ where: { userId: a.user.id, text: { startsWith: "Emails aren't sending (since " } } });
    expect(bells).toHaveLength(1);
    expect(bells[0].link).toBe("/admin#emails");
    const h = await emailHealth();
    expect(h).toMatchObject({ waiting: 2, error: "401: API key is invalid", cap: false });
    expect(emailsDownLine(h.waiting, "3:10 PM", h.error, h.cap)).toBe("Emails aren't sending: 2 waiting since 3:10 PM. Resend says: 401: API key is invalid.");
    const page = src("app/admin/page.tsx");
    expect(page).toContain('id="emails" data-emails-box=""');
    expect(page).toContain("failed for good (tried for 48 hours, kept):");
    // Everything sent: the box goes and the incident ends; a new failure is a new incident (a new bell).
    resend(() => ({ ok: true }));
    expect(await retryEmails(new Date(t0.getTime() + 5 * MIN))).toBe(2);
    expect(await emailHealth()).toMatchObject({ waiting: 0, failedCount: 0 });
    resend(() => ({ ok: false, status: 503, body: "down" }));
    await sendEmail({ to: "cam@x.test", subject: "Three", text: "x" }, new Date(t0.getTime() + 10 * MIN));
    expect(await db.notification.count({ where: { userId: a.user.id, text: { startsWith: "Emails aren't sending (since " } } })).toBe(2);
  });

  it("/api/health (with HEALTH_KEY) says \"degraded: emails\" once emails have been failing for 15 minutes (still HTTP 200)", async () => {
    vi.stubEnv("HEALTH_KEY", "test-health-key-23");
    vi.stubEnv("RESEND_API_KEY", ""); // the sweep the ping runs sends nothing here
    const ping = (key = "test-health-key-23") => healthGET(new Request(`http://localhost:3400/api/health?key=${key}`));
    const waiting = (ago: number) => db.emailQueue.create({ data: { to: "ana@x.test", subject: "Hi", text: "x", lastError: "503: down", attempts: 2, giveUpAt: new Date(Date.now() + DAY), nextTryAt: new Date(Date.now() + HOUR), createdAt: new Date(Date.now() - ago) } });
    let r = await ping();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, emails: "sending" });
    const row = await waiting(10 * MIN);
    expect(await (await ping()).json()).toEqual({ ok: true, emails: "sending" }); // 10 minutes: not yet
    await db.emailQueue.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 16 * MIN) } });
    r = await ping();
    expect(r.status).toBe(200);
    expect(await r.text()).toContain(EMAIL_DEGRADED_KEYWORD);
    // Without the key: no word about emails.
    expect(await (await ping("wrong")).json()).toEqual({ ok: true });
    // HANDOVER and AT-HOME say how to watch it.
    expect(fs.readFileSync(path.resolve(__dirname, "../docs/HANDOVER.md"), "utf8")).toContain("degraded: emails");
    expect(fs.readFileSync(path.resolve(__dirname, "../docs/media/proof/AT-HOME.md"), "utf8")).toContain("degraded: emails");
  });

  it("no duplicate sends on overlapping sweeps (each try claims its email first)", async () => {
    const t0 = new Date();
    resend(() => ({ ok: false, status: 503, body: "down" }));
    for (let i = 0; i < 5; i++) await sendEmail({ to: `p${i}@x.test`, subject: "Hi", text: "x" }, t0);
    const posts = resend(() => ({ ok: true }), 30);
    const at = new Date(t0.getTime() + 5 * MIN);
    const [a, b] = await Promise.all([retryEmails(at), retryEmails(at)]);
    expect(a + b).toBe(5);
    expect(posts).toHaveLength(5);
    expect(new Set(posts.map((p) => p.id)).size).toBe(5);
  });

  it("development without a key: the dev outbox, as before", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const to = `out-${randomUUID()}@x.test`;
    expect((await sendEmail({ to, subject: "Hi", text: "x" })).via).toBe("outbox");
    expect(await db.outboxEmail.count({ where: { to } })).toBe(1);
    expect(await db.emailQueue.count({ where: { to } })).toBe(0);
  });
});

// ---------- section 6: a chargeback hold's Pay what you owe reserves; Approve takes it ----------

function stripeMock() {
  const pis = new Map<string, { status: string; amount: number; capture?: string }>();
  const captured: { id: string; amount?: number }[] = [], cancelled: string[] = [], transfers: { amount: number; destination: string }[] = [];
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; capture_method?: string; payment_method?: string }) => {
        const id = "pi_" + randomUUID();
        const status = p.payment_method === "pm_action" ? "requires_action" : p.capture_method === "manual" ? "requires_capture" : "succeeded";
        pis.set(id, { status, amount: p.amount, capture: p.capture_method });
        return { id, status, client_secret: `${id}_secret` };
      },
      capture: async (id: string, p: { amount_to_capture?: number }) => {
        const x = pis.get(id);
        if (x?.status !== "requires_capture") throw Object.assign(new Error("This PaymentIntent could not be captured."), { type: "StripeInvalidRequestError" });
        x.status = "succeeded";
        captured.push({ id, amount: p.amount_to_capture });
        return { id, status: "succeeded" };
      },
      cancel: async (id: string) => { cancelled.push(id); const x = pis.get(id); if (x) x.status = "canceled"; return { id, status: "canceled" }; },
      retrieve: async (id: string) => ({ id, status: pis.get(id)?.status ?? "canceled", client_secret: `${id}_secret` }),
    },
    transfers: { create: async (t: { amount: number; destination: string }) => { transfers.push(t); return { id: "tr_" + randomUUID() }; } },
    refunds: { create: async () => ({ id: "re_" + randomUUID() }) },
  } as unknown as Stripe);
  return { pis, captured, cancelled, transfers };
}

async function chargebackHeld(pm = "pm_x") {
  const { dev, testId } = await setup();
  const { tester, sessionId } = await joined(testId);
  await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: pm } });
  await db.user.update({ where: { id: tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID().slice(0, 12), payoutsReady: true } });
  const row = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
  await startHold(dev.user.id, "chargeback");
  await db.user.update({ where: { id: dev.user.id }, data: { chargebackCardVerifiedAt: new Date() } });
  const press = (seenTotalCents: number, seenIds: string[]) => owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: { seenTotalCents, seenIds } })).then(json);
  return { dev, tester, testId, sessionId, row, press };
}
const userOf = (id: string) => db.user.findUniqueOrThrow({ where: { id } });

describe("batch 23 section 6: a chargeback hold's Pay what you owe reserves the money; the team's Approve takes it", () => {
  afterEach(() => setStripeForTests(null));

  it("reserve then approve: an uncaptured authorization; Approve captures it once, pays the tester and lifts the hold", async () => {
    const st = stripeMock();
    const x = await chargebackHeld();
    const r = await x.press(800, [x.row.id]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ paid: 0, reservedCents: 800, lifted: false });
    const [pi] = [...st.pis.entries()].filter(([, v]) => v.capture === "manual");
    expect(pi[1]).toMatchObject({ status: "requires_capture", amount: 800 }); // Stripe shows it "Uncaptured"
    expect(await db.payment.findUniqueOrThrow({ where: { id: x.row.id } })).toMatchObject({ status: "failed", settledAt: null }); // nothing taken
    expect(await chargebackSteps(x.dev.user.id)).toMatchObject({ owedPaid: true, reservedCents: 800, uncoveredCents: 0 });
    expect(reservedLine(800)).toBe("Reserved $8.00: it's taken when the team approves lifting your hold.");
    expect((await userOf(x.dev.user.id)).holdStartedAt).not.toBeNull();
    // Two Approves at once: captured once.
    const both = await Promise.allSettled([approveChargebackHold(x.dev.user.id), approveChargebackHold(x.dev.user.id)]);
    expect(both.filter((b) => b.status === "fulfilled")).toHaveLength(1);
    expect(st.captured).toEqual([{ id: pi[0], amount: 800 }]);
    expect(await db.payment.findUniqueOrThrow({ where: { id: x.row.id } })).toMatchObject({ status: "charged", stripePaymentIntentId: pi[0], transferStatus: "sent" });
    expect(st.transfers).toEqual([expect.objectContaining({ amount: splitFee(800).testerCents })]);
    expect((await userOf(x.dev.user.id)).holdStartedAt).toBeNull();
    // (Batch 24) One notice for the developer when Approve lifts the hold.
    expect(await db.notification.count({ where: { userId: x.dev.user.id, text: "The team approved lifting your hold: the $8.00 reserved on your card was taken, and your tests are running again." } })).toBe(1);
    expect(await db.notification.count({ where: { userId: x.tester.user.id, text: { contains: "paid $8.00 for your written answers" } } })).toBe(1);
  });

  it("reserve then expire: released after about 7 days; Payments asks to press again; the admin's row shows Reservation expired", async () => {
    const st = stripeMock();
    const x = await chargebackHeld();
    expect((await x.press(800, [x.row.id])).body.reservedCents).toBe(800);
    const res = await db.reservation.findFirstOrThrow({ where: { developerId: x.dev.user.id } });
    await expireReservations(new Date(Date.now() + 6 * DAY));
    expect((await db.reservation.findUniqueOrThrow({ where: { id: res.id } })).status).toBe("reserved");
    await expireReservations(new Date(Date.now() + 7 * DAY + MIN));
    expect((await db.reservation.findUniqueOrThrow({ where: { id: res.id } })).status).toBe("expired");
    expect(st.cancelled).toContain(res.stripePaymentIntentId);
    expect(RESERVE_EXPIRED).toBe("Your reservation expired: press Pay what you owe again so the team can approve it.");
    expect(await db.notification.count({ where: { userId: x.dev.user.id, text: RESERVE_EXPIRED } })).toBe(1);
    expect(await chargebackSteps(x.dev.user.id)).toMatchObject({ owedPaid: false, reservedCents: 0, expired: true });
    const rows = (await adminPage("chargebacks", x.dev.user.id, null)).rows as ChargebackVM[];
    expect(rows.find((c) => c.id === x.dev.user.id)).toMatchObject({ expired: true, owedPaid: false });
    expect(src("app/admin/PagedList.tsx")).toContain("Reservation expired");
    await expect(approveChargebackHold(x.dev.user.id)).rejects.toMatchObject({ message: reserveShortLine(800, 0) });
    // Pressed again: a new reservation; the line goes.
    expect((await x.press(800, [x.row.id])).body.reservedCents).toBe(800);
    expect(await chargebackSteps(x.dev.user.id)).toMatchObject({ owedPaid: true, expired: false });
  });

  it("a Charge after reserving needs its own Pay what you owe for the difference; Approve is refused while short; then both are captured", async () => {
    const st = stripeMock();
    const x = await chargebackHeld();
    expect((await x.press(800, [x.row.id])).body.reservedCents).toBe(800);
    // The tester's Charge meanwhile (added to what is owed during the hold).
    const charge = await db.payment.create({ data: { kind: "review", contractId: x.sessionId, developerId: x.dev.user.id, testerId: x.tester.user.id, amountCents: 500, feeCents: 0, testerCents: 0, status: "owed" } });
    expect(await chargebackSteps(x.dev.user.id)).toMatchObject({ owedPaid: false, owedCents: 1300, reservedCents: 800, uncoveredCents: 500 });
    await expect(approveChargebackHold(x.dev.user.id)).rejects.toMatchObject({ message: "Not yet: $13.00 is owed but $8.00 is reserved." });
    // A press from a page that still showed the old total stops once; the second press reserves only the difference.
    const stop = await x.press(800, [x.row.id]);
    expect(stop.body.error).toMatchObject({ code: "stop_once", totalCents: 500 });
    expect((await x.press(500, [charge.id])).body.reservedCents).toBe(500);
    expect(await chargebackSteps(x.dev.user.id)).toMatchObject({ owedPaid: true, reservedCents: 1300 });
    expect((await approveChargebackHold(x.dev.user.id)).takenCents).toBe(1300);
    expect(st.captured.map((c) => c.amount).sort()).toEqual([500, 800]);
    expect(await db.payment.count({ where: { id: { in: [x.row.id, charge.id] }, status: "charged" } })).toBe(2);
  });

  it("not approved: the team's Don't approve cancels the reservation (nothing taken) and the hold stays", async () => {
    const st = stripeMock();
    const x = await chargebackHeld();
    expect((await x.press(800, [x.row.id])).body.reservedCents).toBe(800);
    expect(await declineChargebackReserve(x.dev.user.id, "Please call us first.")).toMatchObject({ releasedCents: 800 });
    expect(st.captured).toEqual([]);
    expect(st.cancelled).toHaveLength(1);
    expect((await userOf(x.dev.user.id)).holdStartedAt).not.toBeNull();
    expect(await db.notification.count({ where: { userId: x.dev.user.id, text: notApprovedLine(800) } })).toBe(1);
    expect(await chargebackSteps(x.dev.user.id)).toMatchObject({ owedPaid: false, reservedCents: 0 });
  });

  it("the bank's check inline: the reservation waits for it, then is reserved", async () => {
    const st = stripeMock();
    const x = await chargebackHeld("pm_action");
    const r = await x.press(800, [x.row.id]);
    expect(r.body.confirm).toHaveLength(1);
    const res = await db.reservation.findFirstOrThrow({ where: { developerId: x.dev.user.id } });
    expect(r.body.confirm[0]).toMatchObject({ requiresAction: true, paymentId: res.id });
    expect(res.status).toBe("needs_action");
    st.pis.get(res.stripePaymentIntentId!)!.status = "requires_capture"; // the bank said yes
    const done = await json(await confirmPOST(req("/api/payments/confirm", { cookie: x.dev.cookie, body: { paymentId: res.id } })));
    expect(done.body).toMatchObject({ done: true, reservedCents: 800 });
    expect((await db.reservation.findUniqueOrThrow({ where: { id: res.id } })).status).toBe("reserved");
  });

  it("the fake Stripe authorizes, captures, cancels and lets an authorization lapse", async () => {
    vi.stubEnv("STRIPE_FAKE", "1");
    try {
      const s = getStripe();
      const a = await s.paymentIntents.create({ amount: 900, currency: "usd", capture_method: "manual", confirm: true });
      expect(a.status).toBe("requires_capture");
      expect((await s.paymentIntents.capture(a.id, { amount_to_capture: 900 })).status).toBe("succeeded");
      await expect(s.paymentIntents.capture(a.id)).rejects.toThrow();
      const b = await s.paymentIntents.create({ amount: 900, currency: "usd", capture_method: "manual", confirm: true });
      fakeExpire(b.id);
      await expect(s.paymentIntents.capture(b.id)).rejects.toThrow();
      const c = await s.paymentIntents.create({ amount: 900, currency: "usd", capture_method: "manual", confirm: true });
      expect((await s.paymentIntents.cancel(c.id)).status).toBe("canceled");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// ---------- section 9: "Confirm with your bank" stops once like Pay ----------

async function awayCharge() {
  const { dev, testId } = await setup();
  const { tester, sessionId } = await joined(testId);
  await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
  const p = await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_confirmation", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 3 * DAY) } });
  await settle();
  const start = (body: Record<string, unknown>) => confirmPOST(req("/api/payments/confirm", { cookie: dev.cookie, body: { paymentId: p.id, start: true, tab: "tab-A", ...body } })).then(json);
  return { dev, testId, sessionId, tester, p, start };
}

describe("batch 23 section 9: Confirm with your bank runs the stop-once check first", () => {
  it("a tester joining since the page loaded stops it once; the second press opens the bank's check", async () => {
    const x = await awayCharge();
    const pageLoaded = seen();
    await settle();
    await joined(x.testId, "Ben Okafor", "he");
    const r = await x.start({ seenAt: pageLoaded });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("stop_once");
    expect(r.body.error.changes.map((c: { text: string }) => c.text)).toContain("Ben Okafor joined");
    const again = await x.start({ seenAt: pageLoaded, confirmed: true, boxAt: new Date().toISOString() });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ paymentId: x.p.id, simulated: true });
  });

  it("the test stopped since the page loaded: stopped once, then the check opens", async () => {
    const x = await awayCharge();
    const pageLoaded = seen();
    await settle();
    expect((await act(x.testId, "stop", x.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true, tab: "tab-B" })).status).toBe(200);
    const r = await x.start({ seenAt: pageLoaded });
    expect(r.body.error?.code).toBe("stop_once");
    await settle();
    expect((await x.start({ seenAt: pageLoaded, confirmed: true, boxAt: new Date().toISOString() })).status).toBe(200);
  });

  it("nothing new: the first press opens the check; already confirmed in another tab or expired: plain refusals", async () => {
    const x = await awayCharge();
    const pageLoaded = seen();
    expect((await x.start({ seenAt: pageLoaded })).status).toBe(200);
    // Another tab confirmed it.
    expect((await json(await confirmPOST(req("/api/payments/confirm", { cookie: x.dev.cookie, body: { paymentId: x.p.id, simulate: "succeeded" } })))).status).toBe(200);
    const r = await x.start({ seenAt: pageLoaded });
    expect(r.body.error).toMatchObject({ code: "confirmed", message: ALREADY_CONFIRMED });
    expect(ALREADY_CONFIRMED).toBe("You already confirmed this payment.");
    // Expired.
    const y = await awayCharge();
    await db.payment.update({ where: { id: y.p.id }, data: { actionBy: new Date(Date.now() - 1000) } });
    expect((await y.start({ seenAt: seen() })).body.error).toMatchObject({ code: "expired", message: CONFIRM_EXPIRED });
    expect(CONFIRM_EXPIRED).toBe("This confirmation expired: nothing was charged.");
    // The page's button sends its seen marker and shows the box under it.
    const b = src("components/BankWaiting.tsx");
    expect(b).toContain('press<Omit<BankAction, "requiresAction">>("/api/payments/confirm", { paymentId, start: true }, "bank")');
    expect(b).toContain("<ChangesBox changes={changes} error={error} press={CONFIRM_WITH_BANK} />");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("<BankWaiting key={b.id} paymentId={b.id} line={b.line} seenAt={seenAt} />");
  });
});

// ---------- section 5: Edit keeps what you typed ----------

const dollars = (c: number | null) => (c == null ? null : (c / 100).toFixed(2));
async function formOf(testId: string) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  return {
    productName: t.productName, title: t.title, description: t.description, buildUrl: t.buildUrl, categories: t.categories, devices: t.devices, languages: t.languages,
    mature: t.mature, matureWhy: t.mature ? t.matureWhy : "", ndaText: t.ndaText, spots: String(t.spots), deadlineDays: String(t.deadlineDays),
    writtenCents: dollars(t.writtenCents), recordingCents: dollars(t.recordingCents), liveRateCents: dollars(t.liveRateCents), liveMinutes: null,
    writtenRequired: t.writtenCents != null && t.writtenRequired, recordingRequired: t.recordingCents != null && t.recordingRequired, liveRequired: t.liveRateCents != null && t.liveRequired,
    questions: t.questions as string[], openUntil: t.openUntil ? t.openUntil.toISOString().slice(0, 10) : "", joinMode: t.joinMode,
  };
}

describe("batch 23 section 5: Edit keeps what you typed; it shows what the other tab saved", () => {
  type Form = Record<string, unknown>;
  const f0: Form = { title: "Harbor Run", description: "Sail", spots: "3", openUntil: "2026-11-20" };

  it("an untouched field takes the saved value silently; a typed one keeps your text (the note); the same value is not news; spots and Open until take theirs", () => {
    const now = { ...f0, title: "Harbor Run 2", description: "Sail fast", spots: "5", openUntil: "2026-11-25" };
    // Untouched everywhere: everything is taken, no note (spots and Open until with today's note).
    expect(mergeElsewhere(f0, f0, now)).toEqual({ take: ["title", "description", "spots", "openUntil"], keep: [], oldNote: ["spots", "openUntil"], settled: [] });
    // Typed: the description keeps its text; the title typed to the same value is settled; spots typed still takes theirs.
    const typed = { ...f0, title: "Harbor Run 2", description: "Only the first reef", spots: "4" };
    expect(mergeElsewhere(typed, f0, now)).toEqual({ take: ["spots", "openUntil"], keep: ["description"], oldNote: ["spots", "openUntil"], settled: ["title"] });
  });

  it("the note: \"Saved in another tab or device at 3:54 PM:\" and their value (short inline, long folded) with Use theirs; key notes say who changed them", () => {
    const short = renderToStaticMarkup(createElement(TheirsNote, { heading: "Saved in another tab or device at 3:54 PM", items: [{ field: "spots", name: "Spots", value: "5", onUse: () => {} }] }));
    expect(short).toContain("Saved in another tab or device at 3:54 PM: Spots: 5");
    expect(short).toContain('data-use-theirs="spots"');
    expect(short).toContain(">Use theirs</button>");
    const long = "Sail to the reef and back. ".repeat(40);
    const html = renderToStaticMarkup(createElement(TheirsNote, { heading: "Saved in another tab or device at 3:54 PM", items: [{ field: "description", name: "Instructions", value: long, onUse: () => {} }] }));
    expect(html).toContain("Saved in another tab or device at 3:54 PM:</span>");
    expect(html).toContain("<b>Instructions:</b>");
    expect(html).toContain('data-fold-text="closed"');
    expect(html).toContain(">Show more</button>");
    const both = renderToStaticMarkup(createElement(GroupNote, { groups: [{ heading: "Changed in another tab or device at 3:50 PM", lines: ["Added: K8"] }, { heading: "Updated at 3:54 PM", lines: ["Ben Okafor joined and was given K-2, which you had deleted here."] }] }));
    expect(both).toContain("Changed in another tab or device at 3:50 PM:</p>");
    expect(both).toContain("Updated at 3:54 PM:</p>");
    expect(both.indexOf("Added: K8")).toBeLessThan(both.indexOf("Updated at 3:54 PM"));
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("const m = mergeElsewhere(f, base, now);");
    expect(form).toContain("onUse: () => takeTheirs(x)");
    // Matching text removes the note (it shows only while your text differs from theirs).
    expect(form).toContain("!takesTheirs(String(x)) && !same(f[x], base[x])");
    expect(form).toContain("const matched = (Object.keys(p) as (keyof F)[]).filter((k) => theirs[k] && same(p[k], base[k]));");
    // Keys: joins under "Updated at", your own changes under "Changed in another tab or device at".
    expect(form).toContain("heading: `${UPDATED_AT} ${clock(keysNote.others.at)}`");
    expect(form).toContain("heading: `${CHANGED_ELSEWHERE} ${clock(keysNote.own.at)}`");
  });

  it("Save: \"Instructions: your version will replace the one saved in another tab at 3:54 PM.\"; the second press saves yours on top; untouched fields never stop", async () => {
    const { dev, testId } = await setup({ accessKeys: "K1\nK2\nK3", spots: 3 });
    const t0 = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const loaded = { version: t0.version, seenAt: new Date().toISOString(), base: await formOf(testId), keysLoaded: ["K1", "K2", "K3"] };
    await settle();
    expect((await act(testId, "edit", dev.cookie, { version: t0.version, fields: { description: "Sail fast.", title: "Harbor Run 2" }, seenAt: new Date().toISOString(), confirmed: true, tab: "tab-B" })).status).toBe(200);
    const saveA = (fields: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      act(testId, "edit", dev.cookie, { version: loaded.version, fields, seenAt: loaded.seenAt, tab: "tab-A", base: loaded.base, has: { ...loaded.base, ...fields }, keysLoaded: loaded.keysLoaded, keysAdd: [], keysRemove: [], ...extra });
    const r = await saveA({ description: "Only the first reef." });
    expect(r.status).toBe(409);
    const lines = r.body.error.changes as { text: string; kind?: string; fields?: string[] }[];
    // (The rename in the other tab is its own line, as before.) One line for the typed field.
    expect(lines.filter((l) => l.kind === "yours")).toEqual([expect.objectContaining({ text: "Instructions: your version will replace the one saved in another tab", fields: ["description"] })]);
    expect(lines.some((l) => /title|Name of this test/.test(l.text) && l.kind === "yours")).toBe(false); // untouched here: no stop for it
    expect(replaceLine("description")).toBe("Instructions: your version will replace the one saved in another tab");
    expect(src("components/ChangesBox.tsx")).toContain('c.kind === "yours" ? `${c.text} at ${time(c.at)}.`');
    const second = await saveA({ description: "Only the first reef." }, { confirmed: true, boxAt: r.body.error.now ?? new Date().toISOString(), base: await formOf(testId) });
    expect(second.status).toBe(200);
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect(t.description).toBe("Only the first reef."); // yours on top
    expect(t.title).toBe("Harbor Run 2"); // the untouched field kept the other tab's save
  });
});

// ---------- section 7: Suspend's Preview above the boxes ----------

describe("batch 23 section 7: Suspend's Preview laid out above the boxes", () => {
  it("top to bottom: Preview and its effects (full width), then the side choice and reason box, then Suspend; the same on Accounts and a profile", () => {
    const a = src("app/admin/AccountActions.tsx");
    const block = a.slice(a.indexOf('data-suspend-block=""'));
    expect(block.indexOf("<PreviewButton")).toBeLessThan(block.indexOf('action="suspend"'));
    expect(block).toContain("danger stacked");
    const p = src("app/admin/PreviewButton.tsx");
    expect(p).toContain('className="w-full space-y-1" data-preview-block=""');
    expect(p).toContain('<ul className="note w-full list-disc');
    const b = src("app/admin/AdminButton.tsx");
    expect(b).toContain('stacked ? "flex w-full flex-col items-start gap-2"');
    // The "Since your Preview" race check stays.
    expect(a).toContain("since: previewAt ?? acct.at");
    // (Batch 22) No held shares in the Preview's tester line.
    expect(src("lib/server/restrictions.ts")).not.toContain("share is held");
  });
});
