import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { GET as cronGET } from "@/app/api/cron/daily/route";
import { chargeAmount, paidMeanwhileLine } from "@/lib/rules";
import { json, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 3, batch 35 §163; replaces the Oct 26 rule "Charge offers the listing minus what was paid") Once the developer paid anything on a part, the tester's
// Charge and Let it go are gone for that part: the way to more is Dispute. An older page's (or a same-moment) press gets ONE final refusal, never a stop-once.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/s", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const cron = () => cronGET(new Request("http://localhost:3400/api/cron/daily", { headers: { authorization: "Bearer cron-test" } })).then((r) => r.json());
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);

/** Ana's written answers ($10.00 listing) past the review days and her deadline: Charge opens on the next daily job. */
async function due() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await db.submission.update({ where: { id: sub.id }, data: { payBy: new Date(Date.now() - 1000) } });
  await db.test.update({ where: { id: s.testId }, data: { openUntil: new Date(Date.now() - 1000) } });
  await db.contract.updateMany({ where: { testId: s.testId }, data: { dueAt: new Date(Date.now() - 1000) } });
  await settle();
  return { ...s, ...j, sub };
}
const choose = (w: Awaited<ReturnType<typeof due>>, choice: "charge" | "letgo", body: Record<string, unknown> = {}) => sact(w.sessionId, "choose", w.tester.cookie, { submissionId: w.sub.id, choice, ...body });
const testerPage = async (w: Awaited<ReturnType<typeof due>>) => {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: w.tester.user.id } });
  const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
  return render(await SessionPage({ params: Promise.resolve({ id: w.sessionId }) }));
};
const CHARGE_BOX = 'aria-label="Amount to charge"';

describe("§163: Charge and Let it go are gone once the developer paid anything on the part", () => {
  it("the rule and the line", () => {
    expect(chargeAmount(1000, 0)).toBe(1000);
    expect(chargeAmount(1000, 400)).toBe(0);
    expect(chargeAmount(null, 0)).toBe(0);
    expect(paidMeanwhileLine("Nora Lane", 600)).toBe("Nora Lane paid $6.00 for this meanwhile: you can dispute it if you think it should be more.");
    expect(paidMeanwhileLine("Nora Lane", 1000)).toBe("Nora Lane paid $10.00 for this meanwhile: you can dispute it if you think it should be more.");
    expect(paidMeanwhileLine("Nora Lane", 600, 200)).toBe("Nora Lane paid $6.00 and $2.00 more for this meanwhile: you can dispute it if you think it should be more.");
    expect(paidMeanwhileLine("Nora Lane", 0, 200)).toBe("Nora Lane paid $2.00 more for this meanwhile: you can dispute it if you think it should be more.");
  });

  it("a partial Pay ($6.00): the tester's page has no Charge or Let it go, and offers Dispute; the daily job offers nothing", async () => {
    const w = await due();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "6.00", tickedCents: 600, reason: "Only part of it was useful" })).status).toBe(200);
    await cron();
    expect((await db.submission.findUniqueOrThrow({ where: { id: w.sub.id } })).choiceOfferedAt).toBeNull();
    expect(await db.notification.count({ where: { userId: w.tester.user.id, text: { startsWith: "Charge or let go" } } })).toBe(0);
    expect(await db.notification.count({ where: { userId: w.dev.user.id, text: { startsWith: "Pay now" } } })).toBe(0);
    const html = await testerPage(w);
    expect(html).not.toContain(CHARGE_BOX);
    expect(html).not.toContain("Let it go");
    expect(html).toContain("Dispute the pay");
  });

  it("a page from before the developer's Pay: Charge and Let it go are refused on the FIRST press, naming what was paid (and a Pay more)", async () => {
    const w = await due();
    await cron();
    expect((await db.submission.findUniqueOrThrow({ where: { id: w.sub.id } })).choiceOfferedAt).not.toBeNull();
    const loaded = seen(); // the tester's page, with Charge on it
    await settle();
    expect((await pay(w.dev.cookie, { kind: "submission", id: w.sub.id, amount: "6.00", tickedCents: 600, reason: "Only part of it was useful" })).status).toBe(200);
    for (const choice of ["charge", "letgo"] as const) {
      const r = await choose(w, choice, { seenAt: loaded, loadedAt: loaded, ...(choice === "charge" ? { amount: "10.00" } : {}) });
      expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([409, "done", "Nora Lane paid $6.00 for this meanwhile: you can dispute it if you think it should be more."]);
    }
    expect((await act(w.testId, "pay-extra", w.dev.cookie, { seenAt: seen(), contractId: w.sessionId, submissionId: w.sub.id, amount: "2.00", tickedCents: 200, payKey: randomUUID() })).status).toBe(200);
    const r = await choose(w, "charge", { seenAt: loaded, loadedAt: loaded, amount: "10.00" });
    expect(r.body.error).toMatchObject({ code: "done", message: "Nora Lane paid $6.00 and $2.00 more for this meanwhile: you can dispute it if you think it should be more." });
    // Paid in full: the same wording with the full amount.
    const f = await due();
    await cron();
    const fl = seen();
    await settle();
    expect((await pay(f.dev.cookie, { kind: "submission", id: f.sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    expect((await choose(f, "charge", { seenAt: fl, loadedAt: fl, amount: "10.00" })).body.error.message).toBe("Nora Lane paid $10.00 for this meanwhile: you can dispute it if you think it should be more.");
  });

  it("Charge and Pay at the same moment, both orders: one goes through, the other is one final refusal (never a stop-once), charged once", async () => {
    // Pay lands first, then the Charge from the older page.
    const a = await due();
    await cron();
    const aLoaded = seen();
    await settle();
    expect((await pay(a.dev.cookie, { kind: "submission", id: a.sub.id, amount: "6.00", tickedCents: 600, reason: "Partly useful" })).status).toBe(200);
    expect((await choose(a, "charge", { seenAt: aLoaded, amount: "10.00" })).body.error.code).toBe("done");
    // The Charge lands first, then the developer's Pay from the older page.
    const b = await due();
    await cron();
    const bLoaded = seen();
    await settle();
    expect((await choose(b, "charge", { seenAt: seen(), confirmed: true })).status).toBe(200);
    const p = await pay(b.dev.cookie, { kind: "submission", id: b.sub.id, amount: "6.00", tickedCents: 600, reason: "Partly useful", seenAt: bLoaded, confirmed: false });
    expect([p.status, p.body.error?.code, p.body.error?.message]).toEqual([409, "reviewed", "Ana Silva already charged $10.00 for her written answers."]);
    // Truly at once: exactly one wins; the loser's answer is a refusal, never a stop.
    for (let i = 0; i < 2; i++) {
      const c = await due();
      await cron();
      const loaded = seen();
      await settle();
      const [x, y] = await Promise.all([
        pay(c.dev.cookie, { kind: "submission", id: c.sub.id, amount: "6.00", tickedCents: 600, reason: "Partly useful", seenAt: loaded, confirmed: false }),
        choose(c, "charge", { seenAt: loaded, amount: "10.00" }),
      ]);
      expect([x.status, y.status].filter((s) => s === 200)).toHaveLength(1);
      for (const r of [x, y]) if (r.status !== 200) expect(r.body.error.code).not.toBe("stop_once");
      expect(await db.review.count({ where: { submissionId: c.sub.id } })).toBe(1);
      expect(await db.payment.count({ where: { submissionId: c.sub.id, status: { in: ["charged", "not_set_up"] } } })).toBe(1);
    }
  });

  it("a cancelled (or declined) payment that left nothing paid: Charge is as before, for the full listing", async () => {
    const w = await due();
    await db.payment.create({ data: { kind: "review", submissionId: w.sub.id, contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 600, feeCents: 0, testerCents: 0, status: "cancelled" } });
    await db.payment.create({ data: { kind: "review", submissionId: w.sub.id, contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 600, feeCents: 0, testerCents: 0, status: "failed", failure: "declined" } });
    await cron();
    expect((await db.submission.findUniqueOrThrow({ where: { id: w.sub.id } })).choiceOfferedAt).not.toBeNull();
    expect(await testerPage(w)).toContain(CHARGE_BOX);
    expect((await choose(w, "charge", { seenAt: seen(), confirmed: true })).body).toMatchObject({ choice: "charge", amountCents: 1000 });
  });

  it("money that went through without a Pay row of the page's (a payment recorded on the part): still no Charge, the same refusal", async () => {
    const w = await due();
    await cron();
    await db.payment.create({ data: { kind: "review", submissionId: w.sub.id, contractId: w.sessionId, developerId: w.dev.user.id, testerId: w.tester.user.id, amountCents: 600, feeCents: 0, testerCents: 0, status: "charged" } });
    expect(await testerPage(w)).not.toContain(CHARGE_BOX);
    expect((await choose(w, "letgo", { seenAt: seen() })).body.error.message).toBe("Nora Lane paid $6.00 for this meanwhile: you can dispute it if you think it should be more.");
  });
});
