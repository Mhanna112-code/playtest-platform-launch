import { handle, readJson } from "@/lib/server/http";
import { resetPassword } from "@/lib/server/passwords";
import { clearSessionCookie } from "@/lib/server/session";

// Every device is signed out, this one too: the login page then says "Password changed".
export async function POST(req: Request) {
  return handle(async () => {
    const r = await resetPassword(await readJson(req));
    return Response.json(r, { headers: { "Set-Cookie": clearSessionCookie() } });
  });
}
