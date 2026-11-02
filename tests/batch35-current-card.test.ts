import React, { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { savedCardLine } from "@/lib/server/savedCard";
import { setStripeForTests } from "@/lib/server/stripe";
import { makeUser } from "./helpers";

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, adminAway() {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/payments", useRouter: () => ({ refresh() {} }), useSearchParams: () => new URLSearchParams() }));
(globalThis as unknown as { React: typeof React }).React = React;
afterEach(() => setStripeForTests(null));

const card = { stripePaymentMethodId: "pm_current", cardExpMonth: 1, cardExpYear: 2028 };
function provider(value: unknown) {
  const retrieve = vi.fn(async () => value);
  setStripeForTests({ paymentMethods: { retrieve } } as unknown as Stripe);
  return retrieve;
}
function section(node: ReactNode): ReactElement | undefined {
  if (Array.isArray(node)) return node.map(section).find(Boolean);
  if (!isValidElement(node)) return;
  const e = node as ReactElement<{ id?: string; children?: ReactNode }>;
  return e.props.id === "card" ? e : section(e.props.children);
}

describe("Payments identifies the current saved card", () => {
  it("shows brand, last four and the current provider expiry", async () => {
    const retrieve = provider({ type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } });
    expect(await savedCardLine(card)).toBe("Visa ending 4242 · expires 12/2030");
    expect(retrieve).toHaveBeenCalledWith("pm_current", {}, { timeout: 5000, maxNetworkRetries: 0 });
  });

  it("no card performs no lookup; an unavailable provider leaves a usable saved-card fallback", async () => {
    const retrieve = provider(null);
    expect(await savedCardLine({ ...card, stripePaymentMethodId: null })).toBe("No card yet.");
    expect(retrieve).not.toHaveBeenCalled();
    retrieve.mockRejectedValue(new Error("provider unavailable"));
    expect(await savedCardLine(card)).toBe("A card is saved · expires 01/2028.");
  });

  it("identifies Link without falsely describing it as a numbered card", async () => {
    provider({ type: "link", link: { email: "person@playtest.test" } });
    expect(await savedCardLine(card)).toBe("Link · person@playtest.test");
  });

  it("the Card box shows the actual saved method and follows a replacement", async () => {
    const { user } = await makeUser({ dev: true });
    auth.user = user;
    const retrieve = provider({ type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } });
    const { default: Page } = await import("@/app/app/payments/page");
    const render = async () => renderToStaticMarkup(section(await Page({ searchParams: Promise.resolve({}) }))!);
    const html = await render();
    expect(html).toContain("Visa ending 4242");
    expect(html).toContain("expires 12/2030");
    expect(html).toContain("Change card");
    expect(html).not.toContain("A card is saved.");
    retrieve.mockResolvedValue({ type: "card", card: { brand: "mastercard", last4: "4444", exp_month: 2, exp_year: 2031 } });
    const changed = await render();
    expect(changed).toContain("Mastercard ending 4444");
    expect(changed).not.toContain("4242");
  });
});
