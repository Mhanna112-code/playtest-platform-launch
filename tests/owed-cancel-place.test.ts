import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwedBox } from "@/components/OwedBox";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

// (Owner, Nov 5) Pay what you owe's open check: "Cancel this check" sits once, under "Pay what you owe ($X) is waiting for your bank…", not on the first row it
// covers. A row with its own check keeps its Cancel next to it.
describe("where Cancel this check sits in What you owe", () => {
  const row = (id: string, checkId: string) => ({ id, retry: false, amountCents: 1550, until: null, text: `Nina Park's live call ${id}`, waiting: true, checkId });
  it("one check covering several rows: one Cancel, under the line naming it", () => {
    const html = renderToStaticMarkup(React.createElement(OwedBox, { onHold: true, owed: [row("a", "pi_owed"), row("b", "pi_owed"), row("c", "pi_owed")] }));
    expect(html.match(/data-cancel-check="pi_owed"/g)).toHaveLength(1);
    const line = html.indexOf("data-owed-elsewhere"), cancel = html.indexOf('data-cancel-check="pi_owed"');
    expect(line).toBeGreaterThan(-1);
    expect(cancel).toBeGreaterThan(line); // under the line, not on row a
    expect(html.slice(html.indexOf('data-owed-line="a"'), html.indexOf('data-owed-line="b"'))).not.toContain("data-cancel-check");
  });
  it("a row with its own check keeps its Cancel next to it", () => {
    const html = renderToStaticMarkup(React.createElement(OwedBox, { onHold: true, owed: [row("a", "a")] }));
    expect(html.slice(html.indexOf('data-owed-line="a"'))).toContain('data-cancel-check="a"');
    expect(html).not.toContain("data-owed-cancel");
  });
});
