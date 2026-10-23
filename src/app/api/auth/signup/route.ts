import { appUrl } from "@/lib/server/auth";
import { handle, readJson } from "@/lib/server/http";
import { signUp } from "@/lib/server/passwords";
import { sessionCookie } from "@/lib/server/session";

export async function POST(req: Request) {
  return handle(async () => {
    const { token, expiresAt } = await signUp(await readJson(req), appUrl(req));
    return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(token, expiresAt) } });
  });
}
