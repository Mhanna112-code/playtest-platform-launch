import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as requestPOST } from "@/app/api/auth/request/route";
import { POST as verifyPOST } from "@/app/api/auth/verify/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { POST as profilePOST } from "@/app/api/profile/route";
import { getUserFromRequest, hashToken, isAdmin } from "@/lib/server/session";
import { email, json, makeUser, req } from "./helpers";

async function linkFor(addr: string) {
  const mail = await db.outboxEmail.findFirstOrThrow({ where: { to: addr }, orderBy: { createdAt: "desc" } });
  const link = mail.text.split("\n").find((l) => l.startsWith("http"))!;
  return { mail, link, token: new URL(link).searchParams.get("token")! };
}

describe("email sign-in links", () => {
  it("emails a one-use link to the dev outbox and signs in with it", async () => {
    const addr = email("signin");
    const res = await requestPOST(req("/api/auth/request", { body: { email: " " + addr.toUpperCase() } }));
    expect(await json(res)).toMatchObject({ status: 200, body: { sent: true, email: addr, devOutbox: true } });
    const { mail, link, token } = await linkFor(addr);
    expect(mail.subject).toBe("Your Playtest sign-in link");
    expect(link.startsWith("http://localhost:3400/login/verify?token=")).toBe(true);
    expect(await db.loginToken.count({ where: { tokenHash: hashToken(token) } })).toBe(1);
    const v = await verifyPOST(req("/api/auth/verify", { body: { token } }));
    expect(v.status).toBe(200);
    const cookie = v.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^pt_session=[\w-]+; Path=\/; HttpOnly; SameSite=Lax/);
    const user = await getUserFromRequest(req("/app", { cookie: cookie.split(";")[0] }));
    expect(user?.email).toBe(addr);
    expect((await verifyPOST(req("/api/auth/verify", { body: { token } }))).status).toBe(400);
  });

  it("sign out ends the session", async () => {
    const { cookie } = await makeUser();
    expect(await getUserFromRequest(req("/app", { cookie }))).not.toBeNull();
    await logoutPOST(req("/api/auth/logout", { body: {}, cookie }));
    expect(await getUserFromRequest(req("/app", { cookie }))).toBeNull();
  });

  it("rate-limits links per address", async () => {
    const addr = email("rate");
    for (let i = 0; i < 5; i++) expect((await requestPOST(req("/api/auth/request", { body: { email: addr } }))).status).toBe(200);
    expect((await requestPOST(req("/api/auth/request", { body: { email: addr } }))).status).toBe(429);
  });
});

describe("roles and tester profile", () => {
  it("saves name, pronoun, roles and the tester profile", async () => {
    const { user, cookie } = await makeUser();
    const r = await json(await profilePOST(req("/api/profile", { cookie, body: { name: "Ana Silva", pronoun: "she", isDeveloper: true, isTester: true, devices: ["Mac", "Nope"], languages: ["English"], categories: ["Puzzle"] } })));
    expect(r).toMatchObject({ status: 200, body: { isDeveloper: true, isTester: true } });
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { profile: true } });
    expect(u).toMatchObject({ name: "Ana Silva", pronoun: "she" });
    expect(u.profile).toMatchObject({ devices: ["Mac"], languages: ["English"], categories: ["Puzzle"] });
  });
  it("needs a role, and testers need a device and a language", async () => {
    const { cookie } = await makeUser();
    expect((await json(await profilePOST(req("/api/profile", { cookie, body: { name: "Ana" } })))).body.error.message).toBe("Choose developer, tester, or both.");
    expect((await json(await profilePOST(req("/api/profile", { cookie, body: { name: "Ana", isTester: true, languages: ["English"] } })))).body.error.message).toBe("Pick at least one device you play on.");
  });
  it("suspended users can't change anything", async () => {
    const { user, cookie } = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { suspendedAt: new Date() } });
    expect((await profilePOST(req("/api/profile", { cookie, body: { name: "Ana", isDeveloper: true } }))).status).toBe(403);
  });
  it("admins come from ADMIN_EMAILS or the flag", () => {
    expect(isAdmin({ email: "OWNER@playtest.test" })).toBe(true);
    expect(isAdmin({ email: "x@playtest.test" })).toBe(false);
    expect(isAdmin({ email: "x@playtest.test", isAdmin: true })).toBe(true);
  });
});
