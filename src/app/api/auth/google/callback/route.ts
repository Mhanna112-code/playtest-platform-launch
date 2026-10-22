import { appUrl } from "@/lib/server/auth";
import { clearGoogleCookie, finishGoogle, GoogleError } from "@/lib/server/google";

export async function GET(req: Request) {
  const base = appUrl(req);
  const headers = new Headers();
  headers.append("Set-Cookie", clearGoogleCookie());
  try {
    const { cookie } = await finishGoogle(req);
    headers.append("Set-Cookie", cookie);
    headers.set("Location", `${base}/app`);
  } catch (e) {
    if (!(e instanceof GoogleError)) console.error("[auth] Google sign-in failed:", e);
    headers.set("Location", `${base}/login?error=google_${e instanceof GoogleError ? e.code : "exchange"}`);
  }
  return new Response(null, { status: 303, headers });
}
