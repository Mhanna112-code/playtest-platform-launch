import { appUrl } from "@/lib/server/auth";
import { requireUser } from "@/lib/server/session";
import { isPaymentsOff, saveCardFromCheckout } from "@/lib/server/stripe";

export async function GET(req: Request) {
  const base = appUrl(req);
  // (Owner, Oct 27) Open to a suspended or held account: a held developer must be able to change the card to pay what they owe, and a suspended tester is still paid.
  try {
    const u = await requireUser(req);
    const r = await saveCardFromCheckout(u.id, new URL(req.url).searchParams.get("session_id") ?? "");
    // (Owner, Nov 3) The new card was tried for what's owed and refused: the page says so under "Card saved." (the amount only, nothing personal).
    const refused = r?.declined ? `&owed=${r.declined.card ? "declined" : "failed"}&amt=${r.declined.cents}` : "";
    return Response.redirect(`${base}/app/payments?saved=card${refused}`, 303);
  } catch (e) {
    if (isPaymentsOff(e)) return Response.redirect(`${base}/app/payments?error=paused#card`, 303); // (§130)
    console.error("[payments] card saved:", (e as Error).message);
    return Response.redirect(`${base}/app/payments?error=card`, 303);
  }
}
