import { handle, readJson } from "@/lib/server/http";
import { clearSessionCookie, endSession, readCookie, SESSION_COOKIE } from "@/lib/server/session";

export async function POST(req: Request) {
  return handle(async () => {
    await readJson(req);
    await endSession(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
    return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
  });
}
