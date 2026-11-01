import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as deletePOST } from "@/app/api/account/delete/route";
import { POST as owedPOST } from "@/app/api/payments/owed/route";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { setStripeForTests } from "@/lib/server/stripe";
import { CRITICAL_FIELDS, CRITICAL_WORDS, countsOf, criticalLine, isCritical } from "@/lib/limits";
import { closedForSuspended, openForRestricted, restrictedOn } from "@/lib/closedPages";
import { restrictionKey } from "@/lib/restricted";
import { RATE_AFTER_CLOSE_KINDS, rateStops, testClosedForRate } from "@/lib/rules";
import { contractLinkModeFor } from "@/components/ContractLink";
import { devDeleteLines, testerDeleteFacts, testerDeleteLines } from "@/lib/server/deletion";
import { runDaily, startHold } from "@/lib/server/holds";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const del = (cookie: string) => deletePOST(req("/api/account/delete", { cookie, body: { confirmed: true } })).then(json);
const adm = (action: string, cookie: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const admin = async () => {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
};
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  act(testId, "edit", cookie, { version: (await db.test.findUniqueOrThrow({ where: { id: testId } })).version, fields, ...extra });
afterEach(() => setStripeForTests(null));

async function sentWork(over: Record<string, unknown> = {}) {
  const s = await setup(over);
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}

describe("batch 5 item 1: 'See their contract' under a pressed button", () => {
  it("(batch 14) a tester's Switch is a quiet live-box line with the contract, never a stop; the boxes render the link", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await edit(testId, dev.cookie, { writtenCents: "12.00" })).status).toBe(200);
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: sessionId } });
    const pageLoaded = seen();
    await settle();
    expect((await sact(sessionId, "terms", tester.cookie, { offerId: offer.id, choice: "switch", seenAt: seen(), confirmed: true })).status).toBe(200);
    const { devChanges, asLines } = await import("@/lib/server/live");
    expect(asLines(await devChanges(dev.user.id, testId, new Date(pageLoaded), "", db, { all: true }))).toContainEqual(expect.objectContaining({ text: "Ana Silva switched to the new terms", kind: "terms", contract: sessionId }));
    const r = await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: pageLoaded });
    expect(r.status).toBe(200);
    const box = src("components/ChangesBox.tsx");
    expect(box).toContain('c.kind === "terms" && c.contract && <> <ContractLink contract={c.contract} /></>');
    expect(src("components/LiveTop.tsx")).toContain("<ContractLink contract={l.contract} mode={contractLink} />");
  });

  it("on the test page the link scrolls (opening the Testers fold); on Edit it opens the test page at that row in a new tab", () => {
    expect(contractLinkModeFor("/app/tests/abc")).toBe("scroll");
    expect(contractLinkModeFor("/app/tests/abc?x=1#calls")).toBe("scroll");
    expect(contractLinkModeFor("/app/tests/abc/edit")).toEqual({ testId: "abc" });
    expect(contractLinkModeFor("/app/tests/new")).toBeNull();
    expect(contractLinkModeFor("/app")).toBeNull();
    const link = src("components/ContractLink.tsx");
    expect(link).toContain('document.querySelector("#testers-joined")');
    expect(link).toContain('target="_blank"');
    expect(link).toContain("See their contract");
  });
});

describe("batch 5 item 2: the 3-change limit covers the steps, questions, languages and devices (batch 34 §15: not the NDA)", () => {
  it("the fields, the words and the refusal line", () => {
    // (Batch 14) Plus the build link and ONE counter for the parts and prices.
    expect(Object.keys(CRITICAL_FIELDS).sort()).toEqual(["buildUrl", "description", "devices", "languages", "parts", "questions"]);
    for (const f of ["writtenCents", "recordingCents", "liveRateCents", "liveMinutes", "writtenRequired", "recordingRequired", "liveRequired"]) expect(isCritical(f), f).toBe(false);
    expect(CRITICAL_WORDS).toBe("steps, questions, languages, devices, build link or parts and prices");
    // (Batch 6 item 3) Per field: the line names the one field.
    expect(criticalLine("questions")).toMatch(/^You've changed the questions 3 times since testers joined\./);
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain("{criticalLine(f)}");
    expect(fs.readFileSync(path.resolve(__dirname, "../prisma/schema.prisma"), "utf8")).toContain("criticalCounts Json");
  });

  it("devices and languages count; adding access keys never does; prices still send the Switch / Keep offer without counting", async () => {
    const { dev, testId } = await setup();
    const { sessionId } = await joined(testId);
    for (const fields of [{ devices: ["Windows PC"] }, { devices: ["Mac"] }, { devices: ["Windows PC", "Mac"] }, { languages: ["English"] }]) expect((await edit(testId, dev.cookie, fields)).status).toBe(200);
    expect(countsOf((await db.test.findUniqueOrThrow({ where: { id: testId } })).criticalCounts)).toMatchObject({ devices: 3, languages: 1 });
    const fourth = await edit(testId, dev.cookie, { devices: ["Mac"] });
    expect(fourth.status).toBe(400);
    expect(fourth.body.error.message).toBe(criticalLine("devices"));
    // Keys stay out of the limit.
    expect((await edit(testId, dev.cookie, {}, { keysAdd: ["K1", "K2", "K3"] })).status).toBe(200);
    // (Batch 14) Prices use the parts-and-prices counter, and working testers still get the offer.
    const r = await edit(testId, dev.cookie, { writtenCents: "14.00" });
    expect(r.status).toBe(200);
    expect(r.body.offered).toBe(1);
    expect(await db.termsOffer.count({ where: { contractId: sessionId, status: "open" } })).toBe(1);
    expect(countsOf((await db.test.findUniqueOrThrow({ where: { id: testId } })).criticalCounts)).toMatchObject({ devices: 3, languages: 1, description: 0 });
  });
});

describe("batch 5 item 3: a restricted account's signed-in pages go to the dashboard", () => {
  const susTester = { isDeveloper: false, isTester: true, testerSuspendedAt: new Date() };
  const heldDev = { isDeveloper: true, isTester: false, holdStartedAt: new Date(), holdReason: "unpaid" };
  const cbDev = { isDeveloper: true, isTester: false, holdStartedAt: new Date(), holdReason: "chargeback" };
  const susDev = { isDeveloper: true, isTester: false, devSuspendedAt: new Date() };
  // (Batch 15 section 29) A test page itself (/app/tests/x) opens for a restricted developer in its restricted view.
  const closedPaths = ["/app/tests/x/edit", "/app/tests/new", "/app/testers/x", "/app/developers/x", "/app/sessions/x", "/app/calls/x", "/app/find", "/app/find/x", "/app/messages", "/app/chat/x", "/app/profile"];
  const openPaths = ["/app", "/app/payments", "/app/account", "/app/account/blocked", "/app/help", "/app/notifications", "/app/switch"];

  it("only the dashboard, Payments, Settings and the bell list stay open: for a suspended tester and a suspended or held developer", () => {
    for (const u of [susTester, heldDev, cbDev, susDev]) {
      // (Batch 16 section 28) A suspended tester's session page decides itself (the limited view of a test they were removed from).
      for (const p of closedPaths) expect(closedForSuspended(p, u), `${p} ${JSON.stringify(u)}`).toBe(!(u === susTester && p === "/app/sessions/x"));
      expect(closedForSuspended("/app/tests/x", u)).toBe(u === susTester);
      for (const p of openPaths) expect(closedForSuspended(p, u), p).toBe(false);
    }
    for (const p of openPaths) expect(openForRestricted(p), p).toBe(true);
    expect(openForRestricted("/app/payments-x")).toBe(false);
    // Nobody restricted: nothing closed.
    for (const p of closedPaths) expect(closedForSuspended(p, { isDeveloper: true, isTester: true }, "developer")).toBe(false);
  });

  it("a hold keeps the tester side of an account with both sides open; an admin suspension closes both; the page decides a chat or call by the role in it", () => {
    const both = { isDeveloper: true, isTester: true, holdStartedAt: new Date(), holdReason: "unpaid", side: "tester" };
    for (const p of ["/app/find", "/app/find/x", "/app/sessions/x", "/app/developers/x"]) expect(closedForSuspended(p, both, "tester"), p).toBe(false);
    for (const p of ["/app/tests/x/edit", "/app/tests/new", "/app/testers/x"]) expect(closedForSuspended(p, both, "developer"), p).toBe(true);
    expect(closedForSuspended("/app/tests/x", both, "developer")).toBe(false); // (batch 15 section 29) its restricted view
    expect(closedForSuspended("/app/profile", both, "tester")).toBe(false);
    expect(closedForSuspended("/app/profile", both, "developer")).toBe(true);
    // A chat or call: the layout leaves it to the page, which knows the role.
    expect(closedForSuspended("/app/chat/x", both, "developer")).toBe(false);
    expect(closedForSuspended("/app/chat/x", both, "developer", "developer")).toBe(true);
    expect(closedForSuspended("/app/chat/x", both, "developer", "tester")).toBe(false);
    expect(closedForSuspended("/app/calls/x", both, "tester", "developer")).toBe(true);
    const bothSuspended = { ...both, devSuspendedAt: new Date(), testerSuspendedAt: new Date() };
    for (const p of closedPaths) expect(closedForSuspended(p, bothSuspended, "tester"), p).toBe(p !== "/app/sessions/x"); // (batch 16 section 28) the page decides
    expect(restrictedOn(both, "tester")).toBe(false);
    expect(restrictedOn(both, "developer")).toBe(true);
    expect(restrictedOn(bothSuspended, "tester")).toBe(true);
    // The live move needs no change: a suspended tester's key is "s", so SessionWatch moves every open page to the dashboard top.
    expect(restrictionKey(susTester, "tester")).toBe("t"); // (batch 15) "t": the tester side
  });

  it("a tester whose developer is suspended or on hold is not restricted: they keep their session page", async () => {
    const { dev, sessionId, tester } = await sentWork();
    const a = await admin();
    expect((await adm("suspend", a.cookie, { id: dev.user.id, note: "Spam" })).status).toBe(200);
    const t = await db.user.findUniqueOrThrow({ where: { id: tester.user.id } });
    expect(closedForSuspended(`/app/sessions/${sessionId}`, t, "tester")).toBe(false);
    expect(closedForSuspended(`/app/chat/${sessionId}`, t, "tester", "tester")).toBe(false);
  });

  it("every closed page sends them away itself before rendering; the header keeps only the open links; the bell list lands closed lines on the dashboard", () => {
    for (const [f, p] of [["app/app/developers/[id]/page.tsx", "/app/developers"], ["app/app/testers/[id]/page.tsx", "/app/testers"], ["app/app/find/page.tsx", "/app/find"], ["app/app/find/[id]/page.tsx", "/app/find"], ["app/app/messages/page.tsx", "/app/messages"], ["app/app/profile/page.tsx", "/app/profile"]])
      expect(src(f), f).toContain(`requireOpenPage("${p}")`);
    // (Batch 16 section 28) The session page decides itself: only the limited view of a test a suspended tester was removed from.
    expect(src("app/app/sessions/[id]/page.tsx")).toContain('if (u.testerSuspendedAt && !limited) redirect("/app");');
    for (const f of ["app/app/chat/[id]/page.tsx", "app/app/calls/[id]/page.tsx"]) {
      expect(src(f), f).toContain("requireOpenPage(");
      expect(src(f), f).toContain("leaveIfClosed(u,");
    }
    for (const f of ["app/app/tests/[id]/edit/page.tsx", "app/app/tests/new/page.tsx"]) expect(src(f), f).toContain("requireOpenDevPage()");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("requireOpenPage(`/app/tests/${id}`)");
    const layout = src("app/app/layout.tsx");
    expect(layout).toContain("const off = restrictedOn(u, side);");
    for (const link of ['side === "developer" && !off', 'side === "tester" && !off', "{!off && !admin && <Link", "const messagesLink = off ? null"]) expect(layout, link).toContain(link);
    expect(src("app/app/notifications/page.tsx")).toContain('closedForSuspended(link, u, sideForPath(link, u.id) ?? sideFor(u)) ? "/app"'); // (batch 34 §5) the line's own side
  });

  it("the dashboard: names are plain text (no hover card); a suspended tester's rows don't open closed pages; the tester's blue box", () => {
    const dash = src("app/app/page.tsx");
    expect(dash).toContain("<Seats total={t.spots} plain={restricted}");
    expect(src("components/Ui.tsx")).toContain("data-plain-seat");
    expect(dash).toContain('data-waiting-plain=""');
    // (Owner §98 dashboard rows) Suspended rows stay plain; active rows link directly to their parts.
    expect(dash).toContain('data-waiting-plain="">{inner}</div> : <Link href={`/app/sessions/${c.id}#parts`}');
    expect(dash).toContain("const answers = suspended ? [] :");
    const box = src("components/RestrictedBox.tsx");
    expect(box).toContain("Your account is paused. You were removed from all the tests you were in.");
    expect(box).toContain("Pay for work already accepted still reaches your Stripe account.");
    expect(box).toContain('<Link href="/app/help" className="underline">Contact us</Link> in Settings');
    expect(box).not.toMatch(/Suspended label/);
  });
});

describe("batch 5 item 4: no automatic re-invite after a tester's suspension", () => {
  it("the removed tests wait with 'You were removed from this test' and Ask to rejoin (open, a spot, not paused) until asked or dismissed; no Suspended label, no Rejoin", async () => {
    expect(src("lib/server/restrictions.ts")).not.toContain("reinviteAfterSuspension");
    const dash = src("app/app/page.tsx");
    expect(dash).not.toContain("data-suspended-label");
    expect(dash).not.toContain('"Rejoin"');
    expect(dash).toContain("You were removed from this test.");
    expect(dash).toContain("hasSpot(c) && askable(c)");

    const { dev, testId } = await setup({ spots: 1 });
    const ana = await joined(testId, "Ana Silva");
    const a = await admin();
    await adm("suspend", a.cookie, { id: ana.tester.user.id, note: "Fake work" });
    await adm("unsuspend", a.cookie, { id: ana.tester.user.id });
    expect(await db.invite.count({ where: { testerId: ana.tester.user.id } })).toBe(0);
    // The developer can invite them again as usual.
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [ana.tester.user.id] })).status).toBe(200);
    expect(await db.invite.count({ where: { testerId: ana.tester.user.id, status: "sent" } })).toBe(1);
  });
});

describe("batch 5 item 5: Rate's stop-once lines", () => {
  it("open test: every kind; closed: only pay, reject, charge, let go, disputes (never your own presses in another tab: batch 29)", () => {
    const line = (kind: string, text = "x") => ({ kind, text, createdAt: new Date() });
    for (const k of ["joined", "left", "sent", "booked", "cancelled", "info", "terms", "requested", "applied"]) expect(rateStops(line(k), false), k).toBe(true);
    for (const k of ["joined", "left", "sent", "booked", "cancelled", "info", "terms", "requested", "applied"]) expect(rateStops(line(k), true), k).toBe(false);
    for (const k of RATE_AFTER_CLOSE_KINDS) expect(rateStops(line(k), true), k).toBe(true);
    // (Batch 29 sections 12-13) Your own changes in another tab never stop Rate, open or closed.
    for (const closed of [false, true]) {
      expect(rateStops(line("own", "You paid Ana Silva $10.00 for the written answers in another tab"), closed)).toBe(false);
      expect(rateStops(line("own", "You let your recording go in another tab"), closed)).toBe(false);
    }
    expect(testClosedForRate({ status: "open" })).toBe(false);
    expect(testClosedForRate({ status: "stopped" })).toBe(true);
    expect(testClosedForRate({ status: "closed" })).toBe(true);
  });

  it("tester (batch 17 section 14): a listing change never stops Rate; a payment about their work does, once", async () => {
    const { dev, testId, sessionId, tester, sub } = await sentWork();
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const pageLoaded = seen();
    await settle();
    await db.testEvent.create({ data: { testId, kind: "info", text: "Nora Lane changed the description" } });
    const rec = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(Date.now() - 60_000), updatedAt: new Date() } });
    await db.review.create({ data: { submissionId: rec.id, contractId: sessionId, amountCents: 1000, agreedCents: 1000, payKey: randomUUID() } });
    const r = await sact(sessionId, "rate", tester.cookie, { stars: 4, seenAt: pageLoaded });
    expect(r.body.error.code).toBe("stop_once");
    expect(r.body.error.changes.map((c: { text: string }) => c.text)).toEqual(["Nora Lane paid $10.00 for your recording"]);
    await settle();
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 4, seenAt: pageLoaded, confirmed: true, boxAt: seen() })).status).toBe(200);
  });

  it("developer (batch 17 sections 14 and 16): a tester joining or a Charge line never stops Rate", async () => {
    const { dev, testId, sessionId, tester, sub } = await sentWork();
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect((await sact(sessionId, "rate", tester.cookie, { stars: 4 })).status).toBe(200);
    const pageLoaded = seen();
    await settle();
    await joined(testId, "Ben Carter", "he");
    await db.testEvent.create({ data: { testId, kind: "choice", text: "Ana Silva can now charge or let go of their recording", contractId: sessionId } });
    expect((await act(testId, "rate", dev.cookie, { contractId: sessionId, stars: 5, seenAt: pageLoaded })).status).toBe(200);
  });
});

describe("batch 5 item 6: deleting an account", () => {
  it("tester: the pop-up's real numbers (waiting for payout setup, delayed, unpaid work) and every warning line", async () => {
    const { dev, testId, sessionId, tester, sub } = await sentWork();
    const base = { contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, feeCents: 0 };
    await db.payment.create({ data: { ...base, kind: "review", amountCents: 1000, testerCents: 800, status: "charged", transferStatus: "waiting" } });
    await db.payment.create({ data: { ...base, kind: "review", amountCents: 500, testerCents: 0, status: "failed", owedUntil: new Date() } });
    await db.payment.create({ data: { ...base, kind: "review", amountCents: 1500, testerCents: 0, status: "deferred" } });
    void testId; void sub;
    const f = await testerDeleteFacts(tester.user.id);
    expect(f).toMatchObject({ waitingCents: 800, delayedN: 2, delayedCents: 1600, unpaidN: 1, unpaidCents: 800, payoutsReady: false });
    const lines = testerDeleteLines(f);
    expect(lines.map((l) => l.key)).toEqual(["sent", "waiting", "delayed", "unpaid", "leave", "chats", "final"]);
    const text = lines.map((l) => l.text);
    expect(text).toContain("Pay already sent to your Stripe account stays there. Your Stripe account is separate from Playtest: you can still sign in to Stripe and withdraw it.");
    expect(text).toContain("$8.00 is waiting for your payout setup. Finish it before deleting, or it can't reach you.");
    expect(text).toContain("2 delayed payments ($16.00) still reach your Stripe account when the developer pays, if you finish your payout setup before deleting.");
    expect(text).toContain("1 part you sent isn't paid yet (up to $8.00). Work you already sent can still be paid by the developer, to your Stripe account if it's set up. After deleting, you can't charge for it or dispute it.");
    expect(text).toContain("You leave every test you're in. Calls ahead are cancelled, and your invites and applications are cancelled. Open disputes are withdrawn.");
    expect(text).toContain("Your chats close. The ratings you gave and got stay.");
    expect(text).toContain("You can't sign in again, and this can't be undone.");
    // Lines with nothing to say are left out.
    expect(testerDeleteLines({ waitingCents: 0, delayedN: 0, delayedCents: 0, unpaidN: 0, unpaidCents: 0, payoutsReady: true }).map((l) => l.key)).toEqual(["sent", "leave", "chats", "final"]);
    const ui = src("app/app/account/DeleteAccount.tsx");
    expect(ui).toContain("Set up payouts");
    expect(src("app/app/account/page.tsx")).toContain("testerDeleteLines(await testerDeleteFacts(u.id))");
  });

  it("tester deleted: open disputes are withdrawn; unpaid work can't be paid, charged or disputed and leaves the developer's review lists; Charge never opens for it", async () => {
    const { dev, testId, sessionId, tester, sub } = await sentWork();
    expect((await pay(dev.cookie, { amount: "0", kind: "submission", id: sub.id, reason: "Not enough here" })).status).toBe(200);
    expect((await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question fully", seenAt: seen(), confirmed: true })).status).toBe(200);
    const rec = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date(), payBy: new Date(Date.now() - 1000) } });
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 1000) } });
    expect((await del(tester.cookie)).status).toBe(200);
    expect(await db.dispute.count({ where: { testerId: tester.user.id, status: "open" } })).toBe(0);
    expect((await db.dispute.findFirstOrThrow({ where: { testerId: tester.user.id } })).status).toBe("withdrawn");
    const r = await pay(dev.cookie, { kind: "submission", id: rec.id, amount: "10.00", tickedCents: 1000 });
    expect(r.status).toBe(409);
    // (Batch 11, DEFAULT) No payout account was connected: nothing can reach them.
    expect(r.body.error).toMatchObject({ code: "gone", message: "Ana Silva deleted their account before setting up payouts, so this can't be paid." });
    await runDaily(new Date());
    expect((await db.submission.findUniqueOrThrow({ where: { id: rec.id } })).choiceOfferedAt).toBeNull();
    expect(src("app/app/page.tsx")).toContain("if (!testerPayable(c.tester)) continue;");
    expect(src("app/app/tests/[id]/page.tsx")).toContain(".filter((c) => testerPayable(c.tester))");
  });

  it("a delayed payment still reaches a deleted tester's Stripe account when the developer pays what they owe", async () => {
    const { dev, sessionId, tester } = await sentWork();
    const acct = "acct_" + randomUUID().slice(0, 12);
    await db.user.update({ where: { id: tester.user.id }, data: { stripeAccountId: acct, payoutsReady: true } });
    await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: "cus_" + randomUUID().slice(0, 12), stripePaymentMethodId: "pm_" + randomUUID().slice(0, 12) } });
    const owedPay = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "failed", owedUntil: new Date() } });
    await startHold(dev.user.id, "unpaid");
    expect((await del(tester.cookie)).status).toBe(200);
    const made: { transfer_data?: { destination?: string } }[] = [];
    setStripeForTests({ paymentIntents: { create: async (p: { transfer_data?: { destination?: string } }) => { made.push(p); return { id: "pi_" + randomUUID(), status: "succeeded" }; } } } as unknown as Stripe);
    const r = await json(await owedPOST(req("/api/payments/owed", { cookie: dev.cookie, body: {} })));
    expect(r.body).toMatchObject({ paid: 1, stillFailing: [] });
    expect(made[0].transfer_data?.destination).toBe(acct);
    expect(await db.payment.findUniqueOrThrow({ where: { id: owedPay.id } })).toMatchObject({ status: "charged", transferStatus: "sent" });
  });

  it("(batch 12 section 1, replacing the blockers) developer: always deletes; the warning lists the counts", async () => {
    const { dev, testId } = await sentWork();
    expect((await devDeleteLines(dev.user.id)).map((l) => l.key)).toEqual(["review", "after"]);
    const r = await del(dev.cookie);
    expect(r.status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).status).toBe("stopped");
    expect(src("app/app/account/DeleteAccount.tsx")).toContain("data-dev-delete-warning");
    expect(src("app/app/account/page.tsx")).toContain("devLines={dev ? await devDeleteLines(u.id) : []}");
    expect(src("lib/server/restrictions.ts")).not.toContain("devDeleteBlockers");
  });
});
