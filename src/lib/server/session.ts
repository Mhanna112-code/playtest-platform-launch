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
  if (!s || s.expiresAt < new Date()) return null;
  return s.user;
}

export const getUserFromRequest = (req: Request) => userForToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE));

export async function requireUser(req: Request) {
  const u = await getUserFromRequest(req);
  if (!u) throw new HttpError(401, "signed_out", "You're signed out. Sign in again to keep going.");
  return u;
}

export async function endSession(token: string | null) {
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** Admins: anyone flagged isAdmin, or listed in ADMIN_EMAILS. */
export const isAdmin = (u: { email: string; isAdmin?: boolean }) => {
  if (u.isAdmin) return true;
  const list = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(u.email.toLowerCase());
};
