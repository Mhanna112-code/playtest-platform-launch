import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { isEmail, normEmail } from "@/lib/format";
import { appUrl } from "./auth";
import { createSession, readCookie, sessionCookie } from "./session";

// Sign in with Google: plain OAuth 2.0 authorization-code flow with PKCE, no auth library.

export const GOOGLE_COOKIE = "pt_google";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
export const googleRedirectUri = (req?: Request) => `${appUrl(req)}/api/auth/google/callback`;

const b64url = (b: Buffer) => b.toString("base64url");
const secure = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");

/** Where to send the browser, and the short-lived cookie holding state + PKCE verifier. */
export function startGoogle(req: Request) {
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: googleRedirectUri(req),
    response_type: "code",
    scope: "openid email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  const cookie = `${GOOGLE_COOKIE}=${state}.${verifier}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure()}`;
  return { url: url.toString(), cookie };
}

export const clearGoogleCookie = () => `${GOOGLE_COOKIE}=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0`;

export class GoogleError extends Error {
  constructor(public code: "cancelled" | "state" | "exchange" | "unverified" | "off") {
    super(code);
  }
}

/** Plain-word messages for /login?error=google_<code>. */
export const GOOGLE_MESSAGES: Record<string, string> = {
  google_cancelled: "Google sign-in was cancelled. Try again, or use an email link.",
  google_state: "That Google sign-in expired or came from another tab. Try again.",
  google_exchange: "We couldn't finish signing in with Google. Try again, or use an email link.",
  google_unverified: "Your Google account's email isn't verified, so we can't use it. Use an email link instead.",
  google_off: "Google sign-in isn't available right now. Use an email link.",
};

function decodeIdToken(idToken: string) {
  const part = idToken.split(".")[1];
  if (!part) throw new GoogleError("exchange");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

/**
 * Finish sign-in: check state, exchange the code (with the PKCE verifier and client secret) at Google's token endpoint,
 * read the ID token (received straight from Google over TLS, so its claims are checked rather than its signature),
 * require a verified email, then find or create the user and start a session.
 */
export async function finishGoogle(req: Request) {
  if (!googleConfigured()) throw new GoogleError("off");
  const params = new URL(req.url).searchParams;
  if (params.get("error")) throw new GoogleError("cancelled");
  const [state, verifier] = (readCookie(req.headers.get("cookie"), GOOGLE_COOKIE) ?? "").split(".");
  const code = params.get("code");
  if (!state || !verifier || !code || params.get("state") !== state) throw new GoogleError("state");

  let tokens: { id_token?: string };
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!.trim(),
        client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
        redirect_uri: googleRedirectUri(req),
        grant_type: "authorization_code",
        code_verifier: verifier,
      }).toString(),
    });
    if (!res.ok) throw new Error(`token endpoint ${res.status}: ${await res.text().catch(() => "")}`);
    tokens = await res.json();
  } catch (e) {
    console.error("[auth] Google token exchange failed:", (e as Error).message);
    throw new GoogleError("exchange");
  }
  if (!tokens.id_token) throw new GoogleError("exchange");
  const claims = decodeIdToken(tokens.id_token);
  const issOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  const audOk = claims.aud === process.env.GOOGLE_CLIENT_ID!.trim();
  const fresh = typeof claims.exp === "number" && claims.exp * 1000 > Date.now();
  if (!issOk || !audOk || !fresh) throw new GoogleError("exchange");
  const email = typeof claims.email === "string" ? normEmail(claims.email) : "";
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new GoogleError("unverified");
  if (!isEmail(email)) throw new GoogleError("unverified");

  const user = await db.user.upsert({ where: { email }, update: {}, create: { email } });
  const session = await createSession(user.id);
  return { user, cookie: sessionCookie(session.token, session.expiresAt) };
}
