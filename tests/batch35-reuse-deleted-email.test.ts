import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as signupPOST } from "@/app/api/auth/signup/route";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as forgotPOST } from "@/app/api/auth/forgot/route";
import { POST as resetPOST } from "@/app/api/auth/reset/route";
import { POST as googleFinishPOST } from "@/app/api/auth/google/finish/route";
import { finishGoogle, GOOGLE_COOKIE, GOOGLE_MESSAGES, GOOGLE_SIGNUP_COOKIE, GoogleError } from "@/lib/server/google";
import { confirmEmail, EMAIL_TAKEN, hashPassword, logIn, WRONG_LOGIN } from "@/lib/server/passwords";
import { deleteAccount, suspendAccount } from "@/lib/server/restrictions";
import { ACCOUNT_CLOSED, isTombstone, notCleanWhy, originalEmail, tombstoneOf } from "@/lib/server/reuseEmail";
import { CONTACT_US_HREF } from "@/lib/accountClosed";
import { adminPage, type UserVM } from "@/lib/server/adminLists";
import { accountState } from "@/lib/server/accountState";
import { sendEmail } from "@/lib/server/email";
import { getUserFromRequest } from "@/lib/server/session";
import { email, json, makeUser, req, uniq } from "./helpers";
import { setup } from "./fixtures";

// (Owner, Nov 1, §114; wording Nov 5) A deleted account's email can sign up again as a brand-new account when the deleted account was clean; otherwise sign-up is
// refused with "This account was closed." (Contact us after it). Active accounts unchanged. Google follows the same rules.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const WHO = { role: "developer", name: "Nora Again", acceptTerms: "yes", over18: "yes" };
const signup = (addr: string, password = "brand-new-pass-1") => signupPOST(req("/api/auth/signup", { body: { email: addr, password, ...WHO } })).then(json);
const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];
const linkIn = async (addr: string, p: string) => {
  const mail = await db.outboxEmail.findFirstOrThrow({ where: { to: addr }, orderBy: { createdAt: "desc" } });
  return mail.text.split("\n").find((l) => l.includes(p))!.split(p)[1].trim();
};

/** A developer with a password, a test, a charged payment to a tester and a rating; deleted by `by`. */
async function deletedDev(by: "self" | "admin" = "self") {
  const s = await setup();
  const old = s.dev.user;
  const tester = await makeUser({ tester: true, name: "Ana Silva" });
  await db.user.update({ where: { id: old.id }, data: { passwordHash: await hashPassword("old-password-1") } });
  const pay = await db.payment.create({ data: { kind: "review", developerId: old.id, testerId: tester.user.id, amountCents: 1000, feeCents: 100, testerCents: 900, status: "charged" } });
  const rating = await db.rating.create({ data: { testId: s.testId, contractId: `c_${uniq()}`, side: "tester", raterId: tester.user.id, rateeId: old.id, stars: 5 } });
  return { ...s, old, tester, pay, rating, by };
}
const del = async (id: string, by: "self" | "admin" = "self") => {
  await deleteAccount(id, by, by === "admin" ? "spam" : "");
};

describe("§114 a clean deleted account's email signs up again", () => {
  it("a new, separate account; the old one keeps its history, ratings, tests and payments; its email is a tombstone holding the original; the admin finds both", async () => {
    const d = await deletedDev();
    await del(d.old.id);
    const addr = d.old.email;
    const r = await signupPOST(req("/api/auth/signup", { body: { email: addr, password: "brand-new-pass-1", ...WHO } }));
    expect(r.status).toBe(200);
    const fresh = await getUserFromRequest(req("/app", { cookie: cookieOf(r) }));
    expect(fresh?.email).toBe(addr);
    expect(fresh?.id).not.toBe(d.old.id);
    // Nothing carries over: a new developer with nothing of the old one's.
    expect(fresh).toMatchObject({ name: "Nora Again", isDeveloper: true, deletedAt: null, stripeCustomerId: null, stripePaymentMethodId: null, holdCount: 0 });
    expect(await db.test.count({ where: { developerId: fresh!.id } })).toBe(0);
    expect(await db.payment.count({ where: { developerId: fresh!.id } })).toBe(0);
    expect(await db.rating.count({ where: { rateeId: fresh!.id } })).toBe(0);
    // The old account: still deleted, its email freed into a tombstone that keeps the original; everything it had stays with it.
    const old = await db.user.findUniqueOrThrow({ where: { id: d.old.id } });
    expect(old.email).toBe(tombstoneOf(addr, d.old.id));
    expect(old.email).toBe(`${addr} (deleted ${d.old.id})`);
    expect(isTombstone(old.email) && originalEmail(old.email) === addr).toBe(true);
    expect(old.deletedAt).not.toBeNull();
    expect(old.stripeCustomerId).toBe(d.old.stripeCustomerId);
    expect((await db.test.findUniqueOrThrow({ where: { id: d.testId } })).developerId).toBe(d.old.id);
    expect((await db.payment.findUniqueOrThrow({ where: { id: d.pay.id } })).developerId).toBe(d.old.id);
    expect((await db.rating.findUniqueOrThrow({ where: { id: d.rating.id } })).rateeId).toBe(d.old.id);
    expect(await db.accountEvent.findFirst({ where: { userId: d.old.id, kind: "email-freed" } })).toMatchObject({ note: addr });
    // The admin's console: searching the original email finds both (the new one first, as an exact match); the old one's state says its email was freed.
    const admin = await makeUser({ name: "Admin" });
    const page = (await adminPage("users", admin.user.id, null, "", { q: addr })).rows as UserVM[];
    expect(page.map((x) => x.id)).toEqual([fresh!.id, d.old.id]);
    expect(page[1].state).toBe("deleted");
    expect(page[1].line).toContain(addr);
    expect((await accountState(d.old.id))?.deleted).toMatch(/^Deleted .* by the owner of the account · Its email was freed for a new sign-up$/);
    const box = (await adminPage("u-holds", admin.user.id, null, d.old.id)).rows as { text: string }[];
    expect(box.some((x) => x.text.endsWith(`Email freed for a new sign-up: ${addr}`))).toBe(true);
  });

  it("the old account can never be signed into: the old password is wrong, the new one signs into the new account, the tombstone isn't an email", async () => {
    const d = await deletedDev();
    await del(d.old.id);
    expect((await signup(d.old.email)).status).toBe(200);
    const fresh = await db.user.findUniqueOrThrow({ where: { email: d.old.email } });
    await expect(logIn({ email: d.old.email, password: "old-password-1" })).rejects.toThrow(WRONG_LOGIN);
    expect((await logIn({ email: d.old.email, password: "brand-new-pass-1" })).user.id).toBe(fresh.id);
    const tomb = tombstoneOf(d.old.email, d.old.id);
    expect((await json(await loginPOST(req("/api/auth/login", { body: { email: tomb, password: "old-password-1" } })))).body.error.message).toBe("Enter a valid email");
    // Its old session (signed in before the delete) stays dead.
    expect(await getUserFromRequest(req("/app", { cookie: d.dev.cookie }))).toBeNull();
  });

  it("Forgot password for the email goes to the new account only; the old account's earlier links are used up", async () => {
    const d = await deletedDev();
    // Before the delete: a reset link and a confirm link for the old account.
    await forgotPOST(req("/api/auth/forgot", { body: { email: d.old.email } }));
    const oldReset = await linkIn(d.old.email, "/reset/");
    await db.user.update({ where: { id: d.old.id }, data: { emailVerifiedAt: null } });
    const { sendVerification } = await import("@/lib/server/passwords");
    await sendVerification(d.old.id, "http://localhost:3400");
    const oldVerify = await linkIn(d.old.email, "/verify/");
    await del(d.old.id);
    expect((await signup(d.old.email)).status).toBe(200);
    const fresh = await db.user.findUniqueOrThrow({ where: { email: d.old.email } });
    const oldHash = (await db.user.findUniqueOrThrow({ where: { id: d.old.id } })).passwordHash;
    // The old links do nothing.
    expect((await json(await resetPOST(req("/api/auth/reset", { body: { token: oldReset, password: "hijack-pass-1", confirm: "hijack-pass-1" } })))).body.error.message).toBe("This link has expired or was already used. Ask for a new one.");
    expect((await confirmEmail(oldVerify)).ok).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: fresh.id } })).emailVerifiedAt).toBeNull();
    // A new Forgot password: the email goes to the address, and its link sets the NEW account's password.
    expect((await json(await forgotPOST(req("/api/auth/forgot", { body: { email: d.old.email } })))).body).toEqual({ sent: true });
    const token = await linkIn(d.old.email, "/reset/");
    expect((await json(await resetPOST(req("/api/auth/reset", { body: { token, password: "reset-new-pass-1", confirm: "reset-new-pass-1" } })))).status).toBe(200);
    expect((await logIn({ email: d.old.email, password: "reset-new-pass-1" })).user.id).toBe(fresh.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: d.old.id } })).passwordHash).toBe(oldHash);
    // Anything still emailed about the old account goes to the original address (never to the tombstone).
    await sendEmail({ to: tombstoneOf(d.old.email, d.old.id), subject: `Old account ${uniq()}`, text: "x" });
    expect((await db.outboxEmail.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).to).toBe(d.old.email);
  });

  it("a deleted tester (clean) signs up again too", async () => {
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    await del(t.user.id);
    expect((await signup(t.user.email)).status).toBe(200);
    expect(await db.user.count({ where: { email: t.user.email, deletedAt: null } })).toBe(1);
  });
});

describe("§114 a deleted account that isn't clean: \"This account was closed.\"", () => {
  const closedCases: [string, (d: Awaited<ReturnType<typeof deletedDev>>) => Promise<unknown>, string][] = [
    ["money owed (a failed charge not paid)", (d) => db.payment.create({ data: { kind: "review", developerId: d.old.id, testerId: d.tester.user.id, amountCents: 500, feeCents: 50, testerCents: 450, status: "failed", owedUntil: new Date() } }), "money owed"],
    ["a charge owed during a hold (status owed)", (d) => db.payment.create({ data: { kind: "review", developerId: d.old.id, testerId: d.tester.user.id, amountCents: 500, feeCents: 50, testerCents: 450, status: "owed" } }), "money owed"],
    ["a deferred charge", (d) => db.payment.create({ data: { kind: "review", developerId: d.old.id, testerId: d.tester.user.id, amountCents: 500, feeCents: 50, testerCents: 450, status: "deferred" } }), "money owed"],
    ["a charge waiting for the bank", (d) => db.payment.create({ data: { kind: "review", developerId: d.old.id, testerId: d.tester.user.id, amountCents: 500, feeCents: 50, testerCents: 450, status: "needs_confirmation" } }), "money owed"],
    ["an open chargeback", (d) => db.payment.update({ where: { id: d.pay.id }, data: { chargeback: "open", chargebackAt: new Date() } }), "an open chargeback"],
    ["a payment hold", (d) => db.user.update({ where: { id: d.old.id }, data: { holdStartedAt: new Date(), holdReason: "unpaid" } }), "on a hold"],
    ["a chargeback hold", (d) => db.user.update({ where: { id: d.old.id }, data: { holdStartedAt: new Date(), holdReason: "chargeback" } }), "on a hold"],
  ];
  for (const [what, make, why] of closedCases)
    it(`refused with ${what}; nothing changes`, async () => {
      const d = await deletedDev();
      await del(d.old.id);
      await make(d);
      expect(await notCleanWhy(await db.user.findUniqueOrThrow({ where: { id: d.old.id } }))).toBe(why);
      const r = await signup(d.old.email);
      expect(r.status).toBe(400);
      expect(r.body.error).toMatchObject({ code: "bad_field", message: ACCOUNT_CLOSED });
      expect(ACCOUNT_CLOSED).toBe("This account was closed.");
      expect((await db.user.findUniqueOrThrow({ where: { id: d.old.id } })).email).toBe(d.old.email);
      expect(await db.user.count({ where: { email: d.old.email } })).toBe(1);
      expect(await db.accountEvent.count({ where: { userId: d.old.id, kind: "email-freed" } })).toBe(0);
    });

  it("refused when either side was suspended, and when an admin deleted it", async () => {
    const admin = await makeUser({ name: "Admin" });
    await db.user.update({ where: { id: admin.user.id }, data: { isAdmin: true } });
    const dev = await deletedDev();
    await suspendAccount(admin.user.id, dev.old.id, "fraud", "developer");
    await del(dev.old.id);
    const tester = await makeUser({ tester: true, name: "Ana Silva" });
    await suspendAccount(admin.user.id, tester.user.id, "no-shows", "tester");
    await del(tester.user.id);
    const byAdmin = await deletedDev();
    await del(byAdmin.old.id, "admin");
    for (const [addr, why] of [[dev.old.email, "suspended"], [tester.user.email, "suspended"], [byAdmin.old.email, "deleted by an admin"]] as const) {
      const u = await db.user.findUniqueOrThrow({ where: { email: addr } });
      expect(await notCleanWhy(u)).toBe(why);
      // With other mistakes too: every line at once (§170), the email's at its place.
      const r = await json(await signupPOST(req("/api/auth/signup", { body: { email: addr, password: "short", ...WHO } })));
      expect(r.body.error.message).toBe(`${ACCOUNT_CLOSED}\nPassword must be at least 8 characters`);
      expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).email).toBe(addr);
    }
  });

  it("an active account is unchanged: \"An account with that email already exists\"", async () => {
    const live = await makeUser({ dev: true });
    expect((await signup(live.user.email)).body.error).toMatchObject({ code: "bad_field", message: EMAIL_TAKEN });
    expect(EMAIL_TAKEN).toBe("An account with that email already exists");
  });

  it("the page: the red line at Email is followed by a Contact us link (to Contact us, as the other refusals link it); the bullet keeps the line", () => {
    expect(CONTACT_US_HREF).toBe("/app/help");
    const fc = src("components/FieldChecks.tsx");
    expect(fc).toContain("if (message === ACCOUNT_CLOSED) {");
    expect(fc).toContain('a.textContent = "Contact us";');
    expect(fc).toContain("lineOf.get(note) ?? note.textContent");
    expect(src("app/signup/page.tsx")).toContain('data-match="email"');
    expect(src("components/Err.tsx")).toContain('if (!red && text === ACCOUNT_CLOSED) return <p ref={ref} className="err" data-account-closed="">{text} <Link href={CONTACT_US_HREF} className="underline" data-contact-us="">Contact us</Link></p>;');
  });
});

describe("§114 Google follows the same rules", () => {
  const google = async (addr: string) => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    const claims = { iss: "https://accounts.google.com", aud: "cid", exp: Math.floor(Date.now() / 1000) + 600, email: addr, email_verified: true };
    const idToken = `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id_token: idToken }), { status: 200 }));
    return finishGoogle(new Request("http://localhost:3400/api/auth/google/callback?code=c&state=s", { headers: { cookie: `${GOOGLE_COOKIE}=s.v` } }));
  };
  const step = (token: string) => googleFinishPOST(req("/api/auth/google/finish", { body: { role: "tester", devices: ["Windows PC"], languages: ["English"], name: "Ana Again", acceptTerms: "yes", over18: "yes" }, headers: { cookie: `${GOOGLE_SIGNUP_COOKIE}=${token}` } }));

  it("clean: Google never signs into the deleted account; the short step makes a new account and frees the old email", async () => {
    const d = await deletedDev();
    await del(d.old.id);
    const done = await google(d.old.email);
    expect("pending" in done).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: d.old.id } })).email).toBe(d.old.email); // freed only when the step makes the account
    const r = await step((done as { pending: string }).pending);
    expect(r.status).toBe(200);
    const fresh = await getUserFromRequest(req("/app", { cookie: cookieOf(r) }));
    expect(fresh).toMatchObject({ email: d.old.email, name: "Ana Again", isTester: true, isDeveloper: false });
    expect(fresh!.id).not.toBe(d.old.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: d.old.id } })).email).toBe(tombstoneOf(d.old.email, d.old.id));
    // Google again signs into the new account.
    const again = await google(d.old.email);
    expect("user" in again && again.user.id).toBe(fresh!.id);
  });

  it("not clean: refused (\"This account was closed.\" on the login page, with Contact us); not clean by the step's Continue: refused there too", async () => {
    const d = await deletedDev();
    await del(d.old.id, "admin");
    await expect(google(d.old.email)).rejects.toThrow(GoogleError);
    await google(d.old.email).catch((e: GoogleError) => expect(e.code).toBe("closed"));
    expect(GOOGLE_MESSAGES.google_closed).toBe(ACCOUNT_CLOSED);
    expect(src("app/login/page.tsx")).toContain('<p className="err" data-account-closed="">{ACCOUNT_CLOSED} <Link href={CONTACT_US_HREF} className="underline" data-contact-us="">Contact us</Link></p>');
    // Clean when Google answered, a hold by the time of Continue.
    const e = await deletedDev();
    await del(e.old.id);
    const done = await google(e.old.email);
    await db.user.update({ where: { id: e.old.id }, data: { holdStartedAt: new Date(), holdReason: "unpaid" } });
    const r = await json(await step((done as { pending: string }).pending));
    expect(r.body.error).toMatchObject({ code: "closed", message: ACCOUNT_CLOSED });
    expect(await db.user.count({ where: { email: e.old.email } })).toBe(1);
  });

  it("a fresh email is unchanged (no account: the step), and an active account signs in as before", async () => {
    const addr = email("g");
    expect("pending" in (await google(addr))).toBe(true);
    const live = await makeUser({ dev: true });
    const done = await google(live.user.email);
    expect("user" in done && done.user.id).toBe(live.user.id);
  });
});
