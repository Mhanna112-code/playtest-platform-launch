import fs from "node:fs";
import { describe, expect, it } from "vitest";

// (Owner, Nov 2) The email-confirm page knows who is signed in on this browser: the header offers the app, and another account gets "Log out and log in as …".
describe("email confirm page", () => {
  it("names a different signed-in account and offers to switch; signed out it offers Log in", () => {
    const page = fs.readFileSync("src/app/verify/[token]/page.tsx", "utf8");
    expect(page).toContain("const other = r.ok && u && u.id !== r.userId ? u : null;");
    expect(page).toContain("<SwitchAccount email={r.email} />");
    expect(page).toContain('<Link href="/login" className="btn w-fit no-underline hover:no-underline">Log in</Link>');
    expect(fs.readFileSync("src/components/AuthShell.tsx", "utf8")).toContain('{signedIn ? <Link href="/app"');
  });
});
