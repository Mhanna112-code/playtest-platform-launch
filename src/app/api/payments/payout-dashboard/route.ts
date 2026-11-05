import { appUrl } from "@/lib/server/auth";
import { requireUser } from "@/lib/server/session";
import { isPaymentsOff, payoutDashboardUrl, stripeOn } from "@/lib/server/stripe";
import { confirmSkipped } from "@/lib/server/users";
import { sameOriginForm } from "@/lib/server/http";
import { formGate } from "@/lib/server/accountChanges";
import { db } from "@/lib/db";

// (Owner, Nov 5, §200) Tester: "Change payout details" (a connected payout account) and the payout problem's "Update payout details": Stripe's own pages for the
// SAME Express account (its Express dashboard, or onboarding while Stripe still needs details: payoutDashboardUrl). Built like the payout setup route: only a POST
// from this site's own form calls Stripe; a GET goes back to Payments.
export async function GET(req: Request) {
  return Response.redirect(`${appUrl(req)}/app/payments#payout`, 303);
}
export async function POST(req: Request) {
  const base = appUrl(req);
  if (!sameOriginForm(req, base)) return new Response("Forbidden", { status: 403 });
  const form = await req.formData().catch(() => new FormData());
  // The press that was shown, so a refusal names it (§156): the banner's "Update payout details", else "Change payout details".
  const press = form.get("press") === "Update payout details" ? "update" : "change";
  const back = (code: string) => Response.redirect(`${base}/app/payments?error=${code}&press=${press}#payout`, 303);
  // (Owner, Oct 27) Open to a suspended or held account: a suspended tester is still paid.
  try {
    const u = await requireUser(req);
    if (!stripeOn()) return back("off");
    // (Owner, Oct 28, batch 16 section 27) Changed in another tab or device since the page opened: back to Payments with the box under this button.
    const stop = await formGate(u.id, form, "payout", base);
    if (stop) return Response.redirect(stop, 303);
    const me = await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { id: true, stripeAccountId: true, payoutsReady: true } });
    // No payout account (cleared meanwhile): Payments offers "Connect a payout account".
    if (!me.stripeAccountId) return back("payout_none");
    // (Batch 15 section 41, H2) Payouts only to a confirmed email address, as setup.
    if (!u.emailVerifiedAt && !confirmSkipped()) return back("confirm");
    const to = await payoutDashboardUrl(me, base);
    // (§130) The account is unknown to Stripe: cleared; Payments shows "Connect a payout account" again.
    if (to === "gone") return back("payout_gone");
    if (to === "none") return back("payout_none");
    return Response.redirect(to.url, 303);
  } catch (e) {
    if (isPaymentsOff(e)) return back("paused"); // (§130)
    console.error("[payments] payout dashboard:", (e as Error).message);
    return back("dashboard");
  }
}
