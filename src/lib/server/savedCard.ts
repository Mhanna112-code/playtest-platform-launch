import type { User } from "@prisma/client";
import { cardLabel } from "./accountChanges";
import { forgetCard, getStripe, isMissing, stripeOn } from "./stripe";

type SavedCard = Pick<User, "stripePaymentMethodId" | "cardExpMonth" | "cardExpYear"> & { id?: string; stripeCustomerId?: string | null };
const expiry = (month?: number | null, year?: number | null) => month && month >= 1 && month <= 12 && year ? ` · expires ${String(month).padStart(2, "0")}/${year}` : "";
export const NO_CARD_YET = "No card yet.";

/**
 * Read the account's saved method; never create or charge anything while displaying Payments. (§130) A card Stripe doesn't know (saved in test mode, read in live
 * mode) is no card: the stale fields are cleared (also on the passed user, so the same page shows "Add a card").
 */
export async function savedCardLine(user: SavedCard) {
  if (!user.stripePaymentMethodId) return NO_CARD_YET;
  const fallback = `A card is saved${expiry(user.cardExpMonth, user.cardExpYear)}.`;
  if (!stripeOn()) return fallback;
  try {
    const method = await getStripe().paymentMethods.retrieve(user.stripePaymentMethodId, {}, { timeout: 5_000, maxNetworkRetries: 0 });
    if (method.type === "link") return method.link?.email ? `Link · ${method.link.email}` : "Link saved for payments.";
    if (!method.card?.last4) return fallback;
    return `${cardLabel(method.card)}${expiry(method.card.exp_month, method.card.exp_year)}`;
  } catch (e) {
    if (isMissing(e)) {
      if (user.id) await forgetCard(user.id);
      Object.assign(user, { stripePaymentMethodId: null, cardExpMonth: null, cardExpYear: null, ...("stripeCustomerId" in user ? { stripeCustomerId: null } : {}) });
      return NO_CARD_YET;
    }
    // A provider outage (or payments switched off) must not prevent opening Payments or changing the saved method.
    return fallback;
  }
}
