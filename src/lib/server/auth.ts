import { db } from "@/lib/db";
import { isEmail, normEmail } from "@/lib/format";
import { sendEmail } from "./email";
import { HttpError } from "./http";
import { createSession, hashToken, newToken } from "./session";

export const LINK_MINUTES = 15;
export const LINKS_PER_EMAIL = 5; // per 15 minutes

export function appUrl(req?: Request) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return req ? new URL(req.url).origin : "http://localhost:3400";
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Email a one-use sign-in link (15 minutes). Rate limited per address. */
export async function requestSignIn(rawEmail: unknown, base: string) {
  const email = typeof rawEmail === "string" ? normEmail(rawEmail) : "";
  if (!isEmail(email)) throw new HttpError(400, "bad_email", "Enter an email address like you@email.com.");
  const recent = await db.loginToken.count({ where: { email, createdAt: { gt: new Date(Date.now() - LINK_MINUTES * 60_000) } } });
  if (recent >= LINKS_PER_EMAIL) throw new HttpError(429, "rate_limited", "We've sent a few links already. Check your inbox (and spam), or try again in 15 minutes.");
  const token = newToken();
  await db.loginToken.create({ data: { email, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000) } });
  const link = `${base}/login/verify?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: email,
    subject: "Your Playtest sign-in link",
    text: `Sign in to Playtest:\n\n${link}\n\nThe link works once and expires in ${LINK_MINUTES} minutes. If you didn't ask for it, ignore this email.`,
    html: `<p>Sign in to Playtest:</p><p><a href="${esc(link)}">Sign in</a></p><p>The link works once and expires in ${LINK_MINUTES} minutes. If you didn't ask for it, ignore this email.</p>`,
  });
  return { email };
}

/** Use a sign-in link: one use, unexpired. Creates the account on first sign-in. */
export async function verifySignIn(rawToken: unknown) {
  const token = typeof rawToken === "string" ? rawToken : "";
  const bad = new HttpError(400, "bad_link", "That sign-in link has expired or was already used. Ask for a new one.");
  if (!token || token.length > 200) throw bad;
  const tokenHash = hashToken(token);
  const now = new Date();
  const used = await db.loginToken.updateMany({ where: { tokenHash, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
  if (used.count !== 1) throw bad;
  const row = await db.loginToken.findUniqueOrThrow({ where: { tokenHash } });
  const user = await db.user.upsert({ where: { email: row.email }, update: {}, create: { email: row.email } });
  const session = await createSession(user.id);
  return { user, ...session };
}
