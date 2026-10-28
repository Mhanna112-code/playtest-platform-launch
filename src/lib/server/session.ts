import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { HttpError } from "./http";

export const SESSION_COOKIE = "pt_session";
export const SESSION_DAYS = 30;

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createSession(userId: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

export function sessionCookie(token: string, expiresAt: Date) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`;
}
export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export async function userForToken(token: string | null | undefined) {
  if (!token) return null;
  const s = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!s || s.expiresAt < new Date() || s.user.deletedAt) return null;
  return s.user;
}

export async function getUserFromRequest(req: Request) {
  const u = await userForToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
  // (Owner, Oct 27) A press from a page of the PREVIOUS account (another account signed in in another tab since) is refused: the page then switches.
  const page = req.headers.get("x-uid");
  if (u && page && page !== u.id) throw new HttpError(409, "account_changed", "You're signed in as someone else in another tab. This page is switching to that account.");
  return u;
}

export async function requireUser(req: Request) {
  const u = await getUserFromRequest(req);
  if (!u) {
    // (Design doc 2) A deleted account's open pages are told so (they go to the login page with a red notice).
    const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
    const s = token ? await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { select: { deletedAt: true } } } }) : null;
    if (s?.user.deletedAt) throw new HttpError(401, "deleted", "This account no longer exists.");
    throw new HttpError(401, "signed_out", "You're signed out. Sign in again to keep going.");
  }
  return u;
}

export async function endSession(token: string | null) {
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

type AdminWho = { email: string; isAdmin?: boolean; emailVerifiedAt?: Date | null; devSuspendedAt?: Date | null; testerSuspendedAt?: Date | null; deletedAt?: Date | null };
/** The emails in ADMIN_EMAILS, lower-cased. */
export const adminEmails = () => (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
/**
 * Is this an admin account at all (flagged isAdmin, or listed in ADMIN_EMAILS with a CONFIRMED email: batch 15 section 41, H1, so registering an admin's address
 * first gives nothing)? It says nothing about a suspension: see isAdmin.
 */
export const adminAccount = (u: AdminWho) => !u.deletedAt && (!!u.isAdmin || (!!u.emailVerifiedAt && adminEmails().includes(u.email.toLowerCase())));
/** (Batch 15 section 35) An admin whose account is suspended (either side) loses admin access. */
export const ADMIN_PAUSED = "Your account is paused.";
/** Admins: an admin account that isn't suspended. */
export const isAdmin = (u: AdminWho) => adminAccount(u) && !u.devSuspendedAt && !u.testerSuspendedAt;
