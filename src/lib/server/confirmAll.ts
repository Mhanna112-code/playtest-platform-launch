import type { Payment } from "@prisma/client";
import { db } from "@/lib/db";
import { fmtTimeIn, money } from "@/lib/format";
import { NO_CHECK_WAITING, OVER_PAY_TICK_LINE, PAY_TICK_CENTS } from "@/lib/rules";
import * as T from "@/lib/confirmAllText";
import { HttpError } from "./http";
import { notify, renderFor } from "./notify";
import { charge, stripeOn } from "./stripe";
import { serverKey } from "./pressKeys";
import { stripeDescription } from "./paymentRows";
import { ALL_NOTE, OWED_ACTIVE, OWED_KIND, isAll } from "./owedOnce";

// (Owner, Nov 3, batch 35 §147) Confirm all: ONE press confirms every charge waiting for "Confirm with your bank" (across testers, parts and tests) as ONE payment, so
// the bank asks ONCE. The machinery is Pay what you owe's one payment (§117): a Payment of kind "owed" (note "press:all") that the charges it covers point to
// (coveredById), charged on-session for their total; the bank's check opens inline under the button.
// - The press stops once when what's waiting or its total differs from what the page showed (each change named); the second press goes ahead.
// - Every charge is claimed under the developer's row lock (its own check unclaimed: a single Confirm, an old tab or a second Confirm all can't run on it meanwhile),
//   then its own check is cancelled at Stripe FIRST: one Stripe says already went through is recorded as paid and left out of the total.
// - Approved: every charge is paid once by the one payment (each tester's share sent from it), ONE receipt names them all, each tester sees their part paid.
// - Its deadline is the earliest of the charges' own dates (and, like every press's check, 15 minutes). Run out at that date: none of them was confirmed (each as if
//   it ran out on its own). Refused, declined, cancelled or left: nothing was charged and each goes back to its own "Confirm with your bank" with its ORIGINAL
//   date (a new off-session PaymentIntent each, as a charge made while away is made; one declined outright follows the usual decline rules).
// - A renewal (its check belongs to its invoice), Pay what you owe's own one payment and a repaid chargeback keep their own Confirm and are left out of the total.

/** What Confirm all covers: a charge made while away on a test (a tester's Charge, an automatic call charge, a team decision) waiting for the bank. */
const KINDS = ["review", "call", "dispute", "extra"];
export const inAll = (p: { kind: string; status: string; contractId: string | null }) => KINDS.includes(p.kind) && p.status === "needs_confirmation" && !!p.contractId;

/** The Confirm all check that is open (being charged, or its bank check open), if any. */
export const openAll = (devId: string) => db.payment.findFirst({ where: { developerId: devId, kind: OWED_KIND, note: ALL_NOTE, status: { in: OWED_ACTIVE } }, orderBy: { createdAt: "desc" } });

const sum = (rows: { amountCents: number }[]) => rows.reduce((a, p) => a + p.amountCents, 0);
// (Owner, Nov 4, §177) A call's date is a time token in the piece's name: written here, in the developer's saved zone ("Ana Silva's live call on “Harbor Run” (Oct 27)").
// (Owner, Nov 4, §178) With its date and time: "Ana Silva's live call on “Harbor Run” (Tue, Oct 27, 7:15 AM)".
const nameOf = async (p: Payment) => { const h = await import("./holds"); return renderFor(p.developerId, `${await h.owedItemName(p, false, await h.pageCallDay(p.developerId))} ${money(p.amountCents)}`); };

export type ConfirmAllState = { ids: string[]; totalCents: number; leftOut: string | null; open: { id: string; cents: number; n: number } | null };

/** The dashboard box's and Payments' Confirm all: what it would confirm now, what it leaves out (a renewal…), and the one check open now. */
export async function confirmAllState(devId: string, now = new Date()): Promise<ConfirmAllState> {
  await expireAllChecks(now, { developerId: devId }, true);
  const { waitingConfirmation } = await import("./confirm");
  const waiting = await waitingConfirmation(devId, undefined, now);
  const items = await notTeamPaused(devId, waiting.filter(inAll));
  const left = waiting.filter((p) => !inAll(p));
  const one = await openAll(devId);
  const n = one ? await db.payment.count({ where: { coveredById: one.id } }) : 0;
  return {
    ids: items.map((p) => p.id),
    totalCents: sum(items),
    leftOut: items.length >= 2 && left.length ? T.leftOutLine(await Promise.all(left.map(leftName))) : null,
    open: one ? { id: one.id, cents: one.amountCents, n } : null,
  };
}

/**
 * (Owner, Nov 4, §172) A suspended developer's Confirm all is refused (every test is paused). The team's pause pauses ONE test: Confirm all leaves that test's
 * charges out (each one's own Confirm with your bank is refused until the lift: "The team paused this test: Confirm with your bank waits until the pause is lifted.").
 */
async function notTeamPaused<P extends { contractId: string | null }>(devId: string, rows: P[]) {
  if (!rows.length) return rows;
  const paused = new Set(await (await import("./teamPause")).teamPausedContractIds(devId));
  return paused.size ? rows.filter((p) => !p.contractId || !paused.has(p.contractId)) : rows;
}

/** A waiting payment Confirm all leaves out, named: "your plan's renewal $9.00", "what you owe $16.00". */
async function leftName(p: Payment) {
  if (p.kind === "subscription") return `your plan's renewal ${money(p.amountCents)}`;
  if (p.kind === OWED_KIND) return `${p.note.endsWith(":charges") ? "charges made while you were away" : "what you owe"} ${money(p.amountCents)}`;
  return nameOf(p);
}

/** Why a payment the page showed isn't waiting any more (the stop-once line). */
async function goneWhy(p: Payment | null) {
  if (!p) return "no longer waiting";
  if (p.status === "charged" || p.status === "not_set_up") return "confirmed meanwhile";
  if (p.status === "failed") return "not confirmed in time";
  if (p.status === "deferred") return "paused until your tests resume";
  if (p.status === "cancelled") return "cancelled";
  // (Owner, Nov 4, §172) Left out while the team's pause of its test lasts.
  if (p.status === "needs_confirmation" && (await (await import("./teamPause")).teamPausedTestOf(db, p.contractId))) return "the team paused its test";
  return "no longer waiting";
}

const ROLLBACK = new Error("confirm all changed");

/** (§159) The items' own stops, gathered across every item (thrown out of the claim's transaction, which rolls back). */
class ItemStops extends Error { constructor(public changes: { text: string; at: Date | string }[]) { super("confirm all item stops"); } }

/**
 * (Owner, Nov 3, §159) Confirm all stops for exactly what each item's own Confirm with your bank stops for: each covered item's pay-press gate (its contract and part:
 * payPressOf, the same Alerts filter and the always-stop rules: the team's decision about that tester, their work on that part, that tester leaving), run in the claim's
 * locked step. Every change is listed once, naming the items it is about ("… · for Ana Silva's recording on “Harbor Run” $10.00"); the second press (its box's time)
 * goes ahead. A page without a seen time (an old one) skips it, as the single Confirm does.
 */
async function itemStops(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], rows: Payment[], body: Record<string, unknown>) {
  const { seenOf, payPressOf } = await import("./live");
  if (!seenOf(body.seenAt) || (body.confirmed === true && !seenOf(body.boxAt))) return;
  const { devGate } = await import("./tests");
  const found = new Map<string, { text: string; at: Date | string; items: string[] }>();
  // (Owner, Nov 4, §193) The parts Confirm all pays: a charge line on one of them is one of its own rows, never a forced stop for another item of the same tester.
  const confirms: string[] = [];
  for (const p of rows) {
    const orig = p.kind === "chargeback" && p.repaysId && !p.submissionId && !p.callId ? await tx.payment.findUnique({ where: { id: p.repaysId }, select: { submissionId: true, callId: true } }) : null;
    const id = p.submissionId ?? p.callId ?? orig?.submissionId ?? orig?.callId;
    if (id) confirms.push(id);
  }
  for (const p of rows) {
    const c = p.contractId ? await tx.contract.findUnique({ where: { id: p.contractId }, select: { id: true, testId: true } }) : null;
    if (!c) continue;
    const orig = p.kind === "chargeback" && p.repaysId && !p.submissionId && !p.callId ? await tx.payment.findUnique({ where: { id: p.repaysId }, select: { submissionId: true, callId: true } }) : null;
    try {
      // (Owner, Nov 4, §171 item 7) Its press-time gate stays as it was (`awayCharge`: §159's rules) while the owner decides the waiting-charge rules.
      // (Owner, Nov 4, §193) Plus a charge about the same tester on a part Confirm all doesn't cover.
      await devGate(tx, c.testId, body, {}, [], undefined, { ...payPressOf(c.id, { submissionId: p.submissionId ?? orig?.submissionId ?? null, callId: p.callId ?? orig?.callId ?? null }), awayCharge: true, confirms });
    } catch (e) {
      if (!(e instanceof HttpError && e.code === "stop_once")) throw e;
      const name = await nameOf(p);
      for (const l of ((e.data?.changes ?? []) as { text: string; at: Date | string }[])) {
        const k = `${l.text}|${new Date(l.at).getTime()}`;
        const had = found.get(k);
        if (had) had.items.push(name);
        else found.set(k, { ...l, items: [name] });
      }
    }
  }
  if (!found.size) return;
  const list = [...found.values()].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  throw new ItemStops(list.map(({ items, ...l }) => ({ ...l, text: `${l.text} · for ${items.join(", ")}` })));
}

/** Claim every charge at once under the developer's row lock: each must still wait with the check the list read (else nothing is claimed: null). */
async function claim(devId: string, rows: Payment[], body: Record<string, unknown> = {}) {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${devId} FOR UPDATE`;
      // (Owner, Nov 3, §159) Pressed while suspended: refused like Pay (the suspension's own write waits for this lock, or landed first and is read here).
      const [me] = await tx.$queryRaw<{ devSuspendedAt: Date | null }[]>`SELECT "suspendedAt" AS "devSuspendedAt" FROM "User" WHERE id = ${devId}`;
      if (me?.devSuspendedAt) throw new HttpError(403, "suspended", (await import("./payments")).suspendedLine("Confirm all"));
      // (Owner, Nov 4, §172) The team paused one of their tests since the list was read: that test's charges are left out (the press stops once on the new list).
      if ((await notTeamPaused(devId, rows)).length !== rows.length) throw ROLLBACK;
      await itemStops(tx, rows, body);
      if (await tx.payment.count({ where: { developerId: devId, kind: OWED_KIND, note: ALL_NOTE, status: { in: OWED_ACTIVE } } })) throw ROLLBACK;
      const total = sum(rows);
      const one = await tx.payment.create({ data: { kind: OWED_KIND, developerId: devId, testerId: devId, amountCents: total, feeCents: total, testerCents: 0, transferStatus: "none", status: "paying", note: ALL_NOTE, warnedAt: new Date() } });
      for (const p of rows) {
        // Its own check is unclaimed (actionPi cleared); its own date stays (actionBy) for going back, or for the one check's deadline.
        const n = (await tx.payment.updateMany({ where: { id: p.id, actionPi: p.actionPi, coveredById: null, status: "needs_confirmation", settledAt: null, actionBy: { gt: new Date() } }, data: { coveredById: one.id, actionPi: null } })).count;
        if (n !== 1) throw ROLLBACK;
      }
      return one;
    });
  } catch (e) {
    if (e === ROLLBACK) return null;
    if (e instanceof ItemStops) throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes: e.changes, totalCents: sum(rows), ids: rows.map((p) => p.id) });
    throw e;
  }
}

type Seen = { seenTotalCents?: unknown; seenIds?: unknown; over200?: unknown };

/**
 * The Confirm all press. Returns the inline bank check to open (`confirm`), or what happened at once (`line`). Stops once when the page showed other payments or
 * another total; refuses a second one while one waits for the bank.
 */
export async function confirmAllPress(dev: { id: string }, body: Seen & Record<string, unknown> = {}) {
  const confirm = await import("./confirm");
  const once = await import("./owedOnce");
  await confirm.expireActions(new Date(), { developerId: dev.id });
  await once.resumeStaleOwed(dev.id);
  if (await openAll(dev.id)) throw new HttpError(409, "busy", T.ALL_BUSY);
  const now = new Date();
  const waiting = await notTeamPaused(dev.id, (await confirm.waitingConfirmation(dev.id, undefined, now)).filter(inAll)); // (§172)
  // (Owner, Nov 3, batch 35 §163) Nothing left to confirm is refused on the first press: a "what's waiting changed" stop could only be followed by this refusal.
  if (!waiting.length) throw new HttpError(409, "nothing", await nothingLeftLine(dev.id, body));
  await stopIfChanged(waiting, body, now, dev.id);
  // (Owner, Nov 3) Over $200 in all: only with the tick "I confirm this payment is over $200." (as Pay's).
  if (sum(waiting) > PAY_TICK_CENTS && body.over200 !== true) throw new HttpError(400, "needs_tick", `Tick “${OVER_PAY_TICK_LINE}” to pay.`);
  const one = await claim(dev.id, waiting, body);
  if (!one) {
    if (await openAll(dev.id)) throw new HttpError(409, "busy", T.ALL_BUSY);
    // Changed between the list and the claim (a single Confirm finished, a date passed): stops once on what's waiting now.
    const fresh = await notTeamPaused(dev.id, (await confirm.waitingConfirmation(dev.id, undefined, new Date())).filter(inAll));
    if (!fresh.length) throw new HttpError(409, "nothing", await nothingLeftLine(dev.id, { ...body, seenIds: waiting.map((p) => p.id) })); // (§163) nothing left: refused, never a stop
    await stopIfChanged(fresh, { seenTotalCents: sum(waiting), seenIds: waiting.map((p) => p.id), tab: body.tab }, new Date(), dev.id);
    throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes: [{ text: "What's waiting for your bank changed meanwhile.", at: new Date() }], totalCents: sum(fresh), ids: fresh.map((p) => p.id) });
  }
  // Each charge's own check is cancelled at Stripe FIRST, so an old bank page can't still complete it while the one payment goes through.
  const kept: Payment[] = [];
  const paid: string[] = [];
  const paidIds: string[] = [];
  for (const p of waiting) {
    let end: "cancelled" | "succeeded" | "missing";
    try {
      end = await once.dropCheck(p.actionPi);
    } catch {
      // Stripe's answer was unclear: it keeps its own check (left out of this one).
      await db.payment.updateMany({ where: { id: p.id, coveredById: one.id }, data: { coveredById: null, actionPi: p.actionPi } });
      continue;
    }
    if (end === "succeeded") {
      // Already confirmed at the bank: recorded as paid on its own (never charged again), left out of the total.
      if ((await db.payment.updateMany({ where: { id: p.id, coveredById: one.id }, data: { coveredById: null } })).count === 1) {
        await confirm.finishConfirmed(p.id);
        paid.push(await nameOf(p));
        paidIds.push(p.id);
      }
      continue;
    }
    kept.push(p);
  }
  const already = paid.length ? T.alreadyPaidLine(paid) : "";
  if (!kept.length) {
    await db.payment.updateMany({ where: { id: one.id, status: "paying" }, data: { status: "cancelled" } });
    return { done: true, line: already || T.NOTHING_TO_CONFIRM, paidIds, oneId: null as string | null };
  }
  const cents = sum(kept);
  const row = cents === one.amountCents ? one : await db.payment.update({ where: { id: one.id }, data: { amountCents: cents, feeCents: cents } });
  const u = await db.user.findUniqueOrThrow({ where: { id: dev.id } });
  const r = await once.chargeClaimed(u, row, "press");
  if (r.result === "action") return { confirm: r.action, n: kept.length, cents, already, paidIds, oneId: one.id };
  if (r.result === "paid") {
    await allReceipt(u.email, r.parts, r.status);
    await (await import("./holds")).liftHoldIfClear(dev.id);
    return { done: true, line: [T.allConfirmedLine(r.parts.length, r.cents), already].filter(Boolean).join(" "), paidIds, oneId: one.id };
  }
  if (r.result === "failed" && (await db.payment.findUnique({ where: { id: one.id }, select: { status: true } }))?.status === "paying") {
    // Stripe's answer was lost: everything stays locked under it until the same charge is asked again (never charged twice).
    throw new HttpError(502, "payment_unknown", "We didn't hear back from the payment service. Nothing more will be charged: we'll check it again shortly.");
  }
  // Declined: nothing was charged; each went back to its own Confirm (or, declined again on its own, was added to what you owe).
  const now2 = await db.payment.findMany({ where: { id: { in: kept.map((p) => p.id) } }, select: { status: true, actionPi: true } });
  const back = now2.filter((p) => p.status === "needs_confirmation" && p.actionPi).length;
  const declined = now2.filter((p) => p.status === "failed").length;
  throw new HttpError(402, "not_confirmed", T.allDeclinedLine(r.result === "failed" ? r.why : "", back, kept.length, declined));
}

/** (Stop once) The page showed other payments, or another total: each change named, oldest first; the next press goes ahead on what's waiting now. */
/**
 * (Owner, Nov 4, batch 35 §163) Nothing the page showed waits any more: ONE refusal. Every one confirmed by this developer in another tab: "You already confirmed
 * these payments in another tab at 3:20 PM." ("this payment" for one); otherwise "There's nothing waiting for your bank to confirm."
 */
async function nothingLeftLine(devId: string, body: Seen & Record<string, unknown>) {
  const seenIds = Array.isArray(body.seenIds) ? (body.seenIds as unknown[]).map(String) : [];
  const tab = typeof body.tab === "string" ? body.tab : "";
  if (!seenIds.length || !tab) return T.NOTHING_TO_CONFIRM;
  const { ownOtherTabAction } = await import("./live");
  const mine = await Promise.all(seenIds.map((id) => ownOtherTabAction(devId, `pay:${id}`, tab, ["pay", "pay-more"])));
  if (mine.some((m) => !m)) return T.NOTHING_TO_CONFIRM;
  const last = new Date(Math.max(...mine.map((m) => m!.at.getTime())));
  const tz = (await db.user.findUnique({ where: { id: devId }, select: { timeZone: true } }))?.timeZone ?? null;
  return `You already confirmed ${seenIds.length === 1 ? "this payment" : "these payments"} in another tab at ${fmtTimeIn(last, tz)}.`;
}

async function stopIfChanged(now: Payment[], body: Seen & { tab?: unknown }, at: Date, devId = "") {
  const seen = typeof body.seenTotalCents === "number" ? body.seenTotalCents : null;
  const seenIds = Array.isArray(body.seenIds) ? (body.seenIds as unknown[]).map(String) : null;
  if (seen == null || !seenIds) return;
  const ids = now.map((p) => p.id);
  const total = sum(now);
  if (seen === total && seenIds.length === ids.length && ids.every((i) => seenIds.includes(i))) return;
  const changes: { text: string; at: Date }[] = [];
  for (const p of now.filter((x) => !seenIds.includes(x.id))) changes.push({ text: `Also waiting for your bank now: ${await nameOf(p)}`, at: p.createdAt });
  const gone = seenIds.filter((i) => !ids.includes(i));
  const rows = gone.length ? await db.payment.findMany({ where: { id: { in: gone } } }) : [];
  const { ownOtherTabAction } = await import("./live");
  for (const id of gone) {
    const p = rows.find((x) => x.id === id) ?? null;
    // (Owner, Nov 4, batch 35 §163) Confirmed by this developer in another tab: its own line ("You confirmed Ana Silva's $10.00 charge for her written answers with
    // your bank in another tab"); the total drops and the second press pays the rest.
    const mine = devId && p && typeof body.tab === "string" ? await ownOtherTabAction(devId, `pay:${id}`, body.tab, ["pay", "pay-more"]) : null;
    changes.push({ text: mine ? `You ${mine.text} in another tab` : `${p ? await nameOf(p) : "A payment"}: ${await goneWhy(p)}`, at: p?.settledAt ?? at });
  }
  changes.sort((a, b) => a.at.getTime() - b.at.getTime());
  // (Owner, Nov 3) Over $200 now and the press had no tick: the line says so (the tick shows under the button).
  const tick = total > PAY_TICK_CENTS && body.over200 !== true ? ` ${T.tickToGoOn}` : "";
  changes.push({ text: now.length ? `Confirm all now covers ${now.length} payment${now.length === 1 ? "" : "s"}: ${money(total)}.${tick}` : T.NOTHING_TO_CONFIRM, at });
  throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes, totalCents: total, ids });
}

/** The one check's deadline: the earliest of its charges' own dates, when that comes before the press's 15 minutes. */
export async function clampToEarliest(oneId: string) {
  const one = await db.payment.findUnique({ where: { id: oneId }, select: { actionBy: true } });
  const first = await db.payment.findFirst({ where: { coveredById: oneId, actionBy: { not: null } }, orderBy: { actionBy: "asc" }, select: { actionBy: true } });
  if (one?.actionBy && first?.actionBy && first.actionBy < one.actionBy) await db.payment.update({ where: { id: oneId }, data: { actionBy: first.actionBy } });
}

/** ONE receipt naming every payment it paid: "We charged your card $42.00 for: Ana Silva's written answers on “Harbor Run” $10.00, …". */
export async function allReceipt(email: string, parts: { name: string; cents: number }[], status: string) {
  if (!parts.length) return;
  const cents = sum(parts.map((p) => ({ amountCents: p.cents })));
  const list = parts.map((p) => `${p.name} ${money(p.cents)}`).join(", ");
  const set = status !== "not_set_up";
  const line = set ? `We charged your card ${money(cents)} for: ${list}` : `Receipt: you paid ${money(cents)} for: ${list}`;
  await notify(email, line, [line + ".", set ? "Charged to your saved card." : "Payments aren't set up yet, so this was recorded and nothing was charged."], "/app/payments", { side: "developer", payment: true });
}

/** "Cancel this check" next to the open Confirm all line (another tab's, or one left open). */
export async function cancelAll(devId: string, id: string) {
  const p = await db.payment.findUnique({ where: { id } });
  if (!p || p.developerId !== devId || !isAll(p)) throw new HttpError(404, "not_found", NO_CHECK_WAITING);
  const r = await (await import("./owedOnce")).cancelOwedCheck(devId, id);
  return "paid" in r && r.paid ? r : { cancelled: true, line: T.ALL_CANCELLED };
}

/** The one check's clock ran: cancelled at Stripe first; already approved → paid; its earliest date came → none confirmed; otherwise each goes back. */
export async function expireAll(p: Payment, now: Date) {
  const once = await import("./owedOnce");
  const end = p.actionPi ? await once.dropCheck(p.actionPi) : "cancelled";
  if (p.actionPi && (await db.payment.updateMany({ where: { id: p.id, actionPi: p.actionPi }, data: { actionPi: null } })).count !== 1) return;
  if (end === "succeeded") return void (await (await import("./confirm")).finishConfirmed(p.id));
  const first = await db.payment.findFirst({ where: { coveredById: p.id, settledAt: null }, orderBy: { actionBy: "asc" }, select: { actionBy: true } });
  await releaseAll(p.id, first?.actionBy && first.actionBy <= now ? "ranout" : "back", now);
}

type Outcome = "back" | "paid" | "declined" | "lift" | "later" | "gone";

/**
 * The one payment ended without going through: each charge it covered is let go.
 * - "back": its own "Confirm with your bank" again, with its ORIGINAL date (a new off-session PaymentIntent; a date already past counts as not confirmed).
 * - "ranout": the one check ran out at the earliest date: none was confirmed, each as if its own check had run out.
 * - "defer": a new card was saved (one card in play): each waits, and they're made together on the new card (§117/§122).
 */
export async function releaseAll(id: string, mode: "back" | "ranout" | "defer", now = new Date()) {
  const ended = await db.payment.updateMany({ where: { id, kind: OWED_KIND, status: { in: OWED_ACTIVE } }, data: { status: "cancelled", actionPi: null, actionBy: null } });
  if (ended.count !== 1) return null;
  const out = { charges: [] as Payment[], outcomes: [] as Outcome[] };
  for (const p of await db.payment.findMany({ where: { coveredById: id, settledAt: null, status: "needs_confirmation" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })) {
    try {
      out.outcomes.push(await letGo(p, id, mode, now));
    } catch (e) {
      console.error("[confirm all] let go:", (e as Error).message); // tried again by the clock (it stays under the cancelled check)
      out.outcomes.push("later");
    }
  }
  // Back to their own Confirm: the developer's one bell line for charges waiting for the bank is sent again with them (the day's line updated in place).
  if (out.outcomes.includes("back")) {
    const one = await db.payment.findUnique({ where: { id }, select: { developerId: true } });
    if (one) await (await import("./confirm")).tellBankWaiting(one.developerId).catch((e) => console.error("[confirm all] bell:", (e as Error).message));
  }
  return out;
}

async function letGo(p: Payment, oneId: string, mode: "back" | "ranout" | "defer", now: Date): Promise<Outcome> {
  const free = async (data: Record<string, unknown>) => (await db.payment.updateMany({ where: { id: p.id, coveredById: oneId, settledAt: null, status: "needs_confirmation" }, data: { coveredById: null, ...data } })).count === 1;
  const confirm = await import("./confirm");
  const wait = { status: "deferred", actionPi: null, actionBy: null };
  if (mode === "defer") return (await free(wait)) ? "lift" : "gone";
  if (mode === "ranout" || !p.actionBy || p.actionBy <= now) {
    if (!(await free({ actionPi: null, actionBy: null }))) return "gone";
    await confirm.notConfirmed({ ...p, coveredById: null, actionPi: null, actionBy: null });
    return "declined";
  }
  const dev = await db.user.findUniqueOrThrow({ where: { id: p.developerId } });
  // (§113) During a hold it waits for the lift instead.
  if (dev.holdStartedAt) return (await free(wait)) ? "lift" : "gone";
  // No card to make its check on (cleared meanwhile): it keeps waiting under the cancelled check; the clock tries again (its own date still counts).
  if (stripeOn() && (!dev.stripeCustomerId || !dev.stripePaymentMethodId)) return "later";
  const tester = await db.user.findUniqueOrThrow({ where: { id: p.testerId } });
  let r: Awaited<ReturnType<typeof charge>>;
  try {
    // Its own description, as first charged; one key per charge and Confirm all, so a retry meets the same PaymentIntent.
    r = await charge(dev, tester, p.amountCents, serverKey("confirmback", p.id, oneId), p.stripeDescription ?? (await stripeDescription({ payment: p })), "away");
  } catch (e) {
    if (e instanceof HttpError && e.code === "card_failed") {
      // Declined outright: the usual decline (a payment hold, or added to it).
      if (!(await free({ actionPi: null, actionBy: null, failure: e.message }))) return "gone";
      const holds = await import("./holds");
      await holds.declinedPayment(p.developerId, p.id, p.amountCents, await holds.declinedWhat(p));
      return "declined";
    }
    console.error("[confirm all] back to its own check:", (e as Error).message);
    return "later";
  }
  const paid = { stripePaymentIntentId: r.stripePaymentIntentId, feeCents: r.feeCents, testerCents: r.testerCents, transferStatus: r.transferStatus };
  if (r.status === "requires_action") return (await free({ ...paid, actionPi: r.stripePaymentIntentId })) ? "back" : "gone";
  // It went through at once (the card didn't ask this time): paid as a confirmed one.
  if (!(await free({ ...paid, actionPi: null }))) return "gone";
  await confirm.finishConfirmed(p.id);
  return "paid";
}

/**
 * The clocks for Confirm all: a due one check covering a payment on this piece (the general clock finds the rest), and payments still to go back to their own
 * Confirm (a Stripe error or no card the first time).
 */
export async function expireAllChecks(now: Date, where: { submissionId?: string; callId?: string; contractId?: string; developerId?: string } = {}, due = false) {
  const piece = where.submissionId ? { submissionId: where.submissionId } : where.callId ? { callId: where.callId } : where.contractId ? { contractId: where.contractId } : null;
  const mine = where.developerId ? { developerId: where.developerId } : {};
  if (piece || due) {
    const ids = piece ? (await db.payment.findMany({ where: { ...piece, coveredById: { not: null }, settledAt: null }, select: { coveredById: true } })).map((p) => p.coveredById!) : null;
    for (const p of await db.payment.findMany({ where: { ...mine, ...(ids ? { id: { in: ids } } : {}), kind: OWED_KIND, note: ALL_NOTE, status: { in: OWED_ACTIVE }, actionPi: { not: null }, actionBy: { lte: now } } })) {
      try {
        await expireAll(p, now);
      } catch (e) {
        console.error("[confirm all] expire:", (e as Error).message);
      }
    }
  }
  const stuck = await db.payment.findMany({ where: { ...mine, ...(piece ?? {}), status: "needs_confirmation", settledAt: null, actionPi: null, coveredById: { not: null } } });
  if (!stuck.length) return;
  const ones = new Map((await db.payment.findMany({ where: { id: { in: [...new Set(stuck.map((p) => p.coveredById!))] } } })).map((o) => [o.id, o]));
  for (const p of stuck) {
    const one = ones.get(p.coveredById!);
    if (!one || !isAll(one) || one.status !== "cancelled") continue;
    try {
      await letGo(p, one.id, "back", now);
    } catch (e) {
      console.error("[confirm all] back to its own check:", (e as Error).message);
    }
  }
}
