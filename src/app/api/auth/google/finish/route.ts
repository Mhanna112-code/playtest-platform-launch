import { handle, readJson } from "@/lib/server/http";
import { clearGoogleSignupCookie, finishGoogleSignup, GOOGLE_SIGNUP_COOKIE } from "@/lib/server/google";
import { readCookie } from "@/lib/server/session";

// (Owner, Oct 28, batch 20 section 5) Google's sign-up step: Continue with "I'm 18 or older." and the Terms ticked creates the account and signs it in.
export async function POST(req: Request) {
  return handle(async () => {
    const { cookie } = await finishGoogleSignup(readCookie(req.headers.get("cookie"), GOOGLE_SIGNUP_COOKIE), await readJson(req));
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("Set-Cookie", cookie);
    headers.append("Set-Cookie", clearGoogleSignupCookie());
    return new Response(JSON.stringify({ ok: true }), { headers });
  });
}
