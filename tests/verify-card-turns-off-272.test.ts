import { randomUUID } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { POST as verifyPOST } from "@/app/api/payments/verify-card/route";
import { ChargebackSteps } from "@/components/ChargebackSteps";
import { CARD_ALREADY_VERIFIED, chargebackSteps } from "@/lib/server/chargeback";
import { chargebackOpened } from "@/lib/server/holds";
import { dashboardV, paymentsV } from "@/lib/server/pageFreshness";
import { owedV, testV } from "@/lib/server/pulseV";
import { json, req } from "./helpers";
import { joined, sact, setup } from "./fixtures";

// (Owner, Nov 5, §272) The developer verified the card in one tab; the other tab's Verify a card stayed enabled until a press was refused. Once the card is
// verified, every open page's Verify a card turns off on its next update (the page's poll redraws it), without a press.

vi.mock("next/navigation", () => ({ usePathname: () => "/app/payments", useRouter: () => ({ refresh() {} }), useSearchParams: () => new URLSearchParams(), notFound() { throw new Error("notFound"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

/** A developer on a chargeback hold (a paid piece reversed), card not verified yet. */
async function chargedBack() {
  const { dev, testId } = await setup();
  const { tester, sessionId } = await joined(testId);
  await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
  const pi = "pi_" + randomUUID();
  await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 800, feeCents: 160, testerCents: 640, status: "charged", stripePaymentIntentId: pi } });
  expect(await chargebackOpened(pi)).toBe(true);
  return { dev, testId };
}

const pulse = async (cookie: string, query: string) => (await json(await pulseGET(req(`/api/pulse?${query}`, { cookie, method: "GET" })))).body.v as string;
const drawn = async (devId: string) => renderToStaticMarkup(React.createElement(ChargebackSteps, { steps: (await chargebackSteps(devId))! }));
const verifyButton = (html: string) => /<button[^>]*>Verify a card<\/button>/.exec(html)?.[0] ?? null;

describe("§272 Verify a card turns off on every open page once verified", () => {
  it("verifying changes the Payments, test and dashboard versions; the redraw shows the step done with no Verify a card", async () => {
    const { dev, testId } = await chargedBack();
    const me = () => db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    // Tab 2, before: the step not done and Verify a card offered.
    const before = await drawn(dev.user.id);
    expect(before).toContain('data-step-ok="no"');
    expect(verifyButton(before)).not.toBeNull();
    expect(verifyButton(before)).not.toContain("disabled");
    const v0 = { fresh: await pulse(dev.cookie, "fresh=payments"), owed: await pulse(dev.cookie, "owed=1"), payments: await paymentsV(await me()), test: await testV(dev.user.id, testId), dashboard: await dashboardV(await me()) };

    // Tab 1 verifies the card (simulated without Stripe).
    expect((await json(await verifyPOST(req("/api/payments/verify-card", { cookie: dev.cookie, body: {} })))).body).toEqual({ simulated: true, verified: true });

    // Every version an open page polls moved: its next update redraws it.
    expect(await pulse(dev.cookie, "fresh=payments")).not.toBe(v0.fresh);
    expect(await pulse(dev.cookie, "owed=1")).not.toBe(v0.owed);
    expect(await paymentsV(await me())).not.toBe(v0.payments);
    expect(await testV(dev.user.id, testId)).not.toBe(v0.test);
    expect(await dashboardV(await me())).not.toBe(v0.dashboard);

    // The redraw: the card step ticked in the same done style as the other steps, and no Verify a card (nor a card form) left to press.
    const after = await drawn(dev.user.id);
    expect(after).toMatch(/<li[^>]*data-step-ok="yes"[^>]*><svg[^>]*text-emerald-300[^>]*aria-label="done"[\s\S]*?A card verified with 3D Secure<\/li>/);
    expect(verifyButton(after)).toBeNull();
    expect(after).not.toContain("Verify this card");
    expect(after).not.toContain("data-card-form");
    expect((await chargebackSteps(dev.user.id))!.remaining).not.toContain("Verify a card with 3D Secure");

    // A press that still lands before the update keeps its refusal.
    const late = await json(await verifyPOST(req("/api/payments/verify-card", { cookie: dev.cookie, body: { check: true } })));
    expect(late.status).toBe(409);
    expect(late.body.error).toMatchObject({ code: "already_verified", message: CARD_ALREADY_VERIFIED });
  });

  it("the open card form's Verify this card goes on the redraw too (unless a press is in flight)", async () => {
    const { readFileSync } = await import("node:fs");
    const box = readFileSync("src/components/ChargebackSteps.tsx", "utf8");
    expect(box).toContain("{!steps.cardVerified && !form && (");
    expect(box).toContain("{form && (!steps.cardVerified || busy) && (");
  });
});
