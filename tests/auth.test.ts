import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as signupPOST } from "@/app/api/auth/signup/route";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as forgotPOST } from "@/app/api/auth/forgot/route";
import { POST as resetPOST } from "@/app/api/auth/reset/route";
import { POST as passwordPOST } from "@/app/api/auth/password/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { POST as profilePOST } from "@/app/api/profile/route";
import { confirmEmail } from "@/lib/server/passwords";
import { getUserFromRequest, isAdmin } from "@/lib/server/session";
import { email, json, makeUser, req } from "./helpers";

// (Owner, Oct 22, NEWEST+7) Sign-in like the full site: passwords replace the email sign-in links.

async function lastLink(addr: string, path: string) {
  const mail = await db.outboxEmail.findFirstOrThrow({ where: { to: addr }, orderBy: { createdAt: "desc" } });
  const link = mail.text.split("\n").find((l) => l.includes(path))!;
  return { mail, token: link.split(path)[1].trim() };
}
const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];

describe("sign up, confirm, log in, reset", () => {
  it("signs up with email + password (signed in at once), confirms the email by link, logs in; a wrong password is red", async () => {
    const addr = email("signup");
    expect((await json(await signupPOST(req("/api/auth/signup", { body: { email: addr, password: "short" } })))).body.error).toMatchObject({ code: "bad_field", message: "Password must be at least 8 characters" });
    const r = await signupPOST(req("/api/auth/signup", { body: { email: " " + addr.toUpperCase(), password: "harbor-run-1", over18: "yes" } }));
    expect(r.status).toBe(200);
    const u = await getUserFromRequest(req("/app", { cookie: cookieOf(r) }));
    expect(u?.email).toBe(addr);
    expect(u?.passwordHash).toMatch(/^\$2[aby]\$10\$/); // bcrypt, cost 10 (as the full app)
    expect(u?.emailVerifiedAt).toBeNull();
    expect((await json(await signupPOST(req("/api/auth/signup", { body: { email: addr, password: "harbor-run-1", over18: "yes" } })))).body.error.message).toBe("An account with that email already exists");
    // Confirm the email.
    const { mail, token } = await lastLink(addr, "/verify/");
    expect(mail.subject).toBe("Confirm your email");
    expect((await confirmEmail(token)).ok).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { email: addr } })).emailVerifiedAt).not.toBeNull();
    // Log in; a wrong password is a form mistake (400, red).
    const bad = await json(await loginPOST(req("/api/auth/login", { body: { email: addr, password: "wrong-pass" } })));
    expect(bad).toMatchObject({ status: 400, body: { error: { message: "Wrong email or password" } } });
    const good = await loginPOST(req("/api/auth/login", { body: { email: addr, password: "harbor-run-1", over18: "yes" } }));
    expect(good.status).toBe(200);
    expect((await getUserFromRequest(req("/app", { cookie: cookieOf(good) })))?.email).toBe(addr);
  });

  it("Forgot password -> reset link -> new password; every device is signed out; the link works once", async () => {
    const addr = email("reset");
    const s1 = await signupPOST(req("/api/auth/signup", { body: { email: addr, password: "first-pass-1", over18: "yes" } }));
    const s2 = await loginPOST(req("/api/auth/login", { body: { email: addr, password: "first-pass-1", over18: "yes" } }));
    expect((await json(await forgotPOST(req("/api/auth/forgot", { body: { email: addr } })))).body).toEqual({ sent: true });
    expect((await json(await forgotPOST(req("/api/auth/forgot", { body: { email: email("nobody") } })))).body).toEqual({ sent: true }); // same answer
    const { mail, token } = await lastLink(addr, "/reset/");
    expect(mail.subject).toBe("Reset your password");
    expect((await json(await resetPOST(req("/api/auth/reset", { body: { token, password: "new-pass-12", confirm: "other" } })))).body.error.message).toBe("The two passwords don't match");
    expect((await resetPOST(req("/api/auth/reset", { body: { token, password: "new-pass-12", confirm: "new-pass-12" } }))).status).toBe(200);
    for (const r of [s1, s2]) expect(await getUserFromRequest(req("/app", { cookie: cookieOf(r) }))).toBeNull();
    expect((await json(await resetPOST(req("/api/auth/reset", { body: { token, password: "again-pass-1", confirm: "again-pass-1" } })))).body.error.message).toBe("This link has expired or was already used. Ask for a new one.");
    expect((await loginPOST(req("/api/auth/login", { body: { email: addr, password: "first-pass-1", over18: "yes" } }))).status).toBe(400);
    expect((await loginPOST(req("/api/auth/login", { body: { email: addr, password: "new-pass-12" } }))).status).toBe(200);
  });

  it("changing the password signs out the other devices (not this one); old accounts without a password use Forgot password", async () => {
    const addr = email("change");
    const here = await signupPOST(req("/api/auth/signup", { body: { email: addr, password: "first-pass-1", over18: "yes" } }));
    const other = await loginPOST(req("/api/auth/login", { body: { email: addr, password: "first-pass-1", over18: "yes" } }));
    expect((await json(await passwordPOST(req("/api/auth/password", { cookie: cookieOf(here), body: { current: "nope-nope", password: "second-pass", confirm: "second-pass" } })))).body.error.message).toBe("Your current password isn't right");
    expect((await passwordPOST(req("/api/auth/password", { cookie: cookieOf(here), body: { current: "first-pass-1", password: "second-pass", confirm: "second-pass" } }))).status).toBe(200);
    expect(await getUserFromRequest(req("/app", { cookie: cookieOf(here) }))).not.toBeNull();
    expect(await getUserFromRequest(req("/app", { cookie: cookieOf(other) }))).toBeNull();
    // An account from the old email links: no password yet.
    const { user } = await makeUser();
    // (Batch 15 section 7) One message whatever the reason, so it never reveals who has an account.
    expect((await json(await loginPOST(req("/api/auth/login", { body: { email: user.email, password: "anything-1" } })))).body.error.message).toBe("Wrong email or password");
  });

  it("email confirmation is required for the listed presses (blue refusal), not for profile or chat", async () => {
    const { POST: testsPOST } = await import("@/app/api/tests/route");
    const { listingBody } = await import("./fixtures");
    const { user, cookie } = await makeUser({ dev: true, unconfirmed: true });
    const r = await json(await testsPOST(req("/api/tests", { cookie, body: listingBody() })));
    expect(r).toMatchObject({ status: 409, body: { error: { code: "confirm_email", message: `Confirm your email first. We sent a link to ${user.email}.` } } });
    expect((await profilePOST(req("/api/profile", { cookie, body: { name: "Nora", isDeveloper: true } }))).status).toBe(200);
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    expect((await testsPOST(req("/api/tests", { cookie, body: listingBody() }))).status).toBe(200);
  });

  it("the testing switch SKIP_EMAIL_CONFIRM=1 skips the requirement, but never in production", async () => {
    const { requireConfirmed } = await import("@/lib/server/users");
    const env = process.env as Record<string, string | undefined>;
    const keep = { skip: env.SKIP_EMAIL_CONFIRM, node: env.NODE_ENV };
    try {
      env.SKIP_EMAIL_CONFIRM = "1";
      expect(() => requireConfirmed({ emailVerifiedAt: null })).not.toThrow();
      env.NODE_ENV = "production";
      expect(() => requireConfirmed({ emailVerifiedAt: null })).toThrow("Confirm your email first.");
    } finally {
      env.SKIP_EMAIL_CONFIRM = keep.skip;
      env.NODE_ENV = keep.node;
    }
  });

  it("sign out ends the session", async () => {
    const { cookie } = await makeUser();
    expect(await getUserFromRequest(req("/app", { cookie }))).not.toBeNull();
    await logoutPOST(req("/api/auth/logout", { body: {}, cookie }));
    expect(await getUserFromRequest(req("/app", { cookie }))).toBeNull();
  });
});

describe("roles and tester profile", () => {
  it("saves name, pronoun, roles and the tester profile", async () => {
    const { user, cookie } = await makeUser();
    const r = await json(await profilePOST(req("/api/profile", { cookie, body: { name: "Ana Silva", pronoun: "she", isDeveloper: true, isTester: true, devices: ["Mac", "Nope"], languages: ["English"], categories: ["Game"] } })));
    expect(r).toMatchObject({ status: 200, body: { isDeveloper: true, isTester: true } });
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { profile: true } });
    expect(u).toMatchObject({ name: "Ana Silva", pronoun: "she" });
    expect(u.profile).toMatchObject({ devices: ["Mac"], languages: ["English"], categories: ["Game"] });
  });
  it("needs a role, and testers need a device and a language", async () => {
    const { cookie } = await makeUser();
    expect((await json(await profilePOST(req("/api/profile", { cookie, body: { name: "Ana" } })))).body.error.message).toBe("Choose developer, tester, or both.");
    expect((await json(await profilePOST(req("/api/profile", { cookie, body: { name: "Ana", isTester: true, languages: ["English"] } })))).body.error.message).toBe("Pick at least one device you play on.");
  });
  it("suspended users can't change anything", async () => {
    const { user, cookie } = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { devSuspendedAt: new Date(), testerSuspendedAt: new Date() } });
    expect((await profilePOST(req("/api/profile", { cookie, body: { name: "Ana", isDeveloper: true } }))).status).toBe(403);
  });
  it("admins come from ADMIN_EMAILS or the flag", () => {
    expect(isAdmin({ email: "OWNER@playtest.test", emailVerifiedAt: new Date() })).toBe(true);
    expect(isAdmin({ email: "OWNER@playtest.test" })).toBe(false); // (batch 15 section 41, H1) only once the email is confirmed
    expect(isAdmin({ email: "x@playtest.test" })).toBe(false);
    expect(isAdmin({ email: "x@playtest.test", isAdmin: true })).toBe(true);
  });
});
