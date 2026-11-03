import { handle, readJson } from "@/lib/server/http";
import { clientIp, logIn } from "@/lib/server/passwords";
import { sessionCookie } from "@/lib/server/session";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const { user, token, expiresAt } = await logIn(body, clientIp(req));
    // (Owner, Nov 2) `nextFor`: the account the page to return to belonged to; another account goes to its dashboard instead.
    const sameAccount = typeof body.nextFor !== "string" || !body.nextFor || body.nextFor === user.id;
    return Response.json({ ok: true, sameAccount }, { headers: { "Set-Cookie": sessionCookie(token, expiresAt) } });
  });
}
