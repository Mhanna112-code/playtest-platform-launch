import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import { adminPage, testRow, type TextVM, type TestVM } from "@/lib/server/adminLists";
import { chargebackOpened, retryOwed, startHold } from "@/lib/server/holds";
import { refreshPayoutStatus, setStripeForTests } from "@/lib/server/stripe";
import { PAYMENT_RULES } from "@/lib/termsOfUse";
import { json, makeUser, req } from "./helpers";
import { joined, sact, seen, setup } from "./fixtures";
import { pay } from "./b15";

// Batch 22 (owner, Oct 29): chargeback holds never retry on their own, suspended testers are paid normally, waiting payouts go out when payout setup is done, the admin
// test timeline speaks about people, and Lift the pause on a test that isn't paused any more.
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
afterEach(() => setStripeForTests(null));

async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const withCard = (userId: string) => db.user.update({ where: { id: userId }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });

/** A Stripe stand-in recording charges and transfers. */
function fakeStripe(opts: { decline?: boolean; account?: { payouts_enabled: boolean; capabilities: { transfers: string } } } = {}) {
  const charges: { amount: number; transfer_data?: { destination: string } }[] = [];
  const transfers: { amount: number; destination: string; metadata: { paymentId: string } }[] = [];
  setStripeForTests({
    paymentIntents: {
      create: async (p: { amount: number; transfer_data?: { destination: string } }) => {
        if (opts.decline) throw Object.assign(new Error("Your card was declined."), { type: "StripeCardError" });
        charges.push(p);
        return { id: "pi_" + randomUUID(), status: "succeeded" };
      },
      retrieve: async (id: string) => ({ id, status: "succeeded" }),
      cancel: async (id: string) => ({ id, status: "canceled" }),
    },
    transfers: { create: async (t: { amount: number; destination: string; metadata: { paymentId: string } }) => { transfers.push(t); return { id: "tr_" + randomUUID() }; } },
    accounts: { retrieve: async (id: string) => ({ id, ...(opts.account ?? { payouts_enabled: true, capabilities: { transfers: "active" } }) }) },
    webhooks: { constructEvent: (raw: string) => JSON.parse(raw) },
  } as unknown as Stripe);
  return { charges, transfers };
}
const webhook = (event: Record<string, unknown>) =>
  webhookPOST(new Request("http://localhost:3400/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "t" }, body: JSON.stringify(event) }));

/** Written answers sent on a test ($10 listed). */
async function sentWork(name = "Ana Silva") {
  const s = await setup();
  const j = await joined(s.testId, name);
  const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
  await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}
async function owedOn(s: Awaited<ReturnType<typeof sentWork>>, reason: string) {
  await withCard(s.dev.user.id);
  await db.payment.create({ data: { kind: "review", contractId: s.sessionId, developerId: s.dev.user.id, testerId: s.tester.user.id, amountCents: 800, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
  await startHold(s.dev.user.id, reason);
}

describe("batch 22 section 1: no automatic retries during a chargeback hold", () => {
  it("a chargeback hold with a saved card: the daily job and saving a card never charge; Payments shows no next try", async () => {
    const s = await sentWork();
    await owedOn(s, "chargeback");
    const f = fakeStripe();
    expect(await retryOwed(s.dev.user.id)).toBeNull();
    expect(await retryOwed(s.dev.user.id, new Date(), "card")).toBeNull();
    expect(f.charges).toEqual([]);
    // The daily job never picks a chargeback hold for its retries.
    expect(src("lib/server/holds.ts")).toContain("holdStartedAt: { not: null }, holdReason: { not: \"chargeback\" }, deletedAt: null, stripePaymentMethodId: { not: null } }");
    expect((await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } })).holdRetries).toBe(0);
    expect(src("app/app/payments/page.tsx")).toContain("retryLine={cbSteps ? \"\" : retryStatusLine(u, fmtDateTime)}");
  });

  it("a payment hold still retries; one that turns into a chargeback hold stops retrying from then on", async () => {
    const s = await sentWork();
    await owedOn(s, "unpaid");
    let f = fakeStripe({ decline: true });
    expect(await retryOwed(s.dev.user.id)).toMatchObject({ cents: 0 }); // tried (and declined)
    expect((await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } })).holdRetries).toBe(1);
    // An earlier payment is reversed by the bank: the payment hold becomes a chargeback hold.
    const pi = "pi_" + randomUUID();
    await db.payment.create({ data: { kind: "review", contractId: s.sessionId, developerId: s.dev.user.id, testerId: s.tester.user.id, amountCents: 500, feeCents: 100, testerCents: 400, status: "charged", stripePaymentIntentId: pi, transferStatus: "sent" } });
    await chargebackOpened(pi);
    expect((await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } })).holdReason).toBe("chargeback");
    f = fakeStripe();
    await db.user.update({ where: { id: s.dev.user.id }, data: { holdRetryAt: new Date(Date.now() - 2 * 86_400_000) } });
    expect(await retryOwed(s.dev.user.id)).toBeNull();
    expect(await retryOwed(s.dev.user.id, new Date(), "card")).toBeNull();
    expect(f.charges).toEqual([]);
  });
});

describe("batch 22 section 2: a suspended tester is paid normally", () => {
  it("their sent work paid while suspended: the share goes to their Stripe account; nothing says it waits", async () => {
    const s = await sentWork();
    await db.user.update({ where: { id: s.tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID(), payoutsReady: true } });
    const a = await admin();
    expect((await aact(a.cookie, "suspend", { id: s.tester.user.id, note: "Checking", side: "tester" })).status).toBe(200);
    await withCard(s.dev.user.id);
    const f = fakeStripe();
    const r = await pay(s.dev.cookie, { kind: "submission", id: s.sub.id, amount: "10.00", tickedCents: 1000, confirmed: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.later).toBeUndefined();
    expect(f.charges[0].transfer_data?.destination).toMatch(/^acct_/);
    expect((await db.payment.findFirstOrThrow({ where: { submissionId: s.sub.id, kind: "review" } })).transferStatus).toBe("sent");
  });

  it("no held shares anywhere: no admin box, no Release / Refund routes, no Terms line", async () => {
    expect(src("app/admin/page.tsx")).not.toContain("Held tester shares");
    const route = src("app/api/admin/[action]/route.ts");
    expect(route).not.toContain("release-share");
    expect(route).not.toContain("refund-share");
    for (const f of ["lib/server/stripe.ts", "lib/server/recovery.ts", "lib/server/payments.ts", "lib/server/restrictions.ts", "app/app/payments/page.tsx"]) expect(src(f), f).not.toMatch(/transferStatus: "held"|[?] "held" :|=== "held"|releaseHeldShares|refundPayment/);
    const a = await admin();
    expect((await aact(a.cookie, "release-share", { id: "x" })).status).toBe(404);
    expect(PAYMENT_RULES.map((p) => p.text).join(" ")).not.toMatch(/held|suspended tester/i);
  });
});

describe("batch 22 section 3: waiting payouts go out when payout setup is done", () => {
  it("paid before setup: waiting; setup completes (the webhook): sent once, the tester told; a second webhook sends nothing more", async () => {
    const s = await sentWork();
    await withCard(s.dev.user.id);
    const f = fakeStripe();
    expect((await pay(s.dev.cookie, { kind: "submission", id: s.sub.id, amount: "10.00", tickedCents: 1000, confirmed: true })).status).toBe(200);
    const p = await db.payment.findFirstOrThrow({ where: { submissionId: s.sub.id, kind: "review" } });
    expect(p.transferStatus).toBe("waiting");
    const acct = "acct_" + randomUUID();
    await db.user.update({ where: { id: s.tester.user.id }, data: { stripeAccountId: acct } });
    const ready = { type: "account.updated", account: acct, data: { object: { id: acct, payouts_enabled: true, capabilities: { transfers: "active" } } } };
    expect((await webhook(ready)).status).toBe(200);
    expect(f.transfers).toEqual([{ amount: p.testerCents, currency: "usd", destination: acct, metadata: { paymentId: p.id } }]);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).transferStatus).toBe("sent");
    const line = "Your payout setup is done: $8.00 on its way.";
    expect(await db.notification.count({ where: { userId: s.tester.user.id, text: line } })).toBe(1);
    expect((await webhook(ready)).status).toBe(200);
    expect(await refreshPayoutStatus(s.tester.user.id)).toBe(true);
    expect(f.transfers).toHaveLength(1);
    expect(await db.notification.count({ where: { userId: s.tester.user.id, text: line } })).toBe(1);
  });

  it("the return from Stripe's setup (refreshPayoutStatus) sends them too; the admin list is read-only", async () => {
    const s = await sentWork();
    await withCard(s.dev.user.id);
    const f = fakeStripe();
    await pay(s.dev.cookie, { kind: "submission", id: s.sub.id, amount: "10.00", tickedCents: 1000, confirmed: true });
    await db.user.update({ where: { id: s.tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID() } });
    expect(await refreshPayoutStatus(s.tester.user.id)).toBe(true);
    expect(f.transfers).toHaveLength(1);
    const page = src("app/admin/page.tsx");
    expect(page).not.toContain('label="Send now"');
    expect(page).toContain("waiting since {fmtDateTime(p.createdAt)}");
    expect(src("app/api/admin/[action]/route.ts")).not.toContain('case "transfer"');
  });
});

describe("batch 22 section 4: the admin's test timeline speaks about people", () => {
  it("pay, pause and resume in the third person, naming who; one line per dispute (the reason in italics) and per decision (the admin)", async () => {
    const a = await admin();
    const s = await sentWork();
    expect((await pay(s.dev.cookie, { kind: "submission", id: s.sub.id, amount: "5.00", tickedCents: 500, reason: "Half of it" })).status).toBe(200);
    expect((await sact(s.sessionId, "dispute", s.tester.cookie, { kind: "submission", id: s.sub.id, reason: "I answered every question in full.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: s.sub.id } });
    expect((await aact(a.cookie, "decide", { id: d.id, total: "", note: "" })).status).toBe(200);
    expect((await aact(a.cookie, "suspend", { id: s.dev.user.id, note: "Checking", side: "developer" })).status).toBe(200);
    expect((await aact(a.cookie, "unsuspend", { id: s.dev.user.id, side: "developer" })).status).toBe(200);
    const page = await adminPage("t-timeline", a.user.id, null, s.testId);
    const rows = page.rows as TextVM[];
    const texts = rows.map((r) => r.text.replace(/^[^·]+ · /, ""));
    expect(texts).toContain("Nora Lane paid Ana Silva $5.00 for the written answers");
    expect(texts).toContain(`Nora Lane's developer account was paused (by ${a.user.email})`);
    expect(texts).toContain("Nora Lane's tests are running again");
    expect(texts.filter((t) => /disputed/.test(t))).toEqual(["Ana Silva disputed the pay for their written answers:"]);
    expect(rows.find((r) => /disputed/.test(r.text))?.em).toBe("I answered every question in full.");
    expect(texts.filter((t) => /decided/.test(t))).toEqual([`${a.user.email} decided Ana Silva's dispute: kept the pay at $5.00`]);
    expect(texts.some((t) => /^You |^Your /.test(t))).toBe(false);
    expect(src("app/admin/PagedList.tsx")).toContain("{t.em && <i className=\"text-slate-200\"> “{t.em}”</i>}");
  });

  it("the three lists are the scroll boxes of batch 17 §7", () => {
    const boxes = src("app/admin/AdminBoxes.tsx");
    for (const k of ["t-timeline", "t-contracts", "t-payments"]) expect(boxes).toContain(`"${k}"`);
    expect(boxes).toContain("<PagedList kind={kind} arg={arg} initial={page} empty={empty} title={title} level={3} />");
  });
});

describe("batch 22 section 5: Lift the pause on a test that isn't paused any more", () => {
  it("two admins at once: one lifts it; the other is refused naming who and when; the row turns back into Pause", async () => {
    const a = await admin(), b = await admin();
    const s = await setup();
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking" })).status).toBe(200);
    const [r1, r2] = await Promise.all([aact(a.cookie, "unpause-test", { id: s.testId }), aact(b.cookie, "unpause-test", { id: s.testId })]);
    const ok = [r1, r2].filter((r) => r.status === 200);
    const refused = [r1, r2].find((r) => r.status !== 200)!;
    expect(ok).toHaveLength(1);
    const winner = r1.status === 200 ? a : b;
    expect(refused.body.error.message).toMatch(new RegExp(`^That test's pause was already lifted \\(by ${winner.user.email.replace(/[.]/g, "\\.")} at .+\\)\\.$`));
    expect(await db.adminAction.count({ where: { targetId: s.testId, action: "unpause-test" } })).toBe(1);
    expect((await testRow(await db.test.findUniqueOrThrow({ where: { id: s.testId }, include: { developer: true, _count: { select: { contracts: true } } } }))).adminPaused).toBe(false);
    // A stale row pressed later: the same refusal.
    expect((await aact(b.cookie, "unpause-test", { id: s.testId })).body.error.message).toMatch(/^That test's pause was already lifted \(by .+ at .+\)\.$/);
    expect(src("app/admin/PagedList.tsx")).toContain("refreshRows");
  });

  it("a test paused only by a developer hold shows no Lift button, and a press is refused saying why; a closed one says when it closed", async () => {
    const a = await admin();
    const s = await sentWork();
    await owedOn(s, "unpaid");
    const row = (await testRow(await db.test.findUniqueOrThrow({ where: { id: s.testId }, include: { developer: true, _count: { select: { contracts: true } } } }))) as TestVM;
    expect(row.adminPaused).toBe(false); // Pause shows, never Lift
    expect((await aact(a.cookie, "unpause-test", { id: s.testId })).body.error.message).toBe("That test isn't paused by the team: it's paused by the developer's account state.");
    const t = await setup();
    expect((await aact(a.cookie, "pause-test", { id: t.testId, note: "Checking" })).status).toBe(200);
    const closedAt = new Date();
    await db.test.update({ where: { id: t.testId }, data: { status: "stopped", stoppedAt: closedAt, pauseClosedAt: closedAt } });
    expect((await aact(a.cookie, "unpause-test", { id: t.testId })).body.error.message).toMatch(/^That test's pause was already lifted when it closed at .+\.$/);
  });
});
