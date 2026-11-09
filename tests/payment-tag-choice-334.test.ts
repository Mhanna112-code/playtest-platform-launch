import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { TesterPaymentTag } from "@/components/TesterPaymentTag";
import { joined, sact, setup } from "./fixtures";

// (Owner, Nov 9, §334) "Waiting for review" is hidden while the tester's Charge / Let it go is open on that piece; everywhere else the badge stays.
const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, adminAway: () => {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/test", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;
const DAY = 86_400_000;

async function writtenPart(sessionId: string) {
  const { default: Page } = await import("@/app/app/sessions/[id]/page");
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: sessionId }) }));
  const part = html.match(/<li id="part-written"[\s\S]*?<\/li>/)?.[0];
  expect(part).toBeTruthy();
  return part!;
}

describe("§334 no “Waiting for review” above an open Charge / Let it go", () => {
  it("the tag: hidden (anchor kept) only for the waiting state when the choice is open", () => {
    const hidden = renderToStaticMarkup(createElement(TesterPaymentTag, { anchor: "payment-x", choiceOpen: true }));
    expect(hidden).toBe('<span id="payment-x" data-part-status="choice"></span>');
    expect(renderToStaticMarkup(createElement(TesterPaymentTag, { anchor: "payment-x" }))).toContain("Waiting for review");
    // Another state with the choice open still shows (e.g. a delayed payment).
    expect(renderToStaticMarkup(createElement(TesterPaymentTag, { choiceOpen: true, delayed: true }))).toContain("Payment delayed");
  });

  it("the session page: the badge shows while waiting, and goes once Charge / Let it go opens on that piece", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Alex Morgan", "they");
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: tester.user.id } });
    const before = await writtenPart(sessionId);
    expect(before).toContain('data-part-status="review">Waiting for review</span>');

    await db.submission.update({ where: { id: sub.id }, data: { agreedCents: 1000, choiceOfferedAt: new Date(), choiceBy: new Date(Date.now() + 14 * DAY) } });
    const open = await writtenPart(sessionId);
    expect(open).not.toContain("Waiting for review");
    expect(open).toContain(`id="payment-${sub.id}" data-part-status="choice"`);
    expect(open).toMatch(/>Charge/); // the Charge / Let it go box is there
  });
});
