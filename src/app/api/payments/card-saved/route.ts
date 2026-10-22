import { appUrl } from "@/lib/server/auth";
import { requireActive } from "@/lib/server/users";
import { saveCardFromCheckout } from "@/lib/server/stripe";

export async function GET(req: Request) {
  const base = appUrl(req);
  try {
    const u = await requireActive(req);
    await saveCardFromCheckout(u.id, new URL(req.url).searchParams.get("session_id") ?? "");
    return Response.redirect(`${base}/app/payments?saved=card`, 303);
  } catch (e) {
    console.error("[payments] card saved:", (e as Error).message);
    return Response.redirect(`${base}/app/payments?error=card`, 303);
  }
}
