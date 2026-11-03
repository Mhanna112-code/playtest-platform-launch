import { db } from "@/lib/db";
import { HttpError } from "./http";
import { fakeOn, getStripe, isMissing, stripeOn } from "./stripe";

// (Owner, Nov 3, batch 35 §158) The inline bank check finishes by itself even when the bank's return page is blocked (on localhost Chrome blocks Stripe's public page from
// sending the frame back to http://localhost: Private Network Access). While the bank's page is open the page asks here every few seconds whether Stripe is still waiting
// for the customer; once it isn't, the page runs its normal finish (the same one the return page's message or Close runs), and the server decides there as always.
//
// READ-ONLY: a peek only reads Stripe's status. It never finishes, cancels, releases, expires or charges anything, and only answers for the developer's own check.

export type PeekAnswer = "waiting" | "done";

/** Stripe still waits for the customer (the bank's page is open); anything else (succeeded, requires_capture, processing, canceled, a failed attempt) is an end. */
export function stillWaiting(o: { status?: string | null; last_payment_error?: unknown; last_setup_error?: unknown }) {
  if (o.status === "requires_action" || o.status === "requires_confirmation") return true;
  // Back to requires_payment_method after a failed attempt (the bank refused): ended. Without an error it hasn't been tried yet: still waiting.
  if (o.status === "requires_payment_method") return !(o.last_payment_error || o.last_setup_error);
  return false;
}

const NOTHING = "There's nothing to confirm here.";

async function piAnswer(id: string): Promise<PeekAnswer> {
  if (!stripeOn()) return "waiting"; // no Stripe: the stand-in's own Confirm / Cancel decides
  // (§130) Stripe doesn't know it: nothing to wait for (the finish says how it ended).
  const pi = await getStripe().paymentIntents.retrieve(id).catch((e) => { if (isMissing(e)) return null; throw e; });
  return pi && stillWaiting(pi as { status: string }) ? "waiting" : "done";
}

/**
 * (§158) Is the developer's bank check still waiting? `paymentId`: a payment's check (Pay, Pay more, Subscribe, Confirm with your bank, Pay what you owe, Confirm all) or
 * a chargeback hold's reservation (Pay what you owe during a chargeback hold); `setupIntent`: Verify a card. Someone else's (or an unknown one) is refused.
 */
export async function peekBankCheck(dev: { id: string }, body: Record<string, unknown>): Promise<{ status: PeekAnswer }> {
  const setupIntent = typeof body.setupIntent === "string" ? body.setupIntent : "";
  if (setupIntent) {
    if (!stripeOn() || fakeOn()) return { status: "waiting" }; // simulated: the stand-in decides
    const si = await getStripe().setupIntents.retrieve(setupIntent).catch((e) => { if (isMissing(e)) return null; throw e; });
    if (!si) return { status: "done" };
    if (si.metadata?.userId !== dev.id || si.metadata?.purpose !== "chargeback-verify") throw new HttpError(403, "bad_setup", "That card check belongs to another account.");
    return { status: stillWaiting(si) ? "waiting" : "done" };
  }
  const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
  if (!paymentId) throw new HttpError(404, "not_found", NOTHING);
  const reservation = await db.reservation.findUnique({ where: { id: paymentId }, select: { stripePaymentIntentId: true, developerId: true } });
  if (reservation && reservation.developerId === dev.id) return { status: reservation.stripePaymentIntentId ? await piAnswer(reservation.stripePaymentIntentId) : "waiting" };
  const p = await db.payment.findUnique({ where: { id: paymentId }, select: { developerId: true, actionPi: true } });
  if (!p || p.developerId !== dev.id) throw new HttpError(404, "not_found", NOTHING);
  // Already finished, released or claimed elsewhere: nothing waits; the page's finish gives the server's own answer.
  if (!p.actionPi) return { status: "done" };
  return { status: await piAnswer(p.actionPi) };
}
