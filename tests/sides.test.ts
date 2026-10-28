import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as switchPOST } from "@/app/app/switch/route";
import { hasBoth, sideFor, sideForPath, sideLink } from "@/lib/sides";
import { makeUser, req } from "./helpers";

// (NEXT-UI 6) The side switch like the full app's: one account with both sides, per-side pages, /app/switch links.
const both = { isDeveloper: true, isTester: true, side: "tester" };

describe("sides", () => {
  it("each page belongs to a side (or to neither); a tab shows its page's side, else the side used last", () => {
    expect(sideForPath("/app/tests/abc")).toBe("developer");
    expect(sideForPath("/app/tests/new")).toBe("developer");
    expect(sideForPath("/app/testers/x")).toBe("developer");
    expect(sideForPath("/app/find")).toBe("tester");
    expect(sideForPath("/app/find/abc?x=1")).toBe("tester");
    expect(sideForPath("/app/sessions/abc#chat")).toBe("tester");
    for (const shared of ["/app", "/app/notifications", "/app/profile", "/app/payments", "/app/messages", "/app/chat/x", "/app/calls/x"]) expect(sideForPath(shared)).toBeNull();
    expect(hasBoth(both)).toBe(true);
    expect(sideFor(both, "/app/tests/abc")).toBe("developer"); // the page's side, whatever was used last
    expect(sideFor(both, "/app/notifications")).toBe("tester"); // shared: the side used last
    expect(sideFor({ isDeveloper: true, isTester: false, side: "" }, "/app/find")).toBe("developer"); // one side only
    expect(sideFor({ isDeveloper: false, isTester: false }, "/app")).toBeNull();
  });

  it("a link to the other side's page goes through /app/switch (only with both sides)", () => {
    expect(sideLink(both, "/app/tests/abc")).toBe("/app/switch?to=developer&next=%2Fapp%2Ftests%2Fabc");
    expect(sideLink(both, "/app/sessions/abc")).toBe("/app/sessions/abc"); // already on that side
    expect(sideLink(both, "/app/notifications")).toBe("/app/notifications");
    expect(sideLink({ isDeveloper: true, isTester: false, side: "" }, "/app/tests/abc")).toBe("/app/tests/abc");
  });

  it("the switch sets the side used last and goes to the page; it refuses a side the account doesn't have and open redirects", async () => {
    const u = await makeUser({ dev: true, tester: true, name: "Nora Lane" });
    // (Batch 15 section 41, L5) The change is a POST from this site (a link answers with a small form that sends it).
    const go = (q: string, cookie = u.cookie) => switchPOST(new Request(`http://localhost:3400/app/switch?${q}`, { method: "POST", headers: { cookie, origin: "http://localhost:3400" } })).then((r) => ({ status: r.status, to: r.headers.get("location") ?? "" }));
    const r = await go("to=developer&next=%2Fapp%2Ftests%2Fabc");
    expect(r.to).toMatch(/\/app\/tests\/abc$/);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.user.id } })).side).toBe("developer");
    await go("to=tester&next=%2Fapp");
    expect((await db.user.findUniqueOrThrow({ where: { id: u.user.id } })).side).toBe("tester");
    expect((await go("to=developer&next=https%3A%2F%2Fevil.example")).to).toMatch(/\/app$/);
    expect((await go("to=developer&next=%2F%2Fevil.example")).to).toMatch(/\/app$/);
    const only = await makeUser({ tester: true });
    await go("to=developer&next=%2Fapp", only.cookie);
    expect((await db.user.findUniqueOrThrow({ where: { id: only.user.id } })).side).toBe("");
    expect((await go("to=developer", "")).to).toMatch(/\/login$/);
  });
});

describe("sign-up asks who you are, like the full app's", () => {
  it("developer / tester / both set the sides and the name; a name and the Terms are needed with a role; email + password alone still works", async () => {
    const { signUp } = await import("@/lib/server/passwords");
    const mail = () => `su-${Math.random().toString(36).slice(2)}@example.com`;
    const both = await signUp({ email: mail(), password: "longenough1", role: "both", name: "Nora Lane", acceptTerms: "yes" }, "http://localhost:3400");
    expect(both.user).toMatchObject({ name: "Nora Lane", isDeveloper: true, isTester: true });
    expect((await db.testerProfile.count({ where: { userId: both.user.id } }))).toBe(1);
    const dev = await signUp({ email: mail(), password: "longenough1", role: "developer", name: "Dee Moss", acceptTerms: "yes" }, "http://localhost:3400");
    expect(dev.user).toMatchObject({ isDeveloper: true, isTester: false });
    await expect(signUp({ email: mail(), password: "longenough1", role: "tester", name: "   ", acceptTerms: "yes" }, "http://x")).rejects.toThrow(); // (Owner, Oct 27) a name is at least 1 character, no other rules
    expect((await signUp({ email: mail(), password: "longenough1", role: "tester", name: "A", acceptTerms: "yes" }, "http://x")).user.name).toBe("A");
    await expect(signUp({ email: mail(), password: "longenough1", role: "tester", name: "Ana Silva" }, "http://x")).rejects.toThrow("Agree to the Terms");
    const plain = await signUp({ email: mail(), password: "longenough1" }, "http://localhost:3400");
    expect(plain.user).toMatchObject({ isDeveloper: false, isTester: false });
  });
});
