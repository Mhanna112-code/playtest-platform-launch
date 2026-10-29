import bcrypt from "bcryptjs";
import { AGE_LINE, TERMS_VERSION } from "@/lib/termsOfUse";
import { db } from "@/lib/db";
import { isEmail, normEmail } from "@/lib/format";
import { safeZone } from "@/lib/tz";
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

/** (Batch 15 section 11) A valid IANA time zone name from the browser, or "". */
export function readTimeZone(v: unknown) {
  if (typeof v !== "string" || !v || v.length > 64 || !/^[A-Za-z_+\-/0-9]+$/.test(v)) return "";
  return safeZone(v) === v ? v : "";
}

// ---------- (Owner, Oct 30, batch 15 section 7) One sign-in message, and attempt limits ----------

export const WRONG_LOGIN = "Wrong email or password";
export const TOO_MANY_TRIES = "Too many tries. Wait 15 minutes or reset your password.";
export const TOO_MANY_SIGNUPS = "Too many new accounts from here. Try again in an hour.";
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_FAILS_PER_EMAIL = 5;
export const LOGIN_FAILS_PER_NETWORK = 20;
export const SIGNUPS_PER_NETWORK_HOUR = 10;
/**
 * The network a press came from. (Batch 15 section 41, L2) Vercel's own `x-real-ip` first (the client can't set it), else the LAST hop of x-forwarded-for (the one our
 * proxy appended; the first is whatever the client sent). Without either: "unknown" in production (counted like any network), "" on a local dev server (no network
 * limit, so local test runs and recordings can make many accounts; the per-email limit still applies).
 */
export function clientIp(req: Request) {
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = req.headers.get("x-real-ip")?.trim() || hops[hops.length - 1];
  return (ip || (process.env.NODE_ENV === "production" ? "unknown" : "")).slice(0, 100);
}
/** (Batch 15 section 41, L2) A per-network limit on one kind of attempt: at most `max` in `windowMs`; each call that passes is recorded. */
export async function networkLimit(kind: string, ip: string, max: number, windowMs: number, message: string, now = new Date()) {
  if (!ip) return;
  if ((await db.loginAttempt.count({ where: { kind, ip, at: { gt: new Date(now.getTime() - windowMs) } } })) >= max) throw new HttpError(429, "too_many", message);
  await db.loginAttempt.create({ data: { email: "", ip, kind, ok: true, at: now } });
}
export const TOO_MANY_RESETS = "Too many reset requests from here. Try again in an hour.";
/** 5 failed tries for one email, or 20 from one network, in 15 minutes pause sign-in for that email or network (even with the right password). */
async function loginPaused(email: string, ip: string, now: Date) {
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const [byEmail, byIp] = await Promise.all([
    db.loginAttempt.count({ where: { kind: "login", ok: false, email, at: { gt: since } } }),
    ip ? db.loginAttempt.count({ where: { kind: "login", ok: false, ip, at: { gt: since } } }) : 0,
  ]);
  return byEmail >= LOGIN_FAILS_PER_EMAIL || byIp >= LOGIN_FAILS_PER_NETWORK;
}
/** The daily job: attempts older than a day are deleted. */
export const cleanLoginAttempts = (now = new Date()) => db.loginAttempt.deleteMany({ where: { at: { lt: new Date(now.getTime() - 86_400_000) } } });

/** (Batch 20 section 5) A tick sent by a form ("yes", "on") or as JSON (true). */
export const isTicked = (v: unknown) => v === true || v === "yes" || v === "on" || v === "true";

/** Sign up: email + password. Signed in at once; a confirmation link is emailed. (Batch 15 section 7) At most 10 new accounts per network an hour. */
export async function signUp(body: Record<string, unknown>, base: string, ip = "", now = new Date()) {
  const email = readEmail(body.email);
  const password = readNewPassword(body.password);
  if (ip && (await db.loginAttempt.count({ where: { kind: "signup", ok: true, ip, at: { gt: new Date(now.getTime() - 3_600_000) } } })) >= SIGNUPS_PER_NETWORK_HOUR)
    throw new HttpError(429, "too_many", TOO_MANY_SIGNUPS);
  // (Owner, Oct 30) Sign-up keeps "An account with that email already exists".
  if (await db.user.findUnique({ where: { email } })) throw field("An account with that email already exists");
  // (NEXT-UI 15) The full app's sign-up form also asks who you are (developer, tester or both), your name and the Terms.
  const role = body.role === "developer" || body.role === "tester" || body.role === "both" ? body.role : "";
  let who: { name: string; isDeveloper: boolean; isTester: boolean; termsVersion: number; termsAcceptedAt: Date } | null = null;
  if (role) {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (name.length < 1) throw field("Enter your name"); // (Owner, Oct 27) at least 1 character, no other rules
    if (!body.acceptTerms) throw field("Agree to the Terms of Use to sign up");
    who = { name, isDeveloper: role !== "tester", isTester: role !== "developer", termsVersion: TERMS_VERSION, termsAcceptedAt: now }; // (batch 18 section 1) the version they accepted
  }
  // (Owner, Oct 28, batch 20 section 5) The required "I'm 18 or older." tick: no account without it (red at the tick).
  if (!isTicked(body.over18)) throw field(AGE_LINE);
  const user = await db.user.create({
    data: { email, passwordHash: await hashPassword(password), timeZone: readTimeZone(body.timeZone), ageConfirmedAt: now, ...(who ?? {}), ...(who?.isTester ? { profile: { create: { devices: [], languages: [], categories: [] } } } : {}) },
  });
  await db.loginAttempt.create({ data: { email, ip, kind: "signup", ok: true, at: now } });
  await sendVerification(user.id, base);
  return { user, ...(await createSession(user.id)) };
}

/**
 * Log in. (Batch 15 section 7) One message for no account, a deleted account, an account without a password (Google sign-up) and a wrong password: "Wrong email or
 * password" (red), so it never reveals who has an account. Too many failed tries pause sign-in for that email or network for 15 minutes, even with the right password.
 */
export async function logIn(body: Record<string, unknown>, ip = "", now = new Date()) {
  const email = readEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) throw field("Enter your password");
  if (await loginPaused(email, ip, now)) throw new HttpError(429, "too_many", TOO_MANY_TRIES);
  const user = await db.user.findUnique({ where: { email } });
  const ok = !!user && !user.deletedAt && !!user.passwordHash && (await verifyPassword(password, user.passwordHash));
  await db.loginAttempt.create({ data: { email, ip, kind: "login", ok, at: now } });
  if (!ok || !user) throw field(WRONG_LOGIN);
  // (Batch 15 section 11) The browser's time zone, sent with the sign-in.
  const tz = readTimeZone(body.timeZone);
  if (tz && tz !== user.timeZone) await db.user.update({ where: { id: user.id }, data: { timeZone: tz } });
  await db.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
  return { user, ...(await createSession(user.id)) };
}

/** (Batch 15 section 7) The reset email for an account with no password (a Google sign-up). */
export const NO_PASSWORD_YET = "Your account has no password yet. Choose one here:";

/** "Forgot your password?": always the same answer, so it can't reveal who has an account. (Batch 15 section 41, L2) At most 10 per network an hour. */
export async function requestReset(body: Record<string, unknown>, base: string, ip = "") {
  const email = readEmail(body.email);
  await networkLimit("forgot", ip, 10, 3_600_000, TOO_MANY_RESETS);
  const user = await db.user.findUnique({ where: { email } });
  if (user && !user.deletedAt && (await recentlySent(email, "reset")) < EMAILS_PER_HOUR) {
    const token = await issue(email, "reset", RESET_MINUTES * 60_000);
    const link = `${base}/reset/${token}`;
    // (Batch 15 section 7) An account with no password yet (a Google sign-up) gets the same link, worded for a first password.
    if (!user.passwordHash) {
      await sendEmail({
        to: email,
        subject: "Choose a password",
        text: `${NO_PASSWORD_YET}\n${link}\n\nThe link works once, for ${RESET_MINUTES} minutes. You can keep using Continue with Google too.`,
        html: `<p>${NO_PASSWORD_YET} <a href="${link}">Choose a password</a></p><p>The link works once, for ${RESET_MINUTES} minutes. You can keep using Continue with Google too.</p>`,
      });
      return { sent: true };
    }
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
  // (Owner, Oct 28, batch 16 section 27) Changed in another tab or device since this page opened: the first press stops once ("Password changed at 3:10 PM"),
  // before the current password is checked (the one typed here may be the old one).
  const ac = await import("./accountChanges");
  await ac.accountGate(userId, body, "settings");
  if (user.passwordHash && !(await verifyPassword(typeof body.current === "string" ? body.current : "", user.passwordHash))) throw field("Your current password isn't right");
  const password = readNewPassword(body.password, "Use at least 8 characters");
  if (body.password !== body.confirm) throw field("The two passwords don't match");
  const here = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } }),
    db.session.deleteMany({ where: { userId, ...(here ? { tokenHash: { not: hashToken(here) } } : {}) } }),
  ]);
  await ac.logAccountChange(userId, typeof body.tab === "string" ? body.tab : "", { scopes: ["settings"], field: "password", label: "Password", line: "Password changed", at: true });
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
