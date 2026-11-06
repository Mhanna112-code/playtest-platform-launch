import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");

describe("(Owner, Nov 5) hotfix of §230: the dashboard loads while a charge waits for the bank", () => {
  it("the server component BankToConfirm hands BankWaiting its test links as data, never a function", () => {
    const s = read("src/app/app/BankToConfirm.tsx");
    expect(s.startsWith('"use client"')).toBe(false);
    expect(s).not.toMatch(/<BankWaiting[^>]*render=\{/);
    expect(s).toContain("tests={r.tests}");
    const b = read("src/components/BankWaiting.tsx");
    // (§270) The tests and the line's people, as data, drawn by the generalized link builder.
    expect(b).toContain("render={render ?? (tests || links ? lineRender(withTests(links, tests), { newTab: true }) : undefined)}");
  });
  it("§245: a payment line's quoted test name is a green link", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { withTestLinks } = await import("@/components/TestLinks");
    const { createElement, Fragment } = await import("react");
    // (A .test.ts file, no JSX: vitest runs tests/**/*.test.ts only.)
    const html = renderToStaticMarkup(createElement(Fragment, null, withTestLinks("Ana Silva's written answers on “Harbor Run”", [{ name: "Harbor Run", href: "/app/tests/t1" }])));
    expect(html).toContain('class="text-volt-300 underline decoration-dotted hover:text-volt-200" data-test-link=""');
  });
});
