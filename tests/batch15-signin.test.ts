import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as signupPOST } from "@/app/api/auth/signup/route";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as forgotPOST } from "@/app/api/auth/forgot/route";
import { NO_PASSWORD_YET, TOO_MANY_SIGNUPS, TOO_MANY_TRIES, WRONG_LOGIN, cleanLoginAttempts, hashPassword } from "@/lib/server/passwords";
import { email, json, makeUser, req, uniq } from "./helpers";

// Batch 15 section 7: one sign-in message, attempt limits per email and per network, sign-up limit per network, and the no-password reset email.
const ipOf = () => `203.0.113.${Math.floor(Math.random() * 200) + 1}-${uniq()}`;
const login = (body: Record<string, unknown>, ip: string) => loginPOST(req("/api/auth/login", { body, headers: { "x-forwarded-for": `198.51.100.7, ${ip}` } })).then(json);
const signup = (body: Record<string, unknown>, ip: string) => signupPOST(req("/api/auth/signup", { body, headers: { "x-real-ip": ip } })).then(json);

describe("sign-in (section 7)", () => {
  it("one message for no account, a deleted account, a Google sign-up and a wrong password", async () => {
    const ip = ipOf();
    const pw = "harbor-run-1";
    const { user } = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(pw) } });
    const gone = await makeUser();
    await db.user.update({ where: { id: gone.user.id }, data: { passwordHash: await hashPassword(pw), deletedAt: new Date() } });
    const google = await makeUser(); // no password
    for (const body of [{ email: email("nobody"), password: pw }, { email: gone.user.email, password: pw }, { email: google.user.email, password: pw }, { email: user.email, password: "wrong-pass" }]) {
      const r = await login(body, ip);
      expect(r).toMatchObject({ status: 400, body: { error: { message: WRONG_LOGIN } } });
    }
    expect((await login({ email: user.email, password: pw }, ip)).status).toBe(200);
  });

  it("5 failed tries for one email in 15 minutes pause sign-in for it, even with the right password", async () => {
    const pw = "harbor-run-1";
    const { user } = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(pw) } });
    for (let i = 0; i < 5; i++) expect((await login({ email: user.email, password: "wrong-pass" }, ipOf())).status).toBe(400);
    const r = await login({ email: user.email, password: pw }, ipOf());
    expect(r).toMatchObject({ status: 429, body: { error: { message: TOO_MANY_TRIES } } });
    // 15 minutes later it works again.
    await db.loginAttempt.updateMany({ where: { email: user.email }, data: { at: new Date(Date.now() - 16 * 60_000) } });
    expect((await login({ email: user.email, password: pw }, ipOf())).status).toBe(200);
  });

  it("20 failed tries from one network pause sign-in from it; the cleanup deletes attempts older than a day", async () => {
    const ip = ipOf();
    const pw = "harbor-run-1";
    const { user } = await makeUser();
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(pw) } });
    for (let i = 0; i < 20; i++) await login({ email: email("x"), password: "wrong-pass" }, ip);
    expect((await login({ email: user.email, password: pw }, ip)).body.error.message).toBe(TOO_MANY_TRIES);
    expect((await login({ email: user.email, password: pw }, ipOf())).status).toBe(200); // another network is fine
    await db.loginAttempt.updateMany({ where: { ip }, data: { at: new Date(Date.now() - 25 * 3_600_000) } });
    await cleanLoginAttempts();
    expect(await db.loginAttempt.count({ where: { ip } })).toBe(0);
  });

  it("at most 10 new accounts per network an hour; a taken email keeps its own message", async () => {
    const ip = ipOf();
    for (let i = 0; i < 10; i++) expect((await signup({ email: email("s"), password: "harbor-run-1", over18: "yes" }, ip)).status).toBe(200);
    expect(await signup({ email: email("s"), password: "harbor-run-1", over18: "yes" }, ip)).toMatchObject({ status: 429, body: { error: { message: TOO_MANY_SIGNUPS } } });
    const other = ipOf();
    const addr = email("s");
    expect((await signup({ email: addr, password: "harbor-run-1", over18: "yes" }, other)).status).toBe(200);
    expect((await signup({ email: addr, password: "harbor-run-1", over18: "yes" }, other)).body.error.message).toBe("An account with that email already exists");
  });

  it("Forgot your password? for an account with no password sends the first-password email; the page answers the same", async () => {
    const { user } = await makeUser();
    const r = await forgotPOST(req("/api/auth/forgot", { body: { email: user.email } })).then(json);
    expect(r.body).toEqual({ sent: true });
    const mail = await db.outboxEmail.findFirstOrThrow({ where: { to: user.email }, orderBy: { createdAt: "desc" } });
    expect(mail.text.startsWith(`${NO_PASSWORD_YET}\nhttp`)).toBe(true);
    expect(mail.text).toContain("/reset/");
  });
});
