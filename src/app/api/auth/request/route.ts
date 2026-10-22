import { appUrl, requestSignIn } from "@/lib/server/auth";
import { outboxEnabled } from "@/lib/server/email";
import { handle, ok, readJson } from "@/lib/server/http";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const r = await requestSignIn(body.email, appUrl(req));
    const devOutbox = !process.env.RESEND_API_KEY && outboxEnabled();
    return ok({ sent: true, email: r.email, devOutbox });
  });
}
