import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { runSweep } from "@/lib/server/holds";
import { payoutWaitLine } from "@/lib/payout";
import { ANSWER_TERMS_FIRST } from "@/lib/answerTerms";
import { refusalLine } from "@/lib/pressLabels";
import { joined, setup } from "./fixtures";

const src = (f: string) => fs.readFileSync(path.join(process.cwd(), "src", f), "utf8");

// (Owner's findings from the Oct 30 screenshot run, batch 32 §12)
describe("batch 32 §12: fixes from the screenshot run", () => {
  it("(replaced by batch 35 §90) an update the page has shown counts as seen on arrival, call changes too", () => {
    const top = src("components/LiveTop.tsx");
    expect(top).toContain("if (added.length) setShownOnPage(scope, r.now);");
    expect(src("lib/live.ts")).toContain("if (at > boxSeenUpTo) boxSeenUpTo = at;");
    // Untouched answer boxes take what another device sent; typed text stays.
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain("(cur[i] ?? \"\") === (was.answers[i] ?? \"\") ? initial[i] ?? \"\" : cur[i] ?? \"\"");
  });

  it("the waiting-money line goes out with the 5-minute sweep", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "charged", transferStatus: "waiting" } });
    await runSweep();
    expect(await db.notification.count({ where: { userId: tester.user.id, text: payoutWaitLine("$8.00") } })).toBe(1);
    expect(src("lib/server/holds.ts").match(/payoutWaitReminders/g)?.length).toBe(1); // only in the sweep
  });

  it("refusals name the press: Charge / Let it go, Leave, Invite anyway; new terms read exactly", () => {
    expect(refusalLine("Charge", ANSWER_TERMS_FIRST)).toBe(ANSWER_TERMS_FIRST);
    expect(refusalLine("Charge", "Nora Lane paid $10.00 for this meanwhile.")).toBe("Your Charge didn't go through: Nora Lane paid $10.00 for this meanwhile.");
    expect(src("app/app/sessions/[id]/ChoiceBox.tsx")).toContain("refusalLine(pressed, err)");
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain('refusalLine("Leave", err)');
    expect(src("app/app/tests/[id]/InvitePanel.tsx")).toContain('didntGo press="Invite anyway"');
  });

  it("the in-page notice is one element put back at once after a redraw (it blinked)", () => {
    const k = src("components/KeptRefusal.tsx");
    expect(k).toContain("new MutationObserver(");
    expect(k).toContain("if (hostRef.current.parentElement !== anchor) anchor.appendChild(hostRef.current);");
  });
});

describe("batch 32 §13: Let it go has a tick, not a pop-up", () => {
  it("the button stays disabled until the tick; the tick says what it means", async () => {
    const { letGoTickLabel } = await import("@/lib/rules");
    expect(letGoTickLabel("Nora Lane")).toBe("Let it go won't charge Nora Lane, and you won't be paid for this");
    const box = src("app/app/sessions/[id]/ChoiceBox.tsx");
    expect(box).toContain('disabled={busy || !letGo} onClick={() => go("letgo")}>Let it go</button>');
    expect(box).not.toContain('title="Let it go?"');
  });
});

describe("batch 32 §14: the agreed scope's then-and-now boxes scroll", () => {
  it("the Updated tag's Before / Now and the history's Before and after are block scroll boxes", () => {
    expect(src("components/ListingInfo.tsx").match(/block max-h-32 overflow-y-auto/g)?.length).toBe(2);
    expect(src("app/app/sessions/[id]/page.tsx").match(/block max-h-32 overflow-y-auto/g)?.length).toBe(2);
  });
});

describe("batch 32 §15: a tester's Charge on a developer with no saved card", () => {
  it("is handled as a declined card (payment hold, owed, the tester reads 'delayed'), never sent to Stripe empty", async () => {
    const { setStripeForTests, NO_CARD_SAVED } = await import("@/lib/server/stripe");
    const { sact, seen, settle } = await import("./fixtures");
    let calls = 0;
    setStripeForTests({ paymentIntents: { create: async () => { calls++; return { id: "pi_x", status: "succeeded" }; } } } as never);
    try {
      const { dev, testId } = await setup();
      const { tester, sessionId } = await joined(testId);
      expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true })).status).toBe(200);
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
      await db.submission.update({ where: { id: sub.id }, data: { choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 7 * 86_400_000) } });
      await db.user.update({ where: { id: dev.user.id }, data: { stripeCustomerId: null, stripePaymentMethodId: null } });
      await settle();
      const r = await sact(sessionId, "choose", tester.cookie, { submissionId: sub.id, choice: "charge", seenAt: seen(), confirmed: true });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe("failed");
      expect(calls).toBe(0);
      expect(await db.payment.findFirst({ where: { submissionId: sub.id } })).toMatchObject({ status: "failed", failure: NO_CARD_SAVED });
      expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).holdStartedAt).not.toBeNull();
      expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "may be delayed" } } })).toBeGreaterThan(0);
    } finally {
      setStripeForTests(null);
    }
  });
  it("a refusal after the stop box's second press clears the stop box", () => {
    expect(src("app/app/sessions/[id]/ChoiceBox.tsx")).toContain("setBox(null);\n          setErr(errOf(e));");
  });
});

// (Batch 34 §5, owner) §16 and §17 are undone: the in-between switch page is gone (a GET only opens the page asked for, from anywhere, never switching),
// and coming back from Stripe leaves the side as it is.
describe("batch 32 §16, undone by batch 34 §5: no in-between switch page", () => {
  it("a GET of /app/switch redirects to the page for every kind of visit and never switches", async () => {
    const { GET } = await import("@/app/app/switch/route");
    const { makeUser } = await import("./helpers");
    const { db } = await import("@/lib/db");
    const both = await makeUser({ tester: true, dev: true, name: "Bo Both" });
    await db.user.update({ where: { id: both.user.id }, data: { side: "developer" } });
    for (const site of ["same-origin", "same-site", "none", "cross-site", undefined]) {
      const r = await GET(new Request("http://localhost:3400/app/switch?to=tester&next=/app/find", { headers: { cookie: both.cookie, ...(site ? { "sec-fetch-site": site } : {}) } }));
      expect(r.headers.get("location"), String(site)).toBe("http://localhost:3400/app/find");
      expect(await r.text(), String(site)).not.toContain("<script>");
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: both.user.id } })).side).toBe("developer");
  });
});

describe("batch 32 §17, undone by batch 34 §5: back from Stripe the side stays as it is", () => {
  it("card-saved and payout-return don't touch the side", () => {
    for (const route of ["card-saved", "payout-return"]) expect(src(`app/api/payments/${route}/route.ts`), route).not.toMatch(/side:|hasSide/);
  });
});

describe("batch 32 §18: each paid line says what it was for", () => {
  it("names the tester, part and test, how it was paid, and a reversed payment", async () => {
    const { paidRows } = await import("@/lib/server/paymentRows");
    const { CHARGED_BY_TESTER } = await import("@/lib/rules");
    const { dev, testId } = await setup({ title: "Harbor Run" } as never);
    const { tester, sessionId } = await joined(testId, "Ana Silva");
    const { sact, seen } = await import("./fixtures");
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await db.review.create({ data: { submissionId: sub.id, contractId: sessionId, amountCents: 1000, agreedCents: 1000, reason: CHARGED_BY_TESTER, payKey: "k-" + sub.id } });
    const p = await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "charged", chargebackAt: new Date() } });
    const title = (await db.test.findUniqueOrThrow({ where: { id: testId } })).title;
    const devRow = (await paidRows([p], "developer")).get(p.id)!;
    expect(devRow.what).toBe(`Ana Silva's written answers on “${title}”`);
    expect(devRow.how).toBe("charged by Ana Silva after 7 days without a review");
    expect(devRow.reversed).toBe(true);
    expect((await paidRows([p], "tester")).get(p.id)!.how).toBe("charged by you after 7 days without a review");
  });
});

describe("a chargeback on a chargeback's repayment", () => {
  it("is a new chargeback: the repayment is owed again with a second fee; the first stays repaid", async () => {
    const { chargebackOpened, owed } = await import("@/lib/server/holds");
    const { CHARGEBACK_FEE_CENTS } = await import("@/lib/rules");
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    const first = await db.payment.create({ data: { kind: "review", contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "charged", stripePaymentIntentId: "pi_cb1_" + sessionId } });
    expect(await chargebackOpened(first.stripePaymentIntentId!)).toBe(true);
    expect((await owed(dev.user.id)).reduce((a, p) => a + p.amountCents, 0)).toBe(1000 + CHARGEBACK_FEE_CENTS);
    // Pay what you owe repaid it…
    const repay = await db.payment.create({ data: { kind: "chargeback", repaysId: first.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000 + CHARGEBACK_FEE_CENTS, feeCents: 1000 + CHARGEBACK_FEE_CENTS, testerCents: 0, status: "charged", stripePaymentIntentId: "pi_cb2_" + sessionId } });
    expect(await owed(dev.user.id)).toHaveLength(0);
    // …and that repayment is charged back too.
    expect(await chargebackOpened(repay.stripePaymentIntentId!)).toBe(true);
    const now = await owed(dev.user.id);
    expect(now.map((p) => p.id)).toEqual([repay.id]);
    expect(now[0].amountCents).toBe(1000 + CHARGEBACK_FEE_CENTS + CHARGEBACK_FEE_CENTS);
    const u = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    expect(u.holdReason).toBe("chargeback");
    expect(u.chargebackApprovedAt).toBeNull();
  });
});
