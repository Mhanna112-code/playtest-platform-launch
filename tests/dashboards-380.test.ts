import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// (Owner, Nov 11, §380 L) Dashboards: the tester's invite card shows only Open; Upcoming calls rows are links with no Join call (developer → test page, tester →
// session page); the developer's "Send your side" is a link to the dispute on the test page; "You were removed from this test" has no Dismiss / Dismiss all.

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");

describe("§380 L: dashboards", () => {
  it("invite card: only Open", () => {
    const invites = src("app/app/page.tsx").split('id="invitations"')[1]?.split("</section>")[0] ?? "";
    expect(invites).toMatch(/>Open<\/Link>/);
    expect(invites).not.toContain("NoThanks");
    expect(existsSync(path.resolve(__dirname, "../src/app/app/NoThanks.tsx"))).toBe(false);
  });

  it("Upcoming calls: rows are links, no Join call (tester → session page, developer → test page)", () => {
    const page = src("app/app/page.tsx");
    const upcoming = page.split('id="upcoming-calls"')[1]?.split("</section>")[0] ?? "";
    expect(upcoming).toContain('<Link href={`/app/sessions/${c.id}#call-${x.id}`}');
    expect(upcoming).not.toContain("JoinCall");
    const box = src("app/app/CallsBox.tsx");
    expect(box).toContain('<Link href={`/app/tests/${c.testId}#call-${c.id}`}');
    expect(box).not.toContain("<JoinCall");
  });

  it("the developer's Send your side is a link to the dispute on the test page", () => {
    const page = src("app/app/page.tsx");
    expect(page).toContain('<Link href={`/app/tests/${d.testId}#item-dispute-${d.id}`} className="btn px-3 py-1.5 text-sm no-underline hover:no-underline" data-dispute-side-link="">Send your side</Link>');
    expect(page).not.toContain("<DisputeSide");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("id={`item-dispute-${d.id}`}");
  });

  it("no Dismiss / Dismiss all for removed-from tests", () => {
    expect(existsSync(path.resolve(__dirname, "../src/app/app/DismissRemoved.tsx"))).toBe(false);
    expect(src("app/api/sessions/[id]/[action]/route.ts")).not.toContain('case "dismiss-removed"');
  });
});
