import { appUrl } from "@/lib/server/auth";
import { googleConfigured, startGoogle } from "@/lib/server/google";

export async function GET(req: Request) {
  if (!googleConfigured()) return Response.redirect(`${appUrl(req)}/login?error=google_off`, 303);
  const { url, cookie } = startGoogle(req);
  return new Response(null, { status: 303, headers: { Location: url, "Set-Cookie": cookie } });
}
