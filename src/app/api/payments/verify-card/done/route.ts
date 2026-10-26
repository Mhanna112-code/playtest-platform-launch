import { appUrl } from "@/lib/server/auth";
import { requireUser } from "@/lib/server/session";
import { finishCardVerification } from "@/lib/server/chargeback";

// Where Stripe's card check returns (or the page goes after it succeeds): confirm the SetupIntent, then back to Payments.
export async function GET(req: Request) {
  const base = appUrl(req);
  try {
    const u = await requireUser(req);
    await finishCardVerification(u.id, new URL(req.url).searchParams.get("setup_intent") ?? "");
    return Response.redirect(`${base}/app/payments?saved=verified`, 303);
  } catch (e) {
    console.error("[payments] card verification:", (e as Error).message);
    return Response.redirect(`${base}/app/payments?error=verify`, 303);
  }
}
