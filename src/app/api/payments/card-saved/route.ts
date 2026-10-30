import { appUrl } from "@/lib/server/auth";
import { requireUser } from "@/lib/server/session";
import { saveCardFromCheckout } from "@/lib/server/stripe";

export async function GET(req: Request) {
  const base = appUrl(req);
  // (Owner, Oct 27) Open to a suspended or held account: a held developer must be able to change the card to pay what they owe, and a suspended tester is still paid.
  try {
    const u = await requireUser(req);
    await saveCardFromCheckout(u.id, new URL(req.url).searchParams.get("session_id") ?? "");
    return Response.redirect(`${base}/app/payments?saved=card`, 303);
  } catch (e) {
    console.error("[payments] card saved:", (e as Error).message);
    return Response.redirect(`${base}/app/payments?error=card`, 303);
  }
}
