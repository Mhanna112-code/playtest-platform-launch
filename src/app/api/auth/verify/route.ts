import { verifySignIn } from "@/lib/server/auth";
import { handle, readJson } from "@/lib/server/http";
import { sessionCookie } from "@/lib/server/session";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const { token, expiresAt } = await verifySignIn(body.token);
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(token, expiresAt) } });
  });
}
