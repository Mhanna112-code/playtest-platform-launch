import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwedBox } from "@/components/OwedBox";
import { adminReservedLine, reservedAddedLine } from "@/lib/rules";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());
const render = (reservedCents: number) => renderToStaticMarkup(React.createElement(OwedBox, { onHold: true, chargeback: true, reservedCents, owed: [{ id: "owed", retry: true, amountCents: 1000, until: null, text: "Written answers" }] }));

describe("Batch 34 §3: the reserved Pay what you owe", () => {
  it("relabels the disabled button while keeping its bright style", () => {
    const html = render(2700);
    const button = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(button).toContain("$10.00 is charged after the team approves");
    expect(button).toContain('disabled=""');
    expect(button).toContain('aria-disabled="true"');
    expect(button).toContain('class="btn"');
    expect(button).not.toContain("grey");
    expect(html).not.toContain("added since");
  });
  it("keeps the ordinary Pay label before a reservation", () => {
    const button = render(0).match(/<button\b[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(button).toContain("Pay what you owe ($10.00)");
    expect(button).not.toContain('disabled=""');
  });
  it("uses only the reservation sentence for the developer and keeps the admin's added amount", () => {
    expect(reservedAddedLine(2700, 1000)).toBe("Reserved $27.00: it's taken when the team approves lifting your hold.");
    expect(reservedAddedLine(2700, 0)).toBe(reservedAddedLine(2700, 1000));
    expect(adminReservedLine(2700, 1000)).toBe("$27.00 reserved · $10.00 added since (charged after the hold lifts)");
  });
});
