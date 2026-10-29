import { appUrl } from "@/lib/server/auth";
import { clearGoogleCookie, finishGoogle, googleSignupCookie, GoogleError } from "@/lib/server/google";

export async function GET(req: Request) {
  const base = appUrl(req);
  const headers = new Headers();
  headers.append("Set-Cookie", clearGoogleCookie());
  try {
    const done = await finishGoogle(req);
    if ("pending" in done) {
      // (Batch 20 section 5) A new account: the short step first (18+ and the Terms), nothing created yet.
      headers.append("Set-Cookie", googleSignupCookie(done.pending));
      headers.set("Location", `${base}/signup/google`);
    } else {
      headers.append("Set-Cookie", done.cookie);
      headers.set("Location", `${base}/app`);
    }
  } catch (e) {
    if (!(e instanceof GoogleError)) console.error("[auth] Google sign-in failed:", e);
    headers.set("Location", `${base}/login?error=google_${e instanceof GoogleError ? e.code : "exchange"}`);
  }
  return new Response(null, { status: 303, headers });
}
