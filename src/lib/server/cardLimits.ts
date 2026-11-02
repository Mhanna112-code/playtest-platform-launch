import { db } from "@/lib/db";
import { HttpError } from "./http";

// (Owner, Nov 2, batch 35 §127) Card testing: someone running stolen cards through "save a card" one after another. Card attempts are limited: at most 5 per account
// and 15 per network in a rolling 24 hours. An attempt is starting a card save (Add a card / Change card, the Stripe Checkout setup session), starting Verify a card
// and each card typed into it. Paying with the saved card, Pay what you owe, retries and Cancel this check are not attempts. Kept in LoginAttempt (kind "card"; the
// account's id in its email field). On a local dev server (no network: clientIp's "") the network cap is skipped, as for sign-in.

export const CARD_KIND = "card";
export const CARD_WINDOW_MS = 24 * 3_600_000;
export const CARD_ATTEMPTS_PER_ACCOUNT = 5;
export const CARD_ATTEMPTS_PER_NETWORK = 15;
export const TOO_MANY_CARD_ATTEMPTS = "Too many card attempts today. Try again tomorrow, or contact us.";

/** One card attempt for `userId` from network `ip` ("" = local dev, no network cap): refused with 429 over either limit, else recorded. */
export async function cardAttempt(userId: string, ip: string, now = new Date()) {
  const since = new Date(now.getTime() - CARD_WINDOW_MS);
  const [byAccount, byNetwork] = await Promise.all([
    db.loginAttempt.count({ where: { kind: CARD_KIND, email: userId, at: { gt: since } } }),
    ip ? db.loginAttempt.count({ where: { kind: CARD_KIND, ip, at: { gt: since } } }) : 0,
  ]);
  if (byAccount >= CARD_ATTEMPTS_PER_ACCOUNT || (ip && byNetwork >= CARD_ATTEMPTS_PER_NETWORK)) throw new HttpError(429, "too_many_cards", TOO_MANY_CARD_ATTEMPTS);
  await db.loginAttempt.create({ data: { email: userId, ip, kind: CARD_KIND, ok: true, at: now } });
}
