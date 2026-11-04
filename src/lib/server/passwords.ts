import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { AGE_LINE, TERMS_VERSION } from "@/lib/termsOfUse";
import { db } from "@/lib/db";
import { isEmail, normEmail } from "@/lib/format";
import { DEVICES, DEVICES_MISSING, LANGUAGES, LANGUAGES_MISSING, pickFrom } from "@/lib/options";
import { safeZone } from "@/lib/tz";
import { LIMITS } from "@/lib/limits";
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

export const EMAIL_BAD = "Enter a valid email";
export const PASSWORD_SHORT = "Password must be at least 8 characters";
export const PASSWORD_LONG = "Use at most 200 characters";
const emailOf = (v: unknown) => (typeof v === "string" ? normEmail(v) : "");
function readEmail(v: unknown) {
  const email = emailOf(v);
  if (!isEmail(email)) throw field(EMAIL_BAD);
  return email;
}
/** A new password's mistake, or "" when it's fine (at least 8 characters, at most 200). */
function newPasswordMistake(v: unknown, message = PASSWORD_SHORT) {
  const p = typeof v === "string" ? v : "";
  return p.length < 8 ? message : p.length > 200 ? PASSWORD_LONG : "";
}
function readNewPassword(v: unknown, message = PASSWORD_SHORT) {
  const mistake = newPasswordMistake(v, message);
  if (mistake) throw field(mistake);
  return v as string;
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

// ---------- (Owner, Nov 3, batch 35 §134) Who you are is required when the account is made ----------

/**
 * No developer or tester picked: red at that choice, on the email form and on Google's step. (Owner, Nov 3, batch 35 §162; replaces §134's "both") The choice is
 * Developer or Tester only: an older page's "both" is refused with this same line. An account adds its other side later (Start testing too / Start posting tests
 * too), and accounts that already have both sides keep them.
 */
export const ROLE_MISSING = "Choose developer or tester.";
export const NAME_MISSING = "Enter your name";
export const TERMS_MISSING = "Agree to the Terms of Use to sign up";
/** (Batch 35 §162) A pronoun that isn't one of the profile's choices (only from an older page or a hand-made request): red at Pronoun. */
export const PRONOUN_BAD = "Choose a pronoun from the list.";
/** (Batch 35 §162) The sign-up bio over the profile's limit (the box stops at it, so only an older page or a hand-made request): red at the bio. */
export const BIO_TOO_LONG = `Keep your bio to ${LIMITS.bio.toLocaleString("en-US")} characters or fewer.`;
export type SignupRole = "developer" | "tester";
/** The pronouns the profile's choice offers ("" is Not set). */
const PRONOUN_VALUES = ["she", "he", "they"];
/** The "I am a…" picked, or "" when none was (an older page's "both" too: batch 35 §162). */
export const readRole = (v: unknown): SignupRole | "" => (v === "developer" || v === "tester" ? v : "");

/**
 * The new account's side. A tester gets its profile row with the devices and languages ticked at sign-up (batch 35 §153: so it's saved at once and Join needs no
 * visit to Profile) and (§162) the bio given there; a developer's bio is User.devBio. Either bio may be empty (optional, as on the profile).
 */
export function sidesOf(role: SignupRole, picks: { devices: string[]; languages: string[]; bio?: string } = { devices: [], languages: [] }) {
  const isDeveloper = role === "developer", isTester = role === "tester";
  const bio = picks.bio ?? "";
  return {
    isDeveloper, isTester, side: isDeveloper ? "developer" : "tester",
    ...(isDeveloper ? { devBio: bio } : {}),
    ...(isTester ? { profile: { create: { devices: picks.devices, languages: picks.languages, categories: [], bio } } } : {}),
  };
}

/**
 * What a new account must give, on the email form and on Google's step alike: who you are (developer or tester), a name (at least 1 character, no other rules:
 * owner, Oct 27), the Terms (batch 18 section 1: the version accepted is recorded) and "I'm 18 or older." (batch 20 section 5). (Owner, Nov 3, batch 35 §153) A
 * tester also ticks at least one device and one language (the profile's own lists and lines); a developer is never asked, and anything sent for them is ignored.
 * (§162) Optional: the pronoun (the profile's choice; unset reads "they"), saved as the account's, and the chosen side's bio (up to 2,000 characters, as the
 * profile's). Every mistake is red at once, each at its own field (batch 26 section 11: one line each), in the form's order. (Owner, Nov 4, batch 35 §170;
 * replaces §134's "email and password mistakes come first") The email form's email and password mistakes (`credentialMistakes`) are listed with the rest on
 * the first press: choice, devices, languages, name, pronoun, bio, email, password, Terms, 18 or older.
 */
export function readNewAccount(body: Record<string, unknown>, credentialMistakes: string[] = []): { role: SignupRole; name: string; pronoun: string; bio: string; devices: string[]; languages: string[] } {
  const role = readRole(body.role);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const tester = role === "tester";
  const devices = tester ? pickFrom(body.devices, DEVICES) : [], languages = tester ? pickFrom(body.languages, LANGUAGES) : [];
  const pronoun = body.pronoun == null || body.pronoun === "" ? "" : PRONOUN_VALUES.includes(body.pronoun as string) ? (body.pronoun as string) : null;
  const bio = typeof body.bio === "string" ? body.bio.trim() : "";
  const missing = [
    ...(!role ? [ROLE_MISSING] : []),
    ...(tester && devices.length === 0 ? [DEVICES_MISSING] : []),
    ...(tester && languages.length === 0 ? [LANGUAGES_MISSING] : []),
    ...(name.length < 1 ? [NAME_MISSING] : []),
    ...(pronoun === null ? [PRONOUN_BAD] : []),
    ...(bio.length > LIMITS.bio ? [BIO_TOO_LONG] : []),
    // (Owner, Nov 4, batch 35 §170) The email form's email and password lines sit here, in the form's order (Google's step has neither).
    ...credentialMistakes.filter(Boolean),
    ...(!isTicked(body.acceptTerms) ? [TERMS_MISSING] : []),
    ...(!isTicked(body.over18) ? [AGE_LINE] : []),
  ];
  if (!role || pronoun === null || missing.length) throw field(missing.join("\n"));
  return { role, name, pronoun, bio, devices, languages };
}

export const EMAIL_TAKEN = "An account with that email already exists";
/** (Owner, Nov 3, races) The database's unique-constraint refusal (Prisma P2002): a row made at the same moment in another tab. */
export const isUniqueClash = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Sign up: email + password. Signed in at once; a confirmation link is emailed. (Batch 15 section 7) At most 10 new accounts per network an hour. */
export async function signUp(body: Record<string, unknown>, base: string, ip = "", now = new Date()) {
  // (Owner, Nov 4, batch 35 §170) Every mistake on the first press: the email and password lines no longer stop the press before the rest are read. A valid
  // email already in use is its own line at Email ("An account with that email already exists", owner, Oct 30), with the others.
  const email = emailOf(body.email);
  const emailMistake = !isEmail(email) ? EMAIL_BAD : (await db.user.findUnique({ where: { email } })) ? EMAIL_TAKEN : "";
  // (NEXT-UI 15) The full app's sign-up form also asks who you are, your name and the Terms. (Batch 35 §134) All required: no account is made without its sides,
  // so the old "Welcome to Playtest · Tell us who you are" step never comes.
  const { role, name, pronoun, bio, devices, languages } = readNewAccount(body, [emailMistake, newPasswordMistake(body.password)]);
  const password = body.password as string;
  if (ip && (await db.loginAttempt.count({ where: { kind: "signup", ok: true, ip, at: { gt: new Date(now.getTime() - 3_600_000) } } })) >= SIGNUPS_PER_NETWORK_HOUR)
    throw new HttpError(429, "too_many", TOO_MANY_SIGNUPS);
  const user = await db.user.create({
    data: { email, passwordHash: await hashPassword(password), name, pronoun, timeZone: readTimeZone(body.timeZone), termsVersion: TERMS_VERSION, termsAcceptedAt: now, ageConfirmedAt: now, ...sidesOf(role, { devices, languages, bio }) },
  }).catch((e) => {
    // (Owner, Nov 3, races) The same email signed up in another tab between the check above and this create: the database's unique email refuses it, with the same line.
    if (isUniqueClash(e)) throw field(EMAIL_TAKEN);
    throw e;
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
        button: { label: "Choose a password", url: link },
        settings: false,
      });
      return { sent: true };
    }
    await sendEmail({
      to: email,
      subject: "Reset your password",
      text: `Someone (hopefully you) asked to reset the password for ${email}.\n\nChoose a new one here (the link works once, for ${RESET_MINUTES} minutes):\n${link}\n\nIf it wasn't you, ignore this email: your password stays the same.`,
      button: { label: "Reset your password", url: link },
      settings: false,
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
    button: { label: "Confirm your email", url: link },
    settings: false,
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
  return { ok: true as const, email: user.email, userId: user.id };
}
