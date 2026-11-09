import React, { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PAYMENT_RULES, TERMS_VERSION, WHAT_CHANGED } from "@/lib/termsOfUse";

// (Owner, Nov 9, §343) The Terms state the current rules in place: no new version, no version history, no re-accept tick for this update.
vi.mock("@/lib/server/page-auth", () => ({ getPageUser: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/terms", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams() }));
(globalThis as unknown as { React: typeof React }).React = React;
const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
async function page() {
  const { default: TermsPage } = await import("@/app/terms/page");
  const el = TermsPage() as React.ReactElement<{ children: React.ReactNode }>;
  return unescape(render(h(React.Fragment, null, el.props.children)));
}
const rule = (heading: string) => PAYMENT_RULES.find((r) => r.heading === heading)!.text;

describe("§343 the Terms updated in place", () => {
  it("no version bump and no new What changed entry: nobody is asked to agree again", () => {
    expect(TERMS_VERSION).toBe(2);
    expect(WHAT_CHANGED.map((w) => w.version)).toEqual([2]);
  });

  it("the rules: closed tests, rejoining, withdrawals, rating, calls, outages", async () => {
    const html = await page();
    expect(html).toContain("A closed test can't be edited.");
    expect(html).toContain("Coming back gives you the time that was left on your deadline, on the listing as it is then (its NDA included); work you sent before leaving keeps the dates it had.");
    expect(html).toContain("Requests, applications and invitations can be withdrawn or cancelled until the other side answers.");
    expect(html).not.toContain("offers can be withdrawn");
    expect(html).toContain("no-show or late");
    expect(html).toContain("Rating finishes your part on the test: after it you can't open a dispute or rejoin.");
    expect(html).toContain("at most 3 calls booked or requested at once, and each can send the other at most 3 call requests a day");
    expect(html).toContain("within 24 hours of it you must say why (the other side reads it).");
    expect(html).toContain("When a test is paused, calls starting within 3 days are cancelled with no fault on either side");
    expect(html).toContain("a call that fell inside it is missed, with nothing charged; you can request a new time.");
  });

  it("the money rules: unlisted calls close at 7 days, pauses stop a press once, a leave follows Alerts on bank confirmations, §122, the 4th hold", () => {
    expect(rule("Calls")).toContain("if it isn't paid 7 days after it took place, it closes with nothing paid");
    expect(rule("Unlisted work")).toContain("A call that isn't listed and isn't paid 7 days after it took place closes with nothing paid");
    expect(rule("Changes while you pay")).toContain("for Confirm with your bank and Confirm all, the tester leaving follows your Testers leaving Alerts.");
    expect(rule("Changes while you pay")).toContain("A pause of the test since your page loaded (a hold, a suspension or our team’s pause), or its lift, stops a press once, whatever your Alerts.");
    expect(rule("Bank checks, declines, holds")).toContain("If a hold starts while such a charge waits for the bank, its check is cancelled and it's charged when the hold lifts");
    expect(rule("Bank checks, declines, holds")).toContain("From an account's 4th payment hold on, paying isn't enough: the tests resume once our team approves lifting the hold.");
  });
});
