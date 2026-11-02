import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { makeUser } from "./helpers";
import { joined, setup } from "./fixtures";

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, requireOpenPage: async () => auth.user, adminAway() {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

async function serverTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(React.Children.toArray(node).map(serverTree));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === "function" && element.type.constructor.name === "AsyncFunction") {
    const resolved = await (element.type as (props: unknown) => Promise<ReactNode>)(element.props);
    return serverTree(isValidElement(resolved) && element.key !== null ? cloneElement(resolved, { key: element.key }) : resolved);
  }
  return element.props.children === undefined ? element : cloneElement(element, {}, await serverTree(element.props.children));
}
async function fixture(status = "charged", count = 6, suspended = false) {
  const f = await setup(), j = await joined(f.testId);
  auth.user = await db.user.update({ where: { id: f.dev.user.id }, data: { side: "developer", holdStartedAt: new Date(), holdReason: "unpaid", holdCount: count, holdApprovedAt: null, devSuspendedAt: suspended ? new Date() : null } });
  await db.payment.create({ data: { developerId: f.dev.user.id, testerId: j.tester.user.id, contractId: j.sessionId, kind: "review", status, amountCents: 500, feeCents: 100, testerCents: 400, owedUntil: new Date(), settledAt: status === "charged" ? new Date() : null, ...(["needs_action", "needs_confirmation"].includes(status) ? { actionPi: "pi_test_" + randomUUID(), actionBy: new Date(Date.now() + 86400000) } : {}) } });
  const { default: Dashboard } = await import("@/app/app/page");
  const html = renderToStaticMarkup(await serverTree(await Dashboard({ searchParams: Promise.resolve({}) })));
  return html.match(/<section[^>]*data-restricted-box=""[\s\S]*?<\/section>/)?.[0] ?? "";
}

describe("a paid payment hold names the approval it still needs", () => {
  it("the sixth hold with charged payments and old failure markers says paid / waiting, with no Pay what you owe link", async () => {
    const html = await fixture();
    expect(html).toContain('data-hold-paid=""');
    expect(html).toContain("Your balance is paid. This hold is waiting for the team’s approval.");
    expect(html).not.toContain("Pay what you owe");
    expect(html).not.toContain("After you pay");
  });
  it.each(["failed", "owed", "paying", "pending", "needs_action", "needs_confirmation"])("%s remains outstanding, so the dashboard does not claim the balance is paid", async (status) => {
    const html = await fixture(status);
    expect(html).not.toContain('data-hold-paid=""');
    expect(html).toContain("Pay what you owe");
  });
  it("the first three holds do not claim they need team approval", async () => {
    const html = await fixture("charged", 3);
    expect(html).not.toContain('data-hold-paid=""');
    expect(html).not.toContain("waiting for the team");
  });
  it("a separate suspension is still named alongside the paid hold, without promising that paying lifts it", async () => {
    const html = await fixture("charged", 6, true);
    expect(html).toContain("Your account is suspended.");
    expect(html).toContain('data-hold-paid=""');
    expect(html).not.toContain("Pay what you owe");
  });
  it("an actual tester-only suspension shows the dispute reminder even when no developer restriction kind exists", async () => {
    const tester = await makeUser({ tester: true });
    auth.user = await db.user.update({ where: { id: tester.user.id }, data: { side: "tester", testerSuspendedAt: new Date(), devSuspendedAt: null, holdStartedAt: null } });
    const { default: Dashboard } = await import("@/app/app/page");
    const html = renderToStaticMarkup(await serverTree(await Dashboard({ searchParams: Promise.resolve({}) })));
    expect(html).toContain("You can still dispute payments for work you sent");
    expect(html).toContain("What you sent is still reviewed and paid as usual.");
    expect(html).toContain('data-suspended-box=""');
  });

});
