import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { isEmail, normEmail } from "@/lib/format";
import { sendEmail } from "./email";
import { HttpError } from "./http";
import { createSession, hashToken, newToken, readCookie, SESSION_COOKIE } from "./session";

// (Owner, Oct 22, NEWEST+7) Sign-in like the full Playtest Platform: sign up with email + password, log in, Forgot
// password -> Reset by email link, email confirmation, and every other device signed out when the password changes.
// The same password hashing as the full app (bcrypt, cost 10). Accounts from the old email links have no password yet:
// they set one through Forgot password.

export const RESET_MINUTES = 60;
export const VERIFY_HOURS = 48;
const EMAILS_PER_HOUR = 3;

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const verifyPassword = (password: string, hash: string) => (hash ? bcrypt.compare(password, hash) : Promise.resolve(false));

const field = (message: string) => new HttpError(400, "bad_field", message); // red at the field

function readEmail(v: unknown) {
  const email = typeof v === "string" ? normEmail(v) : "";
  if (!isEmail(email)) throw field("Enter a valid email");
  return email;
}
function readNewPassword(v: unknown, message = "Password must be at least 8 characters") {
  const p = typeof v === "string" ? v : "";
  if (p.length < 8) throw field(message);
  if (p.length > 200) throw field("Use at most 200 characters");
  return p;
}

async function issue(email: string, kind: "reset" | "verify", ms: number) {
  const token = newToken();
  await db.loginToken.create({ data: { email, kind, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ms) } });
  return token;
}
const recentlySent = (email: string, kind: string) => db.loginToken.count({ where: { email, kind, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });

/** Sign up: email + password. Signed in at once; a confirmation link is emailed. */
export async function signUp(body: Record<string, unknown>, base: string) {
  const email = readEmail(body.email);
  const password = readNewPassword(body.password);
  if (await db.user.findUnique({ where: { email } })) throw field("An account with that email already exists");
  // (NEXT-UI 15) The full app's sign-up form also asks who you are (developer, tester or both), your name and the Terms.
  const role = body.role === "developer" || body.role === "tester" || body.role === "both" ? body.role : "";
  let who: { name: string; isDeveloper: boolean; isTester: boolean } | null = null;
  if (role) {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (name.length < 2) throw field("Enter your name");
    if (!body.acceptTerms) throw field("Agree to the Terms of Use to sign up");
    who = { name, isDeveloper: role !== "tester", isTester: role !== "developer" };
  }
  const user = await db.user.create({
    data: { email, passwordHash: await hashPassword(password), ...(who ?? {}), ...(who?.isTester ? { profile: { create: { devices: [], languages: [], categories: [] } } } : {}) },
  });
  await sendVerification(user.id, base);
  return { user, ...(await createSession(user.id)) };
}

/** Log in. A wrong password is a form mistake (red); an account without a password is pointed to Forgot password. */
export async function logIn(body: Record<string, unknown>) {
  const email = readEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) throw field("Enter your password");
  const user = await db.user.findUnique({ where: { email } });
  if (user?.deletedAt) throw field("This account no longer exists");
  if (user && !user.passwordHash) throw field("This account has no password yet. Use “Forgot your password?” to choose one.");
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw field("Wrong email or password");
  await db.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
  return { user, ...(await createSession(user.id)) };
}

/** "Forgot your password?": always the same answer, so it can't reveal who has an account. */
export async function requestReset(body: Record<string, unknown>, base: string) {
  const email = readEmail(body.email);
  const user = await db.user.findUnique({ where: { email } });
  if (user && (await recentlySent(email, "reset")) < EMAILS_PER_HOUR) {
    const token = await issue(email, "reset", RESET_MINUTES * 60_000);
    const link = `${base}/reset/${token}`;
    await sendEmail({
      to: email,
      subject: "Reset your password",
      text: `Someone (hopefully you) asked to reset the password for ${email}.\n\nChoose a new one here (the link works once, for ${RESET_MINUTES} minutes):\n${link}\n\nIf it wasn't you, ignore this email: your password stays the same.`,
      html: `<p>Someone (hopefully you) asked to reset the password for ${email}.</p><p><a href="${link}">Choose a new password</a> (the link works once, for ${RESET_MINUTES} minutes).</p><p>If it wasn't you, ignore this email: your password stays the same.</p>`,
    });
  }
  return { sent: true };
}

/** A reset link sets the new password, signs the account out on every device, and confirms the email. */
export async function resetPassword(body: Record<string, unknown>) {
  const password = readNewPassword(body.password, "Use at least 8 characters");
  if (body.password !== body.confirm) throw field("The two passwords don't match");
  const raw = typeof body.token === "string" ? body.token : "";
  const now = new Date();
  const expired = new HttpError(409, "bad_link", "This link has expired or was already used. Ask for a new one.");
  if (!raw || raw.length > 200) throw expired;
  const used = await db.loginToken.updateMany({ where: { tokenHash: hashToken(raw), kind: "reset", usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
  if (used.count !== 1) throw expired;
  const row = await db.loginToken.findUniqueOrThrow({ where: { tokenHash: hashToken(raw) } });
  const user = await db.user.findUniqueOrThrow({ where: { email: row.email } });
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), emailVerifiedAt: user.emailVerifiedAt ?? now } }),
    db.loginToken.updateMany({ where: { email: row.email, kind: "reset", usedAt: null }, data: { usedAt: now } }),
    db.session.deleteMany({ where: { userId: user.id } }), // signed out on every device
  ]);
  return { email: user.email };
}

/** Change the password while signed in: the current one first; every OTHER device is signed out. */
export async function changePassword(userId: string, req: Request, body: Record<string, unknown>) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.passwordHash && !(await verifyPassword(typeof body.current === "string" ? body.current : "", user.passwordHash))) throw field("Your current password isn't right");
  const password = readNewPassword(body.password, "Use at least 8 characters");
  if (body.password !== body.confirm) throw field("The two passwords don't match");
  const here = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } }),
    db.session.deleteMany({ where: { userId, ...(here ? { tokenHash: { not: hashToken(here) } } : {}) } }),
  ]);
  return { changed: true };
}

/** Send (or resend) the email confirmation link. At most 3 an hour. */
export async function sendVerification(userId: string, base: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) throw new HttpError(409, "confirmed", "Your email is already confirmed.");
  if ((await recentlySent(user.email, "verify")) >= EMAILS_PER_HOUR) throw new HttpError(429, "rate_limited", "We've sent a few already: check your inbox (and spam), or try again in an hour");
  const token = await issue(user.email, "verify", VERIFY_HOURS * 3_600_000);
  const link = `${base}/verify/${token}`;
  await sendEmail({
    to: user.email,
    subject: "Confirm your email",
    text: `Welcome to Playtest! Confirm your email:\n${link}\n\nThe link works for ${VERIFY_HOURS} hours.`,
    html: `<p>Welcome to Playtest! <a href="${link}">Confirm your email</a>.</p><p>The link works for ${VERIFY_HOURS} hours.</p>`,
  });
  return { sent: true };
}

/** The confirmation link. */
export async function confirmEmail(raw: string) {
  const now = new Date();
  const row = raw && raw.length <= 200 ? await db.loginToken.findUnique({ where: { tokenHash: hashToken(raw) } }) : null;
  if (!row || row.kind !== "verify" || row.expiresAt < now) return { ok: false as const };
  const user = await db.user.findUnique({ where: { email: row.email } });
  if (!user) return { ok: false as const };
  if (!user.emailVerifiedAt) await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });
  await db.loginToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
  return { ok: true as const, email: user.email };
}
