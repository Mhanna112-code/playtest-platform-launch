import { handle, readJson } from "@/lib/server/http";
import { clientIp, logIn } from "@/lib/server/passwords";
import { sessionCookie } from "@/lib/server/session";

export async function POST(req: Request) {
  return handle(async () => {
    const { token, expiresAt } = await logIn(await readJson(req), clientIp(req));
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(token, expiresAt) } });
  });
}
