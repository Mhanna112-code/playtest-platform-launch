import { db } from "@/lib/db";
import { handle, ok } from "@/lib/server/http";
import { readCookie, SESSION_COOKIE, hashToken } from "@/lib/server/session";

/**
 * (Design doc 2) What every open signed-in page asks every ~20 s: still signed in as the same person? deleted? suspended?
 * "out" (signed out elsewhere), "deleted" (the account no longer exists), "ok".
 */
export async function GET(req: Request) {
  return handle(async () => {
    const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
    const s = token ? await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } }) : null;
    if (!s || s.expiresAt < new Date()) return ok({ state: "out" }, { headers: { "cache-control": "no-store" } });
    if (s.user.deletedAt) return ok({ state: "deleted" }, { headers: { "cache-control": "no-store" } });
    return ok({ state: "ok", userId: s.user.id, name: s.user.name || s.user.email, suspended: !!s.user.suspendedAt, developer: s.user.isDeveloper, tester: s.user.isTester }, { headers: { "cache-control": "no-store" } });
  });
}
