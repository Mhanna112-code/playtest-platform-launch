// (Batch 15 section 41, C1) Press keys. A page sends a UUID with each press; the server wraps it as "press:<userId>:<uuid>". Every key the server makes itself starts
// with its own word and a colon ("choice:", "dispute:", "owed:" ...), which a wrapped client key can never produce, so a client can't collide with (and block or replay)
// a tester's Charge, an admin's raise or any other server charge. The Stripe idempotency key is "pay-<key>".

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The client's press key for this user, or null when it isn't a UUID. */
export function clientPressKey(userId: string, raw: unknown): string | null {
  return typeof raw === "string" && UUID.test(raw) ? `press:${userId}:${raw.toLowerCase()}` : null;
}

/** A server-made key: "<kind>:<parts…>". */
/** (Batch 28 §21) "autocall": a listed call charged automatically 7 days after it. */
/** (Batch 30 §5) "teamclose": the team closed a piece for $0. */
/** (Batch 35 §117) "owedall": Pay what you owe's one payment for the total; "newcard": a charge made while away, tried again on a new card. */
/** (§147) "confirmback": a charge back to its own "Confirm with your bank" after Confirm all's one check didn't go through. */
export type ServerKeyKind = "choice" | "dispute" | "owed" | "cbowed" | "deferred" | "sub" | "subrenew" | "extra" | "cbwon" | "autocall" | "teamclose" | "owedall" | "newcard" | "confirmback";
export const serverKey = (kind: ServerKeyKind, ...parts: string[]) => `${kind}:${parts.join(":")}`;

/** Is this the key of a tester's Charge (recovery finishes those differently)? */
export const isChoiceKey = (k: string | null | undefined) => !!k && k.startsWith("choice:");

/** A chat message's press id from the page: a UUID only. */
export const clientMessageId = (raw: unknown) => (typeof raw === "string" && UUID.test(raw) ? raw.toLowerCase() : null);
