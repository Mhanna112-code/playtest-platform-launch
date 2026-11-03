import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { withTestLinks } from "@/components/TestLinks";

(globalThis as { React?: typeof React }).React = React;

// (Owner, Nov 2) Quoted test names in a payment line open that test in a new tab.
describe("test names in payment lines are links", () => {
  it("links each known quoted name, cut or whole; leaves the rest as text", () => {
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null, withTestLinks(
      "$416.00 · charges made while you were away (the team's dispute decision on Marc Hanna's written answers on “chargechar…” $320.00, … on “Other” $96.00)",
      [{ name: "chargechar…", href: "/app/tests/t1" }],
    )));
    expect(html).toContain('<a href="/app/tests/t1" target="_blank" rel="noreferrer"');
    expect(html).toContain("“chargechar…”</a>");
    expect(html).toContain("on “Other” $96.00");
    expect(html).not.toContain('href="/app/tests/undefined"');
    expect(withTestLinks("no tests here", [])).toBe("no tests here");
  });
});
