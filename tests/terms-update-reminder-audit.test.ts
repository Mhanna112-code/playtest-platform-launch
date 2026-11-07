import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import TermsPage from "@/app/terms/page";
import { EMAIL_TIMING_TERMS, PAUSE_DEADLINE_TERMS, PAYMENT_RULES, TERMS_VERSION } from "@/lib/termsOfUse";
vi.mock("@/lib/server/page-auth", () => ({ getPageUser: async () => null }));
(globalThis as { React?: typeof React }).React = React;

const text = () => renderToStaticMarkup(React.createElement(React.Fragment, null, TermsPage().props.children)).replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');

describe("Terms update: current reminder, pause and NDA rules", () => {
  it("publishes the email exceptions without promising same-evening delivery", () => {
    const page = text();
    expect(page).toContain(EMAIL_TIMING_TERMS);
    expect(EMAIL_TIMING_TERMS).toContain("New chargeback notices and the 15-minute call reminder are emailed immediately");
    expect(EMAIL_TIMING_TERMS).toContain("even with emails off");
    expect(page).not.toContain("same evening");
    expect(PAYMENT_RULES.find((x) => x.heading === "Bank checks, declines, holds")!.text).toContain("Changes to the amount reversed are included in the daily email");
  });
  it("explains expired-during-pause deadlines and NDA acknowledgement separately from Switch or Keep", () => {
    const page = text();
    expect(page).toContain(PAUSE_DEADLINE_TERMS);
    expect(PAUSE_DEADLINE_TERMS).toContain("even if their old deadline passed during the pause");
    expect(PAUSE_DEADLINE_TERMS).toContain("A deadline already past when the pause began stays past");
    expect(page).toContain("You can still leave or rate the test without acknowledging it");
    expect(page).toContain("Questions and listing information follow the current listing");
    expect(page).toContain("each new addition to an answer, needs at least 50 characters");
    expect(page).toContain("directly or through a relay");
    expect(page).not.toMatch(/\b(she|her|he|his)\b/i);
    expect(TERMS_VERSION).toBe(2); // Batch 35: update the prelaunch draft in place.
  });
});
