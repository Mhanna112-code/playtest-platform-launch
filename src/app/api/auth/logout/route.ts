import { db } from "@/lib/db";
import { handle, readJson } from "@/lib/server/http";
import { clearSessionCookie, endSession, getUserFromRequest, readCookie, SESSION_COOKIE } from "@/lib/server/session";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    // (Batch 15 section 41, L6) "Sign out of all devices": every session of this account ends.
    if (body.everywhere === true) {
      const u = await getUserFromRequest(req);
      if (u) await db.session.deleteMany({ where: { userId: u.id } });
    }
    await endSession(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
    return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
  });
}
