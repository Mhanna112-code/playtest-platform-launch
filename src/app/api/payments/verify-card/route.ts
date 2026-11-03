import { handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { confirmCardCheck, finishCardCheck, startCardVerification } from "@/lib/server/chargeback";
import { cardAttempt } from "@/lib/server/cardLimits";
import { clientIp } from "@/lib/server/passwords";

// (Owner, Oct 26) Chargeback hold, step (a): start the 3D Secure card check (a Stripe SetupIntent). With no Stripe in dev it is simulated and succeeds at once.
// (Batch 17 §11) The page's "Verify a card" shows the bank's check inline, under the button: `check` starts it (with the fake Stripe: the stand-in, verified only on its
// Confirm), `paymentMethod` confirms the typed card on the SetupIntent (the bank's page comes back as `checkUrl`), `finish` ends it (Stripe decides; the stand-in's answer).
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const body = await readJson(req);
    const setupIntent = typeof body.setupIntent === "string" ? body.setupIntent : "";
    if (body.finish === true) return ok(await finishCardCheck(u.id, setupIntent, body.simulate));
    // (Owner, Nov 2, batch 35 §127) Starting Verify a card and each card typed into it are card attempts (5 per account, 15 per network a day; 429 with the line
    // under the button). The finish (the bank's answer, Cancel this check) isn't.
    await cardAttempt(u.id, clientIp(req));
    if (typeof body.paymentMethod === "string" && body.paymentMethod) return ok(await confirmCardCheck(u.id, setupIntent, body.paymentMethod));
    return ok(await startCardVerification(u, { standIn: body.check === true }));
  });
}
