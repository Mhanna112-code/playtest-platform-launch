import type { TestEventLike } from "@/lib/rules";
import { alertOf } from "@/lib/alerts";
import type { Press } from "@/lib/server/live";

/**
 * (Owner, Nov 10, §373) The developer's always-stop rules, with no database: the server builds a stop box with them (lib/server/live.ts devChanges, devGate),
 * and an open stop box on the page runs the very same ones on each line added to it live (lib/live.ts boxKeeps), so a line joins the box only when the
 * server would have put it there.
 */
export const PAY_ACTS = ["pay", "pay-more"] as const;

/** (Owner, Nov 3) A line recording the team's dispute decision ("The team decided Ana Silva's dispute: …"). */
export const isTeamDecision = (c: { kind: string; text: string }) => c.kind === "admin" && c.text.startsWith("The team decided ");

/** (Owner, Nov 4, §171 A2) The testers (contracts) a developer press is about: a payment press's `stopCheck`, and every "c:<contract>" it touches (End early, call requests and their answers or cancels). */
export const pressContracts = (press?: Press) => (press ? [...(press.stopCheck ? [press.stopCheck] : []), ...press.keys.filter((k) => k.startsWith("c:")).map((k) => k.slice(2))] : []);
/** A payment press (Pay, Pay more, Confirm with your bank: `payPressOf`): its tester's contract, else null. */
export const payContractOf = (press?: Press) => (press?.stopCheck && press.acts.some((x) => (PAY_ACTS as readonly string[]).includes(x)) ? press.stopCheck : null);
/** (§171 A1) The line is about the very part a payment press pays ("sub:<id>" / "call:<id>" among its keys). */
const onPart = (c: TestEventLike, press?: Press) => {
  const id = c.piece ?? (c.kind === "sent" ? c.item : undefined);
  return !!id && !!press && (press.keys.includes(`sub:${id}`) || press.keys.includes(`call:${id}`));
};

/** Forced checks for departures, disputes, team decisions and tester charges.
 * Ordinary same-part work and payments follow Alerts, except (§362) work on the part a Needs you Pay / Pay more pays (`fromNeeds`).
 */
/** (§362) Work sent, updated or added (the "sent" line; "sentpaid" at the cap) on a part this payment press pays. */
const sentOnPart = (c: TestEventLike, press?: Press) => (c.kind === "sent" || c.kind === "sentpaid") && !!c.item && !!press && (press.keys.includes(`sub:${c.item}`) || press.keys.includes(`call:${c.item}`));
export function alwaysStops(c: TestEventLike & { contractId?: string | null }, press?: Press) {
  if (press?.awayCharge) {
    // (§171 item 7) As before §171: the team's decision about that tester. (Owner, Nov 9, §340) That tester leaving no longer forces it: it follows the
    // developer's "Testers leaving" Alerts tick, as any other leave does.
    const pc = payContractOf(press);
    // (Owner, Nov 4, §193) And a charge about that same tester, except a charge on a part this press itself confirms (`confirms`: the waiting charge's own line,
    // which the box already shows as its row; Confirm all: every part it covers): stopping for it could only show the press what it is paying.
    const ownCharge = !!c.piece && (onPart(c, press) || !!press.confirms?.includes(c.piece));
    // (Owner, Nov 5) A dispute by that tester forces it too, like the team's decision and a charge (it followed the Disputes tick before).
    return !!pc && ((c.kind === "dispute" || isTeamDecision(c) || (!!c.charge && !ownCharge)) && c.contractId === pc);
  }
  // (Owner, Nov 4, §193) A charge about the tester (their Charge on any part, an automatic call charge, the team's dispute-decision charge) stops every press about
  // that tester once, exactly like a dispute (§171 A2). Presses about the whole test and about other testers follow the Payments tick.
  if ((c.kind === "dispute" || isTeamDecision(c) || !!c.charge) && !!c.contractId && pressContracts(press).includes(c.contractId)) return true;
  const payContract = payContractOf(press);
  if (!payContract) return false;
  // (Owner, Nov 9, §362) Needs you's Pay / Pay more: work on the very part being paid always stops it once (forced). Other payments on it, its call problem /
  // length lines, other parts and other testers follow Alerts.
  if (press?.fromNeeds && sentOnPart(c, press)) return true;
  return c.kind === "left" && c.contractId === payContract;
}

/**
 * (Design doc 6; batch 35 §73, §159, §171 A3) Whether a developer's line stops this press under this test's Alerts ticks (`ignored`): one with no Alerts type, one
 * whose type isn't ticked off, one that always stops this press, and (an open bank window) every line about its tester.
 */
export function devKeeps(c: TestEventLike & { contractId?: string | null }, ignored: ReadonlySet<string>, press?: Press) {
  const a = alertOf(c.kind);
  return !a || !ignored.has(a) || alwaysStops(c, press) || (!!press?.wholeTester && !!press.stopCheck && c.contractId === press.stopCheck);
}
