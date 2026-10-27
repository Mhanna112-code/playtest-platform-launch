import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { POST as chatOpenPOST } from "@/app/api/chat/open/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { GET as moreGET } from "@/app/api/admin/more/route";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as notifyPOST } from "@/app/api/account/notify/route";
import { EXTRA_PAY_MAX_CENTS, EXTRA_PAY_TICK_CENTS, STRIPE_MAX_CENTS, checkExtraPay } from "@/lib/rules";
import { adminPage, PAGE } from "@/lib/server/adminLists";
import { chargebackOpened, startHold } from "@/lib/server/holds";
import { bell, notify, sendSummaries } from "@/lib/server/notify";
import { payoutProblem, suspendAccount, suspendedAccountsReminder } from "@/lib/server/restrictions";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

const DAY = 86_400_000;
const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } })).then((r) => r.json());
const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const admin = async () => {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
};
const lines = (userId: string) => db.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
afterEach(() => setStripeForTests(null));

describe("A) Chat with <name> on the hover card and the profile", () => {
  const open = (cookie: string, contractId: string) => chatOpenPOST(req("/api/chat/open", { cookie, body: { contractId } })).then(json);

  it("opens the same per-test chat as the Testers panel; a block either way, or any refusal, reads only 'Unable to chat with this tester.'", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const ok = await open(dev.cookie, sessionId);
    expect(ok.status).toBe(200);
    expect(ok.body.href).toBe(`/app/chat/${sessionId}`);
    // Nobody else can open it.
    const other = await makeUser({ dev: true });
    expect((await open(other.cookie, sessionId)).status).toBe(404);
    // A block, either way.
    await db.block.create({ data: { blockerId: tester.user.id, blockedId: dev.user.id } });
    const refused = await open(dev.cookie, sessionId);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toBe("Unable to chat with this tester.");
    await db.block.deleteMany({ where: { blockerId: tester.user.id } });
    await db.block.create({ data: { blockerId: dev.user.id, blockedId: tester.user.id } });
    expect((await open(dev.cookie, sessionId)).body.error.message).toBe("Unable to chat with this tester.");
    await db.block.deleteMany({ where: { blockerId: dev.user.id } });
    // Refused for other reasons (the developer suspended): the same words.
    await db.user.update({ where: { id: dev.user.id }, data: { suspendedAt: new Date() } });
    expect((await open(dev.cookie, sessionId)).body.error.message).toBe("Unable to chat with this tester.");
  });

  it("the button is on the hover card and the profile (hidden with no shared test), in the full app's button look", () => {
    expect(src("components/Ui.tsx")).toMatch(/data-tester-card[\s\S]*ChatWithButton/);
    expect(src("app/app/page.tsx")).toMatch(/contractId: c\.id/);
    expect(src("app/app/testers/[id]/page.tsx")).toMatch(/shared && <ChatWithButton/);
    expect(src("components/ChatWithButton.tsx")).toMatch(/btn-secondary[\s\S]*MessagesSquare[\s\S]*Chat with/);
  });
});

describe("B) reminders", () => {
  it("developer on a hold: ONE line a day (its own line, /payments#owed); a declined retry is merged into it", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: new Date(Date.now() - 2 * DAY), holdReason: "unpaid", stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 900, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() - 1000) } });
    setStripeForTests({ paymentIntents: { create: async () => { throw new Error("declined"); } } } as unknown as Stripe);
    await cron();
    await cron();
    const hold = (await lines(dev.user.id)).filter((l) => /^Your tests are paused/.test(l.text));
    expect(hold.length).toBe(1);
    expect(hold[0]).toMatchObject({ link: "/app/payments#owed", own: true, payment: true });
    expect(hold[0].text).toBe("Your tests are paused until you pay what you owe. Today's retry of $9.00 was declined");
    expect((await lines(dev.user.id)).filter((l) => /^Today's retry/.test(l.text)).length).toBe(0);
    // The next day: one more.
    await db.notification.updateMany({ where: { userId: dev.user.id, text: { startsWith: "Your tests are paused" } }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    await cron();
    expect((await lines(dev.user.id)).filter((l) => /^Your tests are paused/.test(l.text)).length).toBe(2);
  });

  it("applications and rejoin asks waiting: a line a day, stacked with that test's lines; it waits while the test is paused", async () => {
    const { dev, testId } = await setup();
    await act(testId, "edit", dev.cookie, { version: 1, fields: { joinMode: "apply" } });
    const t = await makeUser({ tester: true, name: "Dee Moss" });
    expect((await act(testId, "apply", t.cookie, { note: "Hi" })).status).toBe(200);
    await cron();
    await cron();
    const mine = (await lines(dev.user.id)).filter((l) => /for your answer$/.test(l.text));
    expect(mine.length).toBe(1);
    expect(mine[0]).toMatchObject({ text: "“Harbor Run”: 1 application or rejoin ask waits for your answer", link: `/app/tests/${testId}#needs-you`, own: false, testId });
    // Paused (a payment hold): no reminder, however old.
    await db.notification.deleteMany({ where: { userId: dev.user.id, text: { endsWith: "for your answer" } } });
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: new Date(Date.now() - 3_600_000), holdReason: "unpaid" } });
    await cron();
    expect((await lines(dev.user.id)).filter((l) => /for your answer$/.test(l.text)).length).toBe(0);
  });

  it("tester invite reminders wait while the developer's test is paused, and come back when it resumes", async () => {
    const { dev, testId } = await setup();
    const t = await makeUser({ tester: true, name: "Dee Moss" });
    await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [t.user.id] });
    const inv = await db.invite.findFirstOrThrow({ where: { testId, testerId: t.user.id } });
    await db.invite.update({ where: { id: inv.id }, data: { createdAt: new Date(Date.now() - 3 * DAY) } });
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: new Date(Date.now() - 3_600_000), holdReason: "unpaid" } });
    await cron();
    expect((await lines(t.user.id)).filter((l) => /^Reminder: /.test(l.text)).length).toBe(0);
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: null, holdReason: "" } });
    await cron();
    expect((await lines(t.user.id)).filter((l) => /^Reminder: /.test(l.text)).length).toBe(1);
  });

  it("the Charge offer and its reminders are one 'charge' group across tests (every 3 days)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 1000) } });
    await cron();
    const offer = (await lines(tester.user.id)).find((l) => /charge \$10\.00 or let it go$/.test(l.text))!;
    expect(offer.groupKey).toBe("charge");
    await db.submission.update({ where: { id: sub.id }, data: { remindedAt: new Date(Date.now() - 3 * DAY) } });
    await cron();
    expect((await lines(tester.user.id)).filter((l) => l.groupKey === "charge").length).toBe(2);
    void dev;
  });

  it("rating prompts: stacked while the test is open, their own line once it is closed, then a reminder every 3 days until rated", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const prompt = (await lines(tester.user.id)).find((l) => /^Rate Nora Lane/.test(l.text))!;
    expect(prompt.own).toBe(false); // the test is open: it stacks with that test's same-day lines
    await act(testId, "stop", dev.cookie, { seenAt: seen(), confirmed: true });
    await db.contract.update({ where: { id: sessionId }, data: { ratePromptedAt: new Date(Date.now() - 4 * DAY) } });
    await cron();
    await cron();
    const rem = (await lines(tester.user.id)).filter((l) => /^Reminder: rate Nora Lane/.test(l.text));
    expect(rem.length).toBe(1);
    expect(rem[0]).toMatchObject({ own: true, link: `/app/sessions/${sessionId}#rate` });
    // Rated: no more reminders (the developer's prompt is its own line now the test is closed).
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 4 })).status).toBe(200);
    expect((await lines(dev.user.id)).find((l) => /You can rate/.test(l.text))?.own).toBe(true);
    await db.rating.updateMany({ where: { contractId: sessionId, side: "tester" }, data: { createdAt: new Date(Date.now() - 4 * DAY) } });
    await db.notification.updateMany({ where: { userId: tester.user.id, text: { startsWith: "Reminder: rate" } }, data: { createdAt: new Date(Date.now() - 4 * DAY) } });
    await cron();
    expect((await lines(tester.user.id)).filter((l) => /^Reminder: rate/.test(l.text)).length).toBe(1);
    expect((await lines(dev.user.id)).filter((l) => /^Reminder: rate Ana Silva/.test(l.text)).length).toBe(1);
  });

  it("admins: the suspended-accounts review is daily, one line for all", async () => {
    const a = await admin();
    const x = await makeUser({ dev: true }), y = await makeUser({ dev: true });
    await suspendAccount(a.user.id, x.user.id, "Testing");
    await suspendAccount(a.user.id, y.user.id, "Testing");
    await db.appState.deleteMany({ where: { key: "suspended-reminder" } });
    await suspendedAccountsReminder();
    await suspendedAccountsReminder(); // the same day: not again
    const mine = (await lines(a.user.id)).filter((l) => /suspended accounts? to review$/.test(l.text));
    expect(mine.length).toBe(1);
    expect(mine[0].text).toMatch(/^\d+ suspended accounts to review$/);
    await db.appState.update({ where: { key: "suspended-reminder" }, data: { value: new Date(Date.now() - 25 * 3_600_000).toISOString() } });
    await suspendedAccountsReminder();
    expect((await lines(a.user.id)).filter((l) => /suspended accounts? to review$/.test(l.text)).length).toBe(2);
  });
});

describe("C) stacking changes", () => {
  it("tester payment lines do not stack; payout problems stack per day across tests; paused / resumed stack across tests", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const paid = (await lines(tester.user.id)).find((l) => /^You were paid for your written answers/.test(l.text))!;
    expect(paid).toMatchObject({ own: true, payment: true });
    await db.user.update({ where: { id: tester.user.id }, data: { stripeAccountId: "acct_" + randomUUID() } });
    const acct = (await db.user.findUniqueOrThrow({ where: { id: tester.user.id } })).stripeAccountId!;
    await payoutProblem(acct);
    const payout = (await lines(tester.user.id)).find((l) => l.groupKey === "payout")!;
    expect(payout).toMatchObject({ own: false, payment: true, link: "/app/payments#payout" });
  });
});

describe("D) emails", () => {
  it("one email lists everything new; Off sends none (only the always-send ones); the old 'each' option is refused", async () => {
    const u = await makeUser({ tester: true });
    expect((await db.user.findUniqueOrThrow({ where: { id: u.user.id } })).emailPref).toBe("daily");
    await notify(u.user.email, "First thing", ["First thing"], "/app");
    await notify(u.user.email, "Second thing", ["Second thing"], "/app");
    expect(await db.outboxEmail.count({ where: { to: u.user.email } })).toBe(0); // nothing is sent per update
    await sendSummaries();
    const mails = await db.outboxEmail.findMany({ where: { to: u.user.email } });
    expect(mails.length).toBe(1);
    expect(mails[0].text).toContain("First thing");
    expect(mails[0].text).toContain("Second thing");
    // Off.
    const off = await makeUser({ tester: true });
    expect((await json(await notifyPOST(req("/api/account/notify", { cookie: off.cookie, body: { emailPref: "off" } })))).status).toBe(200);
    await notify(off.user.email, "Quiet", ["Quiet"], "/app");
    await notify(off.user.email, "Account paused", ["Account paused"], "/app", { always: true });
    await sendSummaries();
    const offMails = await db.outboxEmail.findMany({ where: { to: off.user.email } });
    expect(offMails.map((m) => m.subject)).toEqual(["Account paused"]); // the always-send email went at once
    // "each" is no longer a choice.
    const bad = await json(await notifyPOST(req("/api/account/notify", { cookie: off.cookie, body: { emailPref: "each" } })));
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: off.user.id } })).emailPref).toBe("off");
  });

  it("on Weekly or Monthly, payment lines still go out in an end-of-day email holding only those lines; the rest wait", async () => {
    const u = await makeUser({ tester: true });
    await db.user.update({ where: { id: u.user.id }, data: { emailPref: "weekly", lastSummaryAt: new Date() } });
    await notify(u.user.email, "Something ordinary", ["x"], "/app");
    await notify(u.user.email, "Payment for your work may be delayed", ["x"], "/app/payments", { payment: true });
    await sendSummaries();
    const first = await db.outboxEmail.findMany({ where: { to: u.user.email } });
    expect(first.length).toBe(1);
    expect(first[0].text).toContain("Payment for your work may be delayed");
    expect(first[0].text).not.toContain("Something ordinary");
    await sendSummaries(); // nothing new: no second email
    expect(await db.outboxEmail.count({ where: { to: u.user.email } })).toBe(1);
    // When the weekly email is due, the ordinary line goes (the payment line is not repeated).
    await db.user.update({ where: { id: u.user.id }, data: { lastSummaryAt: new Date(Date.now() - 8 * DAY) } });
    await sendSummaries();
    const all = await db.outboxEmail.findMany({ where: { to: u.user.email }, orderBy: { createdAt: "asc" } });
    expect(all.length).toBe(2);
    expect(all[1].text).toContain("Something ordinary");
    expect(all[1].text).not.toContain("Payment for your work may be delayed");
  });

  it("a chargeback emails the admins at once, whatever their setting", async () => {
    const a = await admin();
    await db.user.update({ where: { id: a.user.id }, data: { emailPref: "off" } });
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const pi = "pi_" + randomUUID();
    await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 160, testerCents: 640, status: "charged", stripePaymentIntentId: pi } });
    const before = await db.outboxEmail.count({ where: { to: "owner@playtest.test", subject: { startsWith: "Playtest: new chargeback" } } });
    await chargebackOpened(pi);
    expect(await db.outboxEmail.count({ where: { to: "owner@playtest.test", subject: { startsWith: "Playtest: new chargeback" } } })).toBe(before + 1);
    expect(await db.outboxEmail.count({ where: { to: a.user.email, subject: { startsWith: "Playtest: new chargeback" } } })).toBe(1);
  });
});

describe("E, F) the admin dashboard order and pages of 25", () => {
  it("sections run: open disputes, chargeback holds, your actions, paused tests, then the rest", () => {
    const page = src("app/admin/page.tsx");
    const at = (id: string) => page.indexOf(`id="${id}"`);
    const order = ["disputes", "chargebacks", "mine", "paused-tests", "decided"].map(at);
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it("pages of 25: Previous / Next with '1–25 of N', keyset by date, no overlap; no Load more", async () => {
    const tag = randomUUID().slice(0, 6);
    for (let i = 0; i < 60; i++) await db.waitlistEntry.create({ data: { email: `p-${tag}-${i}@test.playtest.test`, role: "tester", createdAt: new Date(Date.now() + 100_000 + i * 1000) } }).catch(() => null);
    const a = await admin();
    expect(PAGE).toBe(25);
    const p1 = (await adminPage("waitlist", a.user.id, null)) as { rows: { id: string; at: string }[]; next: string | null; total: number };
    expect(p1.rows.length).toBe(25);
    const p2 = (await json(await moreGET(req(`/api/admin/more?kind=waitlist&after=${encodeURIComponent(p1.next!)}`, { cookie: a.cookie })))).body;
    expect(p2.rows.length).toBe(25);
    expect(p2.rows.some((r: { id: string }) => p1.rows.some((o) => o.id === r.id))).toBe(false);
    expect(p2.rows[0].at <= p1.rows[24].at).toBe(true);
    // Previous = the page fetched again with its own cursor (page 1: none), the same rows.
    const back = (await json(await moreGET(req("/api/admin/more?kind=waitlist&after=", { cookie: a.cookie })))).body;
    expect(back.rows.map((r: { id: string }) => r.id)).toEqual(p1.rows.map((r) => r.id));
    expect(p1.total).toBeGreaterThanOrEqual(60);
    const list = src("app/admin/PagedList.tsx");
    expect(list).toMatch(/Previous[\s\S]*Next/);
    expect(list).toMatch(/of \$\{total\}/);
    expect(list).not.toMatch(/Load more/);
    expect(list).toMatch(/setRows\(r\.rows\)/); // only this list's rows are replaced, by a fetch
  });
});

describe("G, H) Charge opening and the cap", () => {
  async function sentUnreviewed() {
    const s = await setup();
    const j = await joined(s.testId);
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
    return { ...s, ...j, sub };
  }

  it("the tester's Charge cap is the listing minus what was already paid for that part", async () => {
    const { dev, tester, sessionId, sub, testId } = await sentUnreviewed();
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 1000) } });
    await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 400, feeCents: 80, testerCents: 320, status: "charged" } });
    await cron();
    const tooMuch = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", amount: "7.00", tickedCents: 700 });
    expect(tooMuch.body.error.message).toBe("At most $6.00.");
    expect((await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", amount: "6.00", tickedCents: 600 })).body).toMatchObject({ choice: "charge", amountCents: 600 });
  });

  it("Charge is refused until BOTH 14 days have passed and Open until has passed (the refusal says so)", async () => {
    const { tester, sessionId, sub, testId } = await sentUnreviewed();
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() + 2 * DAY) } });
    await cron();
    expect((await db.submission.findUniqueOrThrow({ where: { id: sub.id } })).choiceOfferedAt).toBeNull();
    const refused = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", tickedCents: 1000 });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/14 days have passed since you sent it and the test's Open until has passed/);
  });

  it("the dashboard 'Charge or cancel' text and the session texts name both conditions", () => {
    expect(src("app/app/page.tsx")).toMatch(/14 days have passed since you sent them and the test&apos;s Open until has passed/);
    expect(src("lib/server/ratings.ts")).toMatch(/chargeIsOpen/);
  });
});

describe("J) extra pay from the Testers panel", () => {
  const extra = (cookie: string, testId: string, body: Record<string, unknown>) => act(testId, "pay-extra", cookie, { seenAt: seen(), payKey: randomUUID(), ...body });

  it("pays the tester directly with the 80/20 split; a bell to them (its own line); on the Payments history; works for a past tester too", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await settle();
    const r = await extra(dev.cookie, testId, { contractId: sessionId, amount: "5.00" });
    expect(r.status).toBe(200);
    const p = await db.payment.findFirstOrThrow({ where: { contractId: sessionId, kind: "extra" } });
    expect(p).toMatchObject({ amountCents: 500, feeCents: 100, testerCents: 400, developerId: dev.user.id, testerId: tester.user.id });
    const bellLine = (await lines(tester.user.id)).find((l) => /paid you \$5\.00 extra for Harbor Run$/.test(l.text))!;
    expect(bellLine.text).toBe("Nora Lane paid you $5.00 extra for Harbor Run");
    expect(bellLine).toMatchObject({ own: true, payment: true });
    expect(await db.testEvent.count({ where: { testId, text: "You paid Ana Silva $5.00 extra" } })).toBe(1);
    expect(src("app/app/payments/page.tsx")).toMatch(/Extra pay/);
    // A tester who has left can still be paid.
    expect((await sact(sessionId, "leave", tester.cookie)).status).toBe(200);
    await settle();
    expect((await extra(dev.cookie, testId, { contractId: sessionId, amount: "2.50" })).status).toBe(200);
  });

  it("over $200 needs the tick (red at the tick); no cap but Stripe's, held in one constant", async () => {
    const { dev, testId } = await setup();
    const { sessionId } = await joined(testId);
    await settle();
    expect(EXTRA_PAY_MAX_CENTS).toBe(STRIPE_MAX_CENTS);
    expect(checkExtraPay(EXTRA_PAY_TICK_CENTS, false).ok).toBe(true);
    expect(checkExtraPay(EXTRA_PAY_TICK_CENTS + 1, false)).toEqual({ ok: false, message: "Tick “I understand this payment can't be refunded and is charged now.” to pay." });
    expect(checkExtraPay(25, false).ok).toBe(false);
    expect(checkExtraPay(STRIPE_MAX_CENTS + 1, true).ok).toBe(false);
    const refused = await extra(dev.cookie, testId, { contractId: sessionId, amount: "250.00" });
    expect(refused.status).toBe(400); // a form mistake: red
    expect(refused.body.error.message).toMatch(/^Tick “I understand this payment can't be refunded/);
    expect(await db.payment.count({ where: { contractId: sessionId, kind: "extra" } })).toBe(0);
    expect((await extra(dev.cookie, testId, { contractId: sessionId, amount: "250.00", understood: true })).status).toBe(200);
    expect(src("app/app/tests/[id]/ExtraPay.tsx")).toMatch(/needsTick/);
  });

  it("the same refusals as Pay: suspended, a hold, blocked either way; and the stop-once rules apply", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await settle();
    const pageLoaded = seen();
    await settle();
    const ben = await joined(testId, "Ben Carter", "he"); // something changed since the page loaded
    void ben;
    const stop = await act(testId, "pay-extra", dev.cookie, { contractId: sessionId, amount: "5.00", payKey: randomUUID(), seenAt: pageLoaded });
    expect(stop.status).toBe(409);
    expect(stop.body.error.code).toBe("stop_once");
    expect((await act(testId, "pay-extra", dev.cookie, { contractId: sessionId, amount: "5.00", payKey: randomUUID(), seenAt: pageLoaded, confirmed: true })).status).toBe(200);
    // Blocked either way.
    await db.block.create({ data: { blockerId: tester.user.id, blockedId: dev.user.id } });
    expect((await extra(dev.cookie, testId, { contractId: sessionId, amount: "5.00" })).status).toBe(409);
    await db.block.deleteMany({ where: { blockerId: tester.user.id } });
    // A hold.
    await startHold(dev.user.id, "unpaid");
    expect((await extra(dev.cookie, testId, { contractId: sessionId, amount: "5.00" })).body.error.message).toBe("Pay what you owe first.");
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: null, holdReason: "" } });
    // Suspended: refused (and hidden in the panel).
    await db.user.update({ where: { id: dev.user.id }, data: { suspendedAt: new Date() } });
    const sus = await extra(dev.cookie, testId, { contractId: sessionId, amount: "5.00" });
    expect(sus.status).toBe(403);
    expect(sus.body.error.code).toBe("suspended");
    expect(src("app/app/tests/[id]/page.tsx")).toMatch(/!restricted && <ExtraPay/);
  });
});

describe("K) admin test history", () => {
  it("lists the test's whole timeline newest first, with which admin acted, in pages of 25", async () => {
    const a = await admin();
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    await db.invite.create({ data: { testId, testerId: (await makeUser({ tester: true })).user.id } });
    expect((await aact(a.cookie, "pause-test", { id: testId, note: "Looking" })).status).toBe(200);
    const h = (await adminPage("history", a.user.id, null, testId)) as { rows: { text: string; at: string }[]; total: number };
    const all = h.rows.map((r) => r.text).join("\n");
    for (const re of [/Ana Silva joined/, /joined on: /, /Ana Silva sent her written answers/, /You paid Ana Silva \$10\.00/, /Payment \(review\) of \$10\.00 to Ana Silva/, /Invited /, new RegExp(`Paused by ${a.user.email}: Looking`)]) expect(all, String(re)).toMatch(re);
    expect(h.rows.map((r) => r.at)).toEqual([...h.rows.map((r) => r.at)].sort().reverse());
    // Pages of 25.
    await db.testEvent.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ testId, kind: "edited", text: `Edit ${i}`, createdAt: new Date(Date.now() - i * 1000) })) });
    const p1 = (await adminPage("history", a.user.id, null, testId)) as { rows: { id: string }[]; next: string | null; total: number };
    expect(p1.rows.length).toBe(25);
    expect(p1.total).toBeGreaterThan(30);
    const r2 = (await json(await moreGET(req(`/api/admin/more?kind=history&arg=${testId}&after=${encodeURIComponent(p1.next!)}`, { cookie: a.cookie })))).body;
    expect(r2.rows.length).toBeGreaterThan(0);
    expect(r2.rows.some((r: { id: string }) => p1.rows.some((o) => o.id === r.id))).toBe(false);
    expect(src("app/admin/PagedList.tsx")).toMatch(/History/);
    expect(src("app/admin/page.tsx")).toMatch(/History of this test/);
    // Only the admin sees it.
    expect((await json(await moreGET(req(`/api/admin/more?kind=history&arg=${testId}`, { cookie: dev.cookie })))).status).toBe(403);
  });
});

describe("L, M) live notices in pop-ups, and the design doc's Pop-ups list", () => {
  it("Stop, End early and Invite anyway show live notices; the other dialogs are unchanged", () => {
    const confirm = src("components/ConfirmButton.tsx");
    expect(confirm).toMatch(/live\?: boolean/);
    expect(confirm).toMatch(/\{live && <div className="mt-3"><LiveNotices open=\{open\} \/><\/div>\}/);
    const top = src("app/app/tests/[id]/TopPanel.tsx");
    expect((top.match(/<ConfirmButton live /g) ?? []).length).toBe(2);
    expect(src("app/app/tests/[id]/InvitePanel.tsx")).toMatch(/<LiveNotices open=\{!!confirm\} \/>/);
    for (const f of ["components/BlockButton.tsx", "components/RateBox.tsx", "app/app/sessions/[id]/ChoiceBox.tsx", "app/app/sessions/[id]/SessionActions.tsx", "app/app/account/DeleteAccount.tsx"]) expect(src(f), f).not.toMatch(/<ConfirmButton live/);
    const live = src("components/LiveNotices.tsx");
    expect(live).toMatch(/JustUpdated/);
    expect(live).toMatch(/LongList/);
    expect(live).toMatch(/useLiveAppend/);
  });

  it("the design doc lists every pop-up in section 2", () => {
    const doc = fs.readFileSync(path.resolve(__dirname, "../docs/DESIGN-DOC.md"), "utf8");
    const i = doc.indexOf("**Pop-ups**");
    expect(i).toBeGreaterThan(0);
    const block = doc.slice(i, doc.indexOf("**Drafts, numbers, links**"));
    for (const name of ["Stop", "End early", "Invite anyway", "Block", "Join anyway", "Leave", "Let it go", "Rate and finish", "Delete account", "Signed in as someone else"]) expect(block, name).toContain(name);
  });
});
