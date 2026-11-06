import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CancelMenu } from "@/components/CancelMenu";

describe("(Owner, Nov 6) §293 the cancel reason's small grey hint", () => {
  it("24 hours or more ahead: 'Optional until 24 hours before the call' under the field", () => {
    const html = renderToStaticMarkup(createElement(CancelMenu, { needsReason: false, busy: false, other: "Ana Silva", onCancel: () => {} }));
    expect(html).toContain('data-why-optional="">Optional until 24 hours before the call</p>');
  });
  it("less than 24 hours ahead: required, no 'optional' hint", () => {
    const html = renderToStaticMarkup(createElement(CancelMenu, { needsReason: true, busy: false, other: "Ana Silva", onCancel: () => {} }));
    expect(html).not.toContain("data-why-optional");
    expect(html).toContain('data-required=""');
  });
});
