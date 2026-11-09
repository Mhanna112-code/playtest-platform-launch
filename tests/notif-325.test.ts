import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emailHtml } from "@/lib/server/emailLayout";

// (Owner, Nov 6, §325) No closing "Playtest" signature at the bottom of any email; (§326) no profile circle on the dashboard's Needs you rows.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const BASE = "https://playtest.test";

describe("§325 no closing signature", () => {
  it("no email text ends with a \"Playtest\" line; the HTML ends with the button (a trailing \"Playtest\" in old text isn't kept as a signature either)", () => {
    for (const f of ["lib/server/notify.ts", "lib/server/holds.ts", "lib/server/passwords.ts", "app/api/help/route.ts"]) expect(src(f), f).not.toMatch(/"", "Playtest"\]|\n\nPlaytest`/);
    const h = emailHtml("Hi", `Ana sent her answers.\n\n${BASE}/x\n\n`, { base: BASE, button: { label: "Open Playtest", url: `${BASE}/x` }, settings: true });
    expect(h).toContain(">Open Playtest</a>");
    expect(h).not.toContain(">Playtest</p>");
    expect(src("lib/server/emailLayout.ts")).not.toContain("let sig");
  });
});

describe("§326 Needs you rows have no profile circle", () => {
  it("the row keeps its words (12rem at least), the names' links and the action; no initial circle", () => {
    const dash = src("app/app/page.tsx");
    // (Codex eb8ca7cd, docs/NOV7-DASHBOARD-CHANGES.md) Needs you is one row per test: its name and Review (no people, so no circle).
    const rows = dash.slice(dash.indexOf('<SearchPanel id="needs-you"'), dash.indexOf("/>}", dash.indexOf('<SearchPanel id="needs-you"')));
    expect(rows).not.toContain("rounded-full bg-gradient-to-br from-volt-300 to-sky-300");
    expect(rows).toContain('<span className="min-w-0 flex-1 font-bold"><TestName text={r.title}/></span><span>Review →</span>');
  });
});
