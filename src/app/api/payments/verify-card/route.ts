import { handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { confirmCardCheck, finishCardCheck, refuseVerified, startCardVerification } from "@/lib/server/chargeback";
import { cardAttempt } from "@/lib/server/cardLimits";
import { clientIp } from "@/lib/server/passwords";
import { HttpError } from "@/lib/server/http";
import { PAYMENTS_OFF, getStripe, paymentsOff, stripeOn } from "@/lib/server/stripe";
import { CARD_CHECK_CANCELLED } from "@/lib/bankNotice";

// (Owner, Oct 26) Chargeback hold, step (a): start the 3D Secure card check (a Stripe SetupIntent). With no Stripe in dev it is simulated and succeeds at once.
// (Batch 17 §11) The page's "Verify a card" shows the bank's check inline, under the button: `check` starts it (with the fake Stripe: the stand-in, verified only on its
// Confirm), `paymentMethod` confirms the typed card on the SetupIntent (the bank's page comes back as `checkUrl`), `finish` ends it (Stripe decides; the stand-in's answer).
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const body = await readJson(req);
    const setupIntent = typeof body.setupIntent === "string" ? body.setupIntent : "";
    if (body.finish === true) {
      try {
        return ok(await finishCardCheck(u.id, setupIntent, body.simulate));
      } catch (e) {
        // (Owner, Nov 3, §160) Cancel under the bank's window (or the page closed with it open): Stripe was asked first (not verified); the card check is then
        // cancelled at Stripe, the developer's own only. One that just succeeded meanwhile can't be cancelled: it stays, and the next Verify a card uses it as usual.
        if ((body.cancel === true || body.leave === true) && e instanceof HttpError && e.code === "not_verified" && setupIntent && stripeOn()) {
          const si = await getStripe().setupIntents.retrieve(setupIntent).catch(() => null);
          if (si?.metadata?.userId === u.id && !["succeeded", "canceled"].includes(si.status)) await getStripe().setupIntents.cancel(setupIntent).catch(() => null);
        }
        // (Owner, Nov 5, §207) The developer's own Cancel under the window (`pressedCancel`), not verified: a cancel they chose, answered as one ("Cancelled: your card
        // wasn't changed."), never as a refusal. The bank's own answer (the return page, the peek) and leaving the page still read as before.
        if (body.pressedCancel === true && e instanceof HttpError && e.code === "not_verified") return ok({ verified: false, cancelled: true, line: CARD_CHECK_CANCELLED });
        throw e;
      }
    }
    // (Owner, Nov 2, batch 35 §127) Starting Verify a card and each card typed into it are card attempts (5 per account, 15 per network a day; 429 with the line
    // under the button). The finish (the bank's answer, Cancel this check) isn't.
    // (§130) Live keys while payments are switched off: the plain line, and not a card attempt.
    if (paymentsOff()) throw new HttpError(503, "payments_off", PAYMENTS_OFF);
    // (Owner, Nov 3, §157) Already verified (in another tab): refused before it uses a card attempt.
    await refuseVerified(u.id);
    await cardAttempt(u.id, clientIp(req));
    if (typeof body.paymentMethod === "string" && body.paymentMethod) return ok(await confirmCardCheck(u.id, setupIntent, body.paymentMethod));
    return ok(await startCardVerification(u, { standIn: body.check === true }));
  });
}
