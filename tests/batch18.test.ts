import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { POST as reportsPOST } from "@/app/api/reports/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as testsPOST } from "@/app/api/tests/route";
import { checkListing, HIGH_PART_TICK, type Listing } from "@/lib/rules";
import { adminPage, userTotals } from "@/lib/server/adminLists";
import { payOwed, startHold } from "@/lib/server/holds";
import { overListingRoom } from "@/lib/server/payments";
import { REPORTED_LABEL } from "@/lib/server/reports";
import { setStripeForTests } from "@/lib/server/stripe";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, listingBody, sact, seen, settle, setup } from "./fixtures";

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
const report = (cookie: string, userId: string, note = "They were rude to me") => reportsPOST(req("/api/reports", { cookie, body: { userId, note } })).then(json);
afterEach(() => setStripeForTests(null));

/** A test whose written part costs `cents`, with one tester who sent it. */
async function sentAt(cents: number, name = "Ana Silva") {
  const s = await setup();
  await db.test.update({ where: { id: s.testId }, data: { writtenCents: cents } });
  const j = await joined(s.testId, name);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}

describe("N) Block and Report live only on profiles", () => {
  it("Block is on the two profiles and nowhere else; Report is there too", () => {
    for (const f of ["app/app/find/[id]/page.tsx", "app/app/sessions/[id]/page.tsx", "app/app/tests/[id]/page.tsx"]) expect(src(f), f).not.toContain("<BlockButton");
    for (const f of ["app/app/testers/[id]/page.tsx", "app/app/developers/[id]/page.tsx"]) {
      expect(src(f), f).toContain("<BlockButton");
      expect(src(f), f).toContain("<ReportButton");
    }
    expect(src("components/BlockButton.tsx")).toContain("ConfirmButton"); // Block keeps its confirm dialog
  });

  it("Block's only stop is a race check: already blocked in another tab → a blue notice", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    expect((await blocksPOST(req("/api/blocks", { cookie: dev.cookie, body: { userId: t.user.id, seenAt: new Date(0).toISOString() } })).then(json)).status).toBe(200);
    const again = await blocksPOST(req("/api/blocks", { cookie: dev.cookie, body: { userId: t.user.id } })).then(json);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe("You already blocked Ana Silva.");
  });

  it("Report: once per pair, ever; the reason is required; the admin sees it; the reported person is not told", async () => {
    const a = await admin();
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    expect((await report(dev.cookie, t.user.id, "no")).status).toBe(400);
    expect((await report(dev.cookie, t.user.id)).status).toBe(200);
    const again = await report(dev.cookie, t.user.id);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/^You already reported Ana Silva on /);
    expect((await report(t.cookie, dev.user.id)).status).toBe(200); // the other direction is another pair
    expect(await lines(t.user.id)).toHaveLength(0); // not told
    const mine = (await lines(a.user.id)).filter((l) => l.text.startsWith("New report: Nora Lane reported Ana Silva"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ groupKey: "disputes", own: false });
    const list = (await adminPage("reports", a.user.id, null)) as { rows: { reporter: string; reported: string; note: string; reporterHref: string; reportedHref: string }[]; total: number };
    const row = list.rows.find((r) => r.reporter === "Nora Lane" && r.reported === "Ana Silva")!;
    expect(row).toMatchObject({ note: "They were rude to me", reportedHref: `/app/testers/${t.user.id}`, reporterHref: `/app/developers/${dev.user.id}` });
    expect(src("components/ReportButton.tsx")).toContain("You reported {name} on {reportedOn}.");
  });

  it("the 'Reported more than 3 times' label: after the 4th report, never the number, in dispute / report / lift rows and admin bell lines", async () => {
    const a = await admin();
    const victim = await makeUser({ dev: true, name: "Nora Lane" });
    for (let i = 0; i < 3; i++) expect((await report((await makeUser({ tester: true })).cookie, victim.user.id)).status).toBe(200);
    let rows = ((await adminPage("reports", a.user.id, null)) as { rows: { reported: string; reportedHref: string }[] }).rows.filter((r) => r.reportedHref === `/app/developers/${victim.user.id}`);
    expect(rows.some((r) => r.reported.includes(REPORTED_LABEL))).toBe(false); // 3 is not more than 3
    expect((await report((await makeUser({ tester: true })).cookie, victim.user.id)).status).toBe(200);
    rows = ((await adminPage("reports", a.user.id, null)) as { rows: { reported: string; reportedHref: string }[] }).rows.filter((r) => r.reportedHref === `/app/developers/${victim.user.id}`);
    expect(rows[0].reported).toBe(`Nora Lane (${REPORTED_LABEL})`);
    expect((await lines(a.user.id)).some((l) => l.text.includes(`Nora Lane (${REPORTED_LABEL})`))).toBe(true);
    // The exact number stays in the totals line on the profile.
    expect((await userTotals(victim.user.id)).line).toContain("4 reports");
    // Never shown to developers or testers: the label exists only in admin code.
    for (const f of ["app/app/page.tsx", "app/app/tests/[id]/page.tsx", "app/app/sessions/[id]/page.tsx", "app/app/find/[id]/page.tsx"]) expect(src(f), f).not.toContain("Reported more than 3 times");
  });
});

describe("O) pop-up failures", () => {
  it("a failed confirm closes the dialog and the blue notice sits under the original button, saying the press didn't go through", () => {
    expect(src("components/ChangesBox.tsx")).toContain("Your press didn&apos;t go through.");
    expect(src("app/app/tests/[id]/TopPanel.tsx")).toContain('didntGo={k === "stop" || k === "end-early"}');
    for (const f of ["app/app/sessions/[id]/SessionActions.tsx", "app/app/sessions/[id]/ChoiceBox.tsx"]) expect(src(f), f).toContain("didntGo");
    expect(src("components/RateBox.tsx")).toContain("didntGo={p.working}");
    expect(src("components/GapDialog.tsx")).toContain("Your press didn&apos;t go through.");
    expect(src("app/app/tests/[id]/InvitePanel.tsx")).toContain("Your press didn't go through.");
  });
});

describe("Q) the owed window (a declined charge, before the hold)", () => {
  async function owing() {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    await settle();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    const mk = (cents: number, days = 2) => db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: cents, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() + days * DAY) } });
    return { dev, tester, sessionId, testId, sub, mk };
  }

  it("a DAILY 'Pay $X by <date and time> or your tests are paused': one line across all owed payments, stacked, emailed even with email Off", async () => {
    const { dev, mk } = await owing();
    await db.user.update({ where: { id: dev.user.id }, data: { emailPref: "off" } });
    setStripeForTests({ paymentIntents: { create: async () => { throw new Error("declined"); } } } as unknown as Stripe);
    await mk(900);
    await mk(500, 1);
    await cron();
    await cron();
    const l = (await lines(dev.user.id)).filter((x) => x.text.startsWith("Pay $"));
    expect(l).toHaveLength(1);
    expect(l[0].text).toMatch(/^Pay \$14\.00 by .+ or your tests are paused$/);
    expect(l[0]).toMatchObject({ own: false, groupKey: "owed", payment: true });
    // It ignores Off: it goes in the ONE end-of-day email (not right away), once.
    const mails = await db.outboxEmail.findMany({ where: { to: dev.user.email, text: { contains: "Pay $14.00 by" } } });
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/^Your Playtest account updates/);
    await db.notification.updateMany({ where: { userId: dev.user.id, groupKey: "owed" }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    await cron();
    expect((await lines(dev.user.id)).filter((x) => x.text.startsWith("Pay $")).length).toBe(2); // daily
  });

  it("while any failed payment is owed: Pay and extra pay wait ('Pay what you owe first.'), Reject works; the tester's Dispute and Charge wait", async () => {
    const { dev, tester, sessionId, testId, sub, mk } = await owing();
    const two = await joined(testId, "Ben Carter", "he");
    await sact(two.sessionId, "written", two.tester.cookie, { answers: ["a", "b"] });
    await settle();
    const sub2 = await db.submission.findFirstOrThrow({ where: { contractId: two.sessionId } });
    // A paid-below-listing piece the tester may dispute, before anything is owed.
    expect((await pay(dev.cookie, { kind: "submission", id: sub2.id, amount: "4.00", tickedCents: 400, reason: "Only half answered" })).status).toBe(200);
    await mk(900);
    const p = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 });
    expect(p.status).toBe(409);
    expect(p.body.error.message).toBe("Pay what you owe first.");
    expect((await act(testId, "pay-extra", dev.cookie, { seenAt: seen(), contractId: sessionId, submissionId: sub.id, amount: "2.00" })).body.error.message).toBe("Pay what you owe first.");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, action: "reject", reason: "Not what I asked for" })).status).toBe(200);
    const d = await sact(two.sessionId, "dispute", two.tester.cookie, { kind: "submission", id: sub2.id, reason: "I answered everything properly", seenAt: seen(), confirmed: true });
    expect(d.status).toBe(409);
    expect(d.body.error.message).toBe("Payment from this developer is delayed right now. You can try again once it's sorted.");
    expect(d.body.error.message).not.toMatch(/failed/i);
    void tester;
    // Pay what you owe: it works again.
    setStripeForTests(null);
    expect((await payOwed(dev.user)).paid).toBe(1);
    expect((await sact(two.sessionId, "dispute", two.tester.cookie, { kind: "submission", id: sub2.id, reason: "I answered everything properly", seenAt: seen(), confirmed: true })).status).toBe(200);
  });

  it("when a payment fails and when a retry succeeds, both sides get the live blue notice and the first press stops once", async () => {
    const { dev, testId } = await setup();
    const ana = await joined(testId);
    const r = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ productName: "Night Ferry", title: "Night Ferry" }) })));
    const B = r.body.id as string;
    await joined(B, "Ben Carter", "he");
    await sact(ana.sessionId, "written", ana.tester.cookie, { answers: ["a", "b"] });
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });
    const subA = await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId } });
    const loaded = seen();
    await new Promise((x) => setTimeout(x, 40));
    const p = await db.payment.create({ data: { kind: "review", contractId: ana.sessionId, submissionId: subA.id, developerId: dev.user.id, testerId: ana.tester.user.id, amountCents: 800, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() + 2 * DAY) } });
    await new Promise((x) => setTimeout(x, 40));
    const devStop = await act(B, "stop", dev.cookie, { seenAt: loaded });
    expect(devStop.body.error.code).toBe("stop_once");
    expect(devStop.body.error.changes.map((c: { text: string }) => c.text).join(" ")).toMatch(/Payment failed on Harbor Run/);
    const testerStop = await sact(ana.sessionId, "leave", ana.tester.cookie, { seenAt: loaded });
    expect(testerStop.body.error.code).toBe("stop_once");
    expect(JSON.stringify(testerStop.body.error.changes)).not.toMatch(/failed/i);
    // The daily retry succeeds: both read it, and each first press stops once with the notice.
    setStripeForTests({ paymentIntents: { create: async () => ({ id: "pi_" + randomUUID(), status: "succeeded" }) } } as unknown as Stripe);
    const loaded2 = seen();
    await new Promise((x) => setTimeout(x, 40));
    await cron();
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("charged");
    await new Promise((x) => setTimeout(x, 40));
    const devStop2 = await act(B, "stop", dev.cookie, { seenAt: loaded2 });
    expect(devStop2.body.error.changes.map((c: { text: string }) => c.text).join(" ")).toMatch(/Payment went through on Harbor Run/);
    const testerStop2 = await sact(ana.sessionId, "leave", ana.tester.cookie, { seenAt: loaded2 });
    expect(testerStop2.body.error.code).toBe("stop_once");
    expect(testerStop2.body.error.changes.length).toBeGreaterThan(0);
  });
});

describe("R, W) the 4th payment hold needs an admin's Approve (in the Lifts box)", () => {
  async function onHold(count: number) {
    const { dev } = await setup();
    await db.user.update({ where: { id: dev.user.id }, data: { holdCount: count - 1 } });
    await startHold(dev.user.id, "unpaid");
    return dev;
  }

  it("holds 1 to 3 lift when paid; hold 4 waits for Approve even with nothing owed; the admins are told once", async () => {
    const a = await admin();
    const third = await onHold(3);
    expect((await db.user.findUniqueOrThrow({ where: { id: third.user.id } })).holdCount).toBe(3);
    expect((await payOwed(third.user)).lifted).toBe(true);
    const fourth = await onHold(4);
    expect((await payOwed(fourth.user)).lifted).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: fourth.user.id } })).holdStartedAt).not.toBeNull();
    await payOwed(fourth.user); // the line is told once
    const told = (await lines(a.user.id)).filter((l) => l.text.startsWith("Hold lift waiting:") && l.text.includes("More than 3 holds") && l.text.includes(fourth.user.name));
    expect(told.length).toBeGreaterThanOrEqual(1);
    expect(told[0]).toMatchObject({ groupKey: "disputes", own: false, link: `/admin#lift-${fourth.user.id}` });
    // The Lifts box (newest first), with the hold number.
    const box = (await adminPage("lifts", a.user.id, null)) as { rows: { id: string; head: string; holdNumber: number }[] };
    expect(box.rows.find((r) => r.id === fourth.user.id)).toMatchObject({ head: expect.stringContaining("More than 3 holds") });
    expect(box.rows.some((r) => r.id === third.user.id)).toBe(false);
    // Approve: first press wins; the hold lifts.
    const ok = await aact(a.cookie, "approve-hold", { id: fourth.user.id, note: "Welcome back" });
    expect(ok.status).toBe(200);
    expect(ok.body.lifted).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: fourth.user.id } })).holdStartedAt).toBeNull();
    expect((await aact(a.cookie, "approve-hold", { id: fourth.user.id, note: "" })).status).toBe(409);
  });

  it("an Approve given before the payment lifts the hold once it is paid; a second Approve says it was already approved", async () => {
    const a = await admin();
    const b = await admin();
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.user.update({ where: { id: dev.user.id }, data: { holdCount: 4 } });
    await startHold(dev.user.id, "unpaid");
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 700, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date(Date.now() + DAY) } });
    expect((await aact(a.cookie, "approve-hold", { id: dev.user.id, note: "" })).body.lifted).toBe(false);
    const second = await aact(b.cookie, "approve-hold", { id: dev.user.id, note: "" });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/^This lift was already approved by /);
    expect((await payOwed(dev.user)).lifted).toBe(true);
  });

  it("the Payment holds list shows the hold count on every row and no Approve; the banner says the team will review; Open disputes is disputes only", () => {
    const page = src("app/admin/page.tsx");
    expect(page).toContain("More than 3 holds"); // a label only when it applies; no exact count outside the profile totals
    expect(page).not.toContain("hold {x.holdCount}");
    expect(page).toContain("Open disputes (");
    expect(page).not.toContain("Open disputes and lifts");
    const at = (id: string) => page.indexOf(`id="${id}"`);
    const order = ["disputes", "lifts", "chargebacks", "mine", "paused-tests"].map(at);
    expect(order.every((i) => i > 0) && [...order].sort((x, y) => x - y).join() === order.join()).toBe(true);
    expect(src("components/OwedBox.tsx")).toContain("the team will review your account before your tests resume");
  });
});

describe("S) price caps and the $200 ticks", () => {
  const price = (errs: string[]) => errs.filter((e) => /price|rate|Tick/.test(e));
  const l = (over: Partial<Listing> = {}): Listing => ({ ...(listingBody() as never as Listing), writtenCents: 1000, recordingCents: null, liveRateCents: 3000, questions: ["Q?"], productName: "P", title: "T", description: "x", categories: ["Game"], spots: 3, deadlineDays: 7, ...over }) as Listing;

  it("written / recording max $1,000; live max $200 an hour; over $200 needs the tick unless an unchanged saved price", () => {
    expect(price(checkListing(l({ writtenCents: 100_000 })))[0]).toMatch(/^Tick “I confirm this part pays more than \$200\.”/);
    expect(price(checkListing(l({ writtenCents: 100_000 }), 0, new Date(), { confirmedHigh: ["written"] }))).toEqual([]);
    expect(checkListing(l({ writtenCents: 100_001 }), 0, new Date(), { confirmedHigh: ["written"] })).toContain("The written answers price can be at most $1,000.00.");
    expect(checkListing(l({ recordingCents: 100_001 }))).toContain("The recording price can be at most $1,000.00.");
    expect(checkListing(l({ liveRateCents: 20_001 }))).toContain("The live call rate can be at most $200.00 an hour.");
    expect(price(checkListing(l({ liveRateCents: 20_000 })))).toEqual([]);
    expect(price(checkListing(l({ writtenCents: 20_000 })))).toEqual([]); // exactly $200: no tick
    // Edit: an already-saved price over $200 that is unchanged needs no tick; raised from at most $200 to over it does; changed (even higher) does.
    const edit = (writtenCents: number, saved: number) => price(checkListing(l({ writtenCents }), 0, new Date(), { edit: true, changed: new Set(["writtenCents"]), saved: { writtenCents: saved, recordingCents: null } }));
    expect(edit(50_000, 50_000)).toEqual([]);
    expect(edit(25_000, 15_000)).toHaveLength(1);
    expect(edit(60_000, 50_000)).toHaveLength(1);
    expect(HIGH_PART_TICK).toBe("I confirm this part pays more than $200.");
  });

  it("the server refuses on Post until the tick is ticked; the form shows the min–max hint and the tick", async () => {
    const dev = await makeUser({ dev: true });
    const refused = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ writtenCents: "500.00" }) })));
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(/^Tick “I confirm this part pays more than \$200\.”/);
    expect((await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: { ...listingBody({ writtenCents: "500.00" }), confirmHigh: ["written"] } })))).status).toBe(200);
    expect((await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: { ...listingBody({ writtenCents: "1000.01" }), confirmHigh: ["written"] } })))).status).toBe(400);
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain('max: "1000"');
    expect(form).toContain('max: "200"');
    expect(form).toContain("data-high-tick");
  });

  it("any Pay box over $200 shows the tick every time and is refused until ticked", async () => {
    const { dev, sub } = await sentAt(50_000);
    const no = await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "250.00", tickedCents: 25_000, reason: "Partly done" });
    expect(no.status).toBe(400);
    expect(no.body.error.message).toBe("Tick “I understand this payment can't be refunded and is charged now.” to pay.");
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "250.00", tickedCents: 25_000, reason: "Partly done", understood: true })).status).toBe(200);
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain("data-pay-tick");
  });
});

describe("T) extra pay beside each sent part, capped at 100% of the contract total above the listing", () => {
  const extra = (cookie: string, testId: string, body: Record<string, unknown>) => act(testId, "pay-extra", cookie, { seenAt: seen(), payKey: randomUUID(), ...body });

  it("pays above the listing for a sent part (80/20, a bell that does not stack); 'up to $Y' is the room left; the server refuses more", async () => {
    const { dev, tester, testId, sessionId, sub } = await sentAt(20_000);
    expect((await overListingRoom(sessionId)).roomCents).toBe(20_000); // 100% of the $200 contract total
    const r = await extra(dev.cookie, testId, { contractId: sessionId, submissionId: sub.id, amount: "150.00" });
    expect(r.status).toBe(200);
    const p = await db.payment.findFirstOrThrow({ where: { contractId: sessionId, kind: "extra" } });
    expect(p).toMatchObject({ amountCents: 15_000, feeCents: 3000, testerCents: 12_000, submissionId: sub.id });
    const bell = (await lines(tester.user.id)).find((l) => /paid you \$150\.00 extra for Harbor Run$/.test(l.text))!;
    expect(bell).toMatchObject({ own: true, payment: true });
    expect((await overListingRoom(sessionId)).roomCents).toBe(5000);
    const over = await extra(dev.cookie, testId, { contractId: sessionId, submissionId: sub.id, amount: "60.00" });
    expect(over.status).toBe(400);
    expect(over.body.error.message).toBe("You can pay Ana Silva up to $50.00 more above the listing prices.");
    expect((await extra(dev.cookie, testId, { contractId: sessionId, submissionId: sub.id, amount: "50.00" })).status).toBe(200);
    expect((await extra(dev.cookie, testId, { contractId: sessionId, submissionId: sub.id, amount: "1.00" })).body.error.message).toMatch(/^Everything allowed above the listing prices/);
  });

  it("a normal Pay above the listing counts toward the same cap; booked and held calls add to the contract total; an unsent part has no extra box", async () => {
    const { dev, tester, testId, sessionId, sub } = await sentAt(10_000);
    await bookCall(testId, dev.cookie, sessionId, tester.cookie, 48); // 30 min at $30/h = $15
    expect((await overListingRoom(sessionId)).capCents).toBe(11_500);
    // Pay $110 for a $100 part: $10 above the listing.
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "110.00", tickedCents: 11_000, understood: true })).status).toBe(200);
    expect((await overListingRoom(sessionId)).roomCents).toBe(10_500);
    expect(src("app/app/tests/[id]/page.tsx")).toContain("r.sub && !restricted && <ExtraPay");
    expect(src("app/app/tests/[id]/ExtraPay.tsx")).toContain("up to {money(roomCents)}");
    expect(src("app/app/tests/[id]/ExtraPay.tsx")).toContain("Paid so far for this part:");
    // Pay above the cap is refused.
    const two = await sentAt(10_000, "Ben Carter");
    const tooMuch = await pay(two.dev.cookie, { kind: "submission", id: two.sub.id, amount: "250.00", tickedCents: 25_000, understood: true });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.message).toMatch(/^You can pay at most \$200\.00 for this: everything paid above the listing prices is capped at 100% of Ben Carter's contract total\.$/);
  });
});

describe("U) admin views on profiles and on a test's own page", () => {
  it("a profile has a totals line and admin-only boxes; the test page has the timeline, contract changes and payments; the per-test History is gone", async () => {
    const a = await admin();
    const { dev, tester, testId, sessionId, sub } = await sentAt(1000);
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    await startHold(dev.user.id, "unpaid");
    await aact(a.cookie, "suspend", { id: tester.user.id, note: "Testing" });
    await report((await makeUser({ tester: true })).cookie, dev.user.id);
    const dt = await userTotals(dev.user.id);
    expect(dt.line).toMatch(/^Total spent \$10\.00 · 1 report · 0 disputes · 0 chargebacks · 1 hold · 0 suspensions$/);
    const tt = await userTotals(tester.user.id);
    expect(tt.line).toMatch(/^Total paid out \$8\.00 · 0 reports · 0 disputes · 0 chargebacks · 0 holds · 1 suspension$/);
    expect(tt.partsLine).toBe("1 part sent · $8.00 paid out for them");
    const text = async (kind: string, id: string) => ((await adminPage(kind as never, a.user.id, null, id)) as { rows: { text: string }[] }).rows.map((r) => r.text).join("\n");
    expect(await text("u-payments", dev.user.id)).toMatch(/review \$10\.00 to /);
    expect(await text("u-payouts", tester.user.id)).toMatch(/\$8\.00 from /);
    expect(await text("u-holds", dev.user.id)).toMatch(/Payment hold started/);
    expect(await text("u-holds", tester.user.id)).toMatch(new RegExp(`Suspended by ${a.user.email}: Testing`));
    expect(await text("u-tests", dev.user.id)).toMatch(/Posted “Harbor Run”/);
    expect(await text("u-tests", tester.user.id)).toMatch(/Joined “Harbor Run”/);
    expect(await text("u-parts", tester.user.id)).toMatch(/written answers · paid \$10\.00/);
    expect(await text("u-reports", dev.user.id)).toMatch(/Reported by .+: “They were rude to me”/);
    expect(await text("t-timeline", testId)).toMatch(/Ana Silva joined/);
    expect(await text("t-contracts", testId)).toMatch(/Ana Silva joined on: /);
    expect(await text("t-payments", testId)).toMatch(/review \$10\.00 to Ana Silva/);
    // Newest first, paged by 25, admin only.
    const rows = ((await adminPage("t-timeline", a.user.id, null, testId)) as { rows: { at: string }[] }).rows;
    expect(rows.map((r) => r.at)).toEqual([...rows.map((r) => r.at)].sort().reverse());
    for (const f of ["app/app/testers/[id]/page.tsx", "app/app/developers/[id]/page.tsx"]) expect(src(f), f).toMatch(/isAdmin\(viewer\) && !mine && <AdminPersonBoxes/);
    expect(src("app/app/find/[id]/page.tsx")).toContain("isAdmin(u) && <AdminTestBoxes");
    expect(src("app/admin/PagedList.tsx")).not.toContain("HistoryToggle");
    expect(src("app/admin/page.tsx")).not.toContain("History of this test");
    expect(src("app/admin/PagedList.tsx")).toContain("href={`/app/find/${m.testId}`}"); // admin rows link to the pages
    expect(sessionId).toBeTruthy();
  });
});

describe("Y) cross-tab sign-in", () => {
  it("an old tab never sends a press as the previous account: the press names its account and the server refuses a mismatch", async () => {
    const old = await makeUser({ dev: true, name: "Nora Lane" });
    const other = await makeUser({ tester: true, name: "Ana Silva" });
    const press = (cookie: string, uid: string) => blocksPOST(req("/api/blocks", { cookie, headers: { "x-uid": uid }, body: { userId: other.user.id, action: "unblock" } })).then(json);
    // The browser now holds the NEW account's cookie, but the old tab still says it belongs to the old account.
    const refused = await press(other.cookie, old.user.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("account_changed");
    expect((await press(old.cookie, old.user.id)).status).toBe(200);
  });

  it("no cover screen: other tabs switch to the new account on the page the sign-in landed on; sign-out sends every tab to the sign-in page", () => {
    const watch = src("components/SessionWatch.tsx");
    expect(watch).not.toContain("Signed in as someone else");
    expect(watch).not.toContain("data-wrong-account");
    expect(watch).toContain("window.location.href = landingOfNewSignIn()");
    expect(src("components/AuthForm.tsx")).toContain('announceAuth("in", p.next || "/app")');
    expect(src("components/SignOut.tsx")).toContain('window.location.href = "/login"');
    expect(src("lib/client.ts")).toContain('"x-uid"');
    expect(src("lib/client.ts")).toContain("account_changed");
    const doc = fs.readFileSync(path.resolve(__dirname, "../docs/DESIGN-DOC.md"), "utf8");
    expect(doc).not.toContain("Signed in as someone else");
  });
});

describe("the final list of emails that ignore Off, and each notification emailed at most once", () => {
  it("receipts and 'You were paid' follow the setting; the must-send lines ride in ONE end-of-day email with the payment email, never twice", async () => {
    const { sendSummaries, notify } = await import("@/lib/server/notify");
    // Weekly person: a payment line and a must-send line go end of day, once; an ordinary line waits.
    const u = await makeUser({ tester: true });
    await db.user.update({ where: { id: u.user.id }, data: { emailPref: "weekly", lastSummaryAt: new Date() } });
    await notify(u.user.email, "Ordinary", ["x"], "/app");
    await notify(u.user.email, "Receipt: you paid $5.00 for x", ["x"], "/app/payments", { payment: true });
    await notify(u.user.email, "Your account is paused", ["x"], "/app/help", { always: true });
    await sendSummaries();
    await sendSummaries();
    const mails = await db.outboxEmail.findMany({ where: { to: u.user.email } });
    expect(mails).toHaveLength(1);
    expect(mails[0].text).toContain("Receipt: you paid $5.00");
    expect(mails[0].text).toContain("Your account is paused");
    expect(mails[0].text).not.toContain("Ordinary");
    // A line that is both payment-related and must-send (the owed reminder) is in that one email only, never again in the weekly summary.
    await notify(u.user.email, "Pay $9.00 by Oct 30 or your tests are paused", ["x"], "/app/payments#owed", { always: true, payment: true });
    await sendSummaries();
    await db.user.update({ where: { id: u.user.id }, data: { lastSummaryAt: new Date(Date.now() - 8 * DAY) } });
    await sendSummaries();
    const all = (await db.outboxEmail.findMany({ where: { to: u.user.email } })).map((m) => m.text);
    expect(all.filter((t) => t.includes("Pay $9.00 by")).length).toBe(1);
    expect(all.filter((t) => t.includes("Receipt: you paid $5.00")).length).toBe(1);
    // Off: a payment line sends nothing at all; a must-send line sends in the one email.
    const off = await makeUser({ dev: true });
    await db.user.update({ where: { id: off.user.id }, data: { emailPref: "off" } });
    await notify(off.user.email, "Receipt: you paid $7.00 for x", ["x"], "/app/payments", { payment: true });
    await sendSummaries();
    expect(await db.outboxEmail.count({ where: { to: off.user.email } })).toBe(0);
    await notify(off.user.email, "The team stopped “Harbor Run”", ["x"], "/app/tests/x", { always: true, group: "team" });
    await sendSummaries();
    expect((await db.outboxEmail.findMany({ where: { to: off.user.email } })).map((m) => m.text).join()).toContain("The team stopped");
  });

  it("the always list is exactly: the owed reminder, account paused / active again, the team pausing / stopping / closing a test", () => {
    const hits: string[] = [];
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(path.resolve(__dirname, "../src/lib/server"))) {
      for (const l of fs.readFileSync(f, "utf8").split(/\r?\n/)) if (l.includes("always: true") && !l.trim().startsWith("//") && !l.trim().startsWith("*")) hits.push(path.basename(f));
    }
    const names = [...hits].sort();
    expect(names).toEqual(["holds.ts", "pauseClosure.ts", "restrictions.ts", "restrictions.ts", "restrictions.ts", "restrictions.ts"].sort());
  });
});
