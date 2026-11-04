import { db } from "@/lib/db";
import { CHECK_CANCELLED, NO_CHECK_WAITING } from "@/lib/rules";
import { HttpError } from "./http";
import { fakeOn, getStripe, isMissing, stripeOn } from "./stripe";

// (Owner, Nov 3, batch 35 §160) An open bank check stays open only while the page showing it is open.
// - Heartbeat: the page holding the bank window peeks every 3 seconds (§158); each peek records that the window is still open (a kept row "bankcheck:<id>",
//   no new column). A check of the developer's OWN press (Pay, Pay more, Pay what you owe and a chargeback hold's reservation, Confirm all, Subscribe, Verify a
//   card) with no heartbeat for 3 minutes is ended like Cancel: Stripe is asked first (went through: recorded paid; otherwise cancelled at Stripe, nothing
//   charged). 3 minutes, not seconds: on a phone the bank's approval can happen in the bank's app while the browser sits in the background sending nothing.
// - The sweep runs on every signed-in page's status check (on load and every ~20 s, so another tab opening Payments ends a dead check at once) and in the
//   5-minute timers sweep.
// - A single "Confirm with your bank" on a charge made while the developer was away is never cancelled (it would count as declined): closing only.
// - (pagehide sends the page's finish as a beacon at once on close, reload or navigation: components/BankCheck.tsx.)

export const HEARTBEAT_STALE_MS = 3 * 60_000;
const PREFIX = "bankcheck:";
const OWN_KINDS = ["review", "call", "extra", "subscription", "owed"];

/** (§160) The page holding the bank window is still open (each peek). Only after the peek found the check is the developer's own. */
export async function heartbeat(devId: string, checkId: string, now = new Date()) {
  if (!checkId) return;
  const key = `${PREFIX}${checkId}`.slice(0, 200);
  await db.keptForm.upsert({ where: { userId_key: { userId: devId, key } }, create: { userId: devId, key, data: { at: now.toISOString() } }, update: { data: { at: now.toISOString() } } }).catch(() => null);
}

/**
 * (§160) A chargeback hold's reservation's bank check ended by Cancel this check (any tab) or with no heartbeat: Stripe first. Authorized (requires_capture):
 * reserved as usual; otherwise cancelled at Stripe (nothing reserved) and Pay what you owe can be pressed again.
 */
export async function endReservationCheck(devId: string, id: string) {
  const r = await db.reservation.findUnique({ where: { id } });
  if (!r || r.developerId !== devId) throw new HttpError(404, "not_found", NO_CHECK_WAITING);
  const cb = await import("./chargeback");
  if (r.status === "reserved") return { paid: true, line: RESERVED_ALREADY };
  if (r.status !== "needs_action") throw new HttpError(409, "no_check", NO_CHECK_WAITING);
  const pi = r.stripePaymentIntentId && stripeOn() ? await getStripe().paymentIntents.retrieve(r.stripePaymentIntentId).catch((e) => (isMissing(e) ? null : Promise.reject(e))) : null;
  if (pi && (pi.status === "requires_capture" || pi.status === "succeeded")) {
    await cb.reservationChecked(devId, id, true);
    return { paid: true, line: RESERVED_ALREADY };
  }
  await cb.reservationChecked(devId, id, false).catch((e) => { if (!(e instanceof HttpError && e.code === "not_confirmed")) throw e; });
  return { cancelled: true, line: CHECK_CANCELLED };
}
export const RESERVED_ALREADY = "Your bank already confirmed it: the money is reserved.";

const lastRun = new Map<string, number>();
/**
 * (§160) End this developer's own bank checks whose page went away: no heartbeat (nor a press) for 3 minutes. At most every 10 seconds per developer; with
 * the fake Stripe (its stand-in isn't polled) nothing is ended here. Returns how many it ended.
 */
export async function endStaleChecks(devId: string, now = new Date(), force = false) {
  if (!stripeOn() || fakeOn()) return 0;
  const last = lastRun.get(devId) ?? 0;
  if (!force && now.getTime() - last < 10_000) return 0;
  lastRun.set(devId, now.getTime());
  const cutoff = now.getTime() - HEARTBEAT_STALE_MS;
  const beats = new Map((await db.keptForm.findMany({ where: { userId: devId, key: { startsWith: PREFIX } }, select: { key: true, updatedAt: true } })).map((b) => [b.key.slice(PREFIX.length), b.updatedAt.getTime()]));
  const seen = (id: string, made: Date) => Math.max(beats.get(id) ?? 0, made.getTime());
  let ended = 0;
  const { release } = await import("./confirm");
  for (const p of await db.payment.findMany({ where: { developerId: devId, status: "needs_action", actionPi: { not: null }, kind: { in: OWN_KINDS } }, select: { id: true, createdAt: true } })) {
    if (seen(p.id, p.createdAt) >= cutoff) continue;
    try {
      await release(p.id); // Stripe first: one that went through is recorded paid (never charged again); otherwise cancelled at Stripe
      ended++;
    } catch (e) {
      console.error("[bank check] stale payment:", (e as Error).message);
    }
  }
  for (const r of await db.reservation.findMany({ where: { developerId: devId, status: "needs_action" }, select: { id: true, createdAt: true } })) {
    if (seen(r.id, r.createdAt) >= cutoff) continue;
    try {
      await endReservationCheck(devId, r.id);
      ended++;
    } catch (e) {
      console.error("[bank check] stale reservation:", (e as Error).message);
    }
  }
  // Verify a card: its SetupIntent (no row of ours; known by its heartbeat).
  for (const [id, at] of beats) {
    if (!id.startsWith("seti_") || at >= cutoff) continue;
    try {
      const si = await getStripe().setupIntents.retrieve(id).catch((e) => (isMissing(e) ? null : Promise.reject(e)));
      if (si && si.metadata?.userId === devId) {
        if (si.status === "succeeded") await (await import("./chargeback")).finishCardVerification(devId, id).catch(() => null);
        else if (si.status !== "canceled") await getStripe().setupIntents.cancel(id);
        ended++;
      }
    } catch (e) {
      console.error("[bank check] stale card check:", (e as Error).message);
    }
  }
  // Heartbeats of checks that ended (or went stale) go.
  await db.keptForm.deleteMany({ where: { userId: devId, key: { startsWith: PREFIX }, updatedAt: { lt: new Date(cutoff) } } }).catch(() => null);
  return ended;
}

/** (§160) The 5-minute sweep: every developer with an own check open (or a card check's heartbeat). */
export async function endAllStaleChecks(now = new Date()) {
  if (!stripeOn() || fakeOn()) return 0;
  const ids = new Set<string>([
    ...(await db.payment.findMany({ where: { status: "needs_action", actionPi: { not: null }, kind: { in: OWN_KINDS }, createdAt: { lt: new Date(now.getTime() - HEARTBEAT_STALE_MS) } }, select: { developerId: true }, distinct: ["developerId"] })).map((p) => p.developerId),
    ...(await db.reservation.findMany({ where: { status: "needs_action", createdAt: { lt: new Date(now.getTime() - HEARTBEAT_STALE_MS) } }, select: { developerId: true }, distinct: ["developerId"] })).map((r) => r.developerId),
    ...(await db.keptForm.findMany({ where: { key: { startsWith: `${PREFIX}seti_` }, updatedAt: { lt: new Date(now.getTime() - HEARTBEAT_STALE_MS) } }, select: { userId: true }, distinct: ["userId"] })).map((k) => k.userId),
  ]);
  let n = 0;
  for (const id of ids) n += await endStaleChecks(id, now, true);
  return n;
}
