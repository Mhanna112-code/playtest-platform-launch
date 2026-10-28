import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { closedForSuspended } from "@/lib/closedPages";

// Batch 16 section 30: the account page shows the side in use only, with fewer duplicates.
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

describe("account page (section 30)", () => {
  const page = src("app/app/account/page.tsx");
  it("the heading names the side in use; no side cards; the other side offered in one line only when it's off", () => {
    expect(page).toContain('data-account-heading="">{u.name || u.email}{sideName ? ` · ${sideName}` : ""}</h1>');
    expect(page).toContain('const sideName = side === "developer" ? "Developer" : side === "tester" ? "Tester" : "";');
    expect(page).not.toContain(">Developer, tester, or both</h2>");
    expect(page).not.toMatch(/using now|Switch to \{s\.title/);
    expect(page).toContain(`line: "Want to test other people's products too?", label: "Start testing too"`);
    expect(page).toContain(`line: "Want to post tests too?", label: "Start posting tests too"`);
    // Both sides on: nothing (the header switches).
    expect(page).toContain('side === "developer" ? (tester ? null :');
    expect(page).toContain('side === "tester" ? (dev ? null :');
    // The name and email card with "not confirmed yet" and Resend stays.
    expect(page).toContain("not confirmed yet");
    expect(page).toContain("<ResendConfirm />");
  });

  it("Settings: only the profile of the side in use, no Change password link; the other links, the password form, signed-in devices and Delete account stay", () => {
    expect(page).toContain('{side === "tester" && tester && !profileClosed && link("/app/profile", UserRound, "Tester profile"');
    expect(page).toContain('{side === "developer" && dev && !profileClosed && link("/app/profile", Building2, "Developer profile"');
    expect(page).not.toContain('"Change password"');
    for (const l of ['"/app/payments", Banknote, "Payments"', '"Notifications and alerts"', '"/app/account/blocked", Ban, "Blocked people"', '"/privacy", ShieldCheck, "Privacy"', '"/app/help", LifeBuoy, "Contact us"']) expect(page).toContain(l);
    expect(page).toContain("<PasswordForm hasPassword={!!u.passwordHash} seenAt={seenAt} />");
    expect(page).toContain("<SignOutAll />");
    expect(page).toContain("<DeleteAccount ");
  });

  it("no excerpts on this page; a suspended tester side removes them from the dashboard (open to them), not the profile (closed)", () => {
    expect(page).not.toMatch(/MyExcerpts|myExcerpts/);
    expect(src("app/app/page.tsx")).toContain("{suspended && await myExcerpts(userId).then((items) => (items.length ? <MyExcerpts items={items} /> : null))}");
    expect(src("app/app/testers/[id]/page.tsx")).toContain("<MyExcerpts items={await myExcerpts(p.id)} />");
    const suspendedTester = { isDeveloper: false, isTester: true, testerSuspendedAt: new Date() };
    expect(closedForSuspended("/app", suspendedTester, "tester")).toBe(false);
    expect(closedForSuspended("/app/testers/abc", suspendedTester, "tester")).toBe(true);
    // The Remove button itself works while suspended (batch 13: tests/batch13.test.ts "a suspended tester can only Remove").
    expect(src("components/ExcerptList.tsx")).toContain("export function MyExcerpts({ items, canRemove = true }");
  });
});
