import type { User } from "@prisma/client";
import { cardLabel } from "./accountChanges";
import { getStripe, stripeOn } from "./stripe";

type SavedCard = Pick<User, "stripePaymentMethodId" | "cardExpMonth" | "cardExpYear">;
const expiry = (month?: number | null, year?: number | null) => month && month >= 1 && month <= 12 && year ? ` · expires ${String(month).padStart(2, "0")}/${year}` : "";

/** Read the account's saved method; never create or charge anything while displaying Payments. */
export async function savedCardLine(user: SavedCard) {
  if (!user.stripePaymentMethodId) return "No card yet.";
  const fallback = `A card is saved${expiry(user.cardExpMonth, user.cardExpYear)}.`;
  if (!stripeOn()) return fallback;
  try {
    const method = await getStripe().paymentMethods.retrieve(user.stripePaymentMethodId, {}, { timeout: 5_000, maxNetworkRetries: 0 });
    if (method.type === "link") return method.link?.email ? `Link · ${method.link.email}` : "Link saved for payments.";
    if (!method.card?.last4) return fallback;
    return `${cardLabel(method.card)}${expiry(method.card.exp_month, method.card.exp_year)}`;
  } catch {
    // A provider outage must not prevent opening Payments or changing the saved method.
    return fallback;
  }
}
