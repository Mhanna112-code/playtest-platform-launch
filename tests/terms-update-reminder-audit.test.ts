import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import TermsPage from "@/app/terms/page";
import { DEADLINE_MOVEMENT_TERMS, EMAIL_TIMING_TERMS, PAYMENT_RULES, TERMS_VERSION } from "@/lib/termsOfUse";
vi.mock("@/lib/server/page-auth", () => ({ getPageUser: async () => null }));
(globalThis as { React?: typeof React }).React = React;

const text = () => renderToStaticMarkup(React.createElement(React.Fragment, null, TermsPage().props.children)).replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');

describe("Terms update: current reminder, pause and NDA rules", () => {
  it("publishes the email exceptions without promising same-evening delivery", () => {
    const page = text();
    expect(page).toContain(EMAIL_TIMING_TERMS);
    expect(EMAIL_TIMING_TERMS).toContain("New chargeback notices and the 24-hour call reminder are emailed immediately"); // (Codex a76b63bf: the call reminder is 24 hours ahead)
    expect(EMAIL_TIMING_TERMS).toContain("even with emails off");
    expect(page).not.toContain("same evening");
    expect(PAYMENT_RULES.find((x) => x.heading === "Bank checks, declines, holds")!.text).toContain("Changes to the amount reversed are included in the daily email");
  });
  it("explains expired-during-pause deadlines and NDA acknowledgement separately from Switch or Keep", () => {
    const page = text();
    // (Codex eacf5cf3) Section 4's "Deadline extensions, pauses and outages" (DEADLINE_MOVEMENT_TERMS) now holds the pause rules.
    expect(page).toContain(DEADLINE_MOVEMENT_TERMS.replace(/'/g, "'"));
    expect(DEADLINE_MOVEMENT_TERMS).toContain("even if the old deadline passed during the pause");
    expect(DEADLINE_MOVEMENT_TERMS).toContain("an already-expired deadline stays expired");
    expect(page).toContain("You can still leave or rate the test without acknowledging it");
    expect(page).toContain("Keep does not preserve an older version of the rest of the listing: other edits apply where relevant, including the questions"); // (Codex eacf5cf3)
    expect(page).toContain("each new addition to an answer, needs at least 50 characters");
    expect(page).toContain("directly or through a relay");
    expect(page).not.toMatch(/\b(she|her|he|his)\b/i);
    expect(TERMS_VERSION).toBe(2); // Batch 35: update the prelaunch draft in place.
  });
});
