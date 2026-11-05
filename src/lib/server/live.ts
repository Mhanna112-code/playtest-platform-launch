import { renderTimes } from "@/lib/tz";
import { dateZone } from "./dateZone";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, fmtDateTime, money } from "@/lib/server/dateFormat";
import { DEV_QUIET_KINDS, DEV_STOP_KINDS, delayedPayLine, partWhen, switchedLine, type TestEventLike } from "@/lib/rules";
import { alertOf } from "@/lib/alerts";
import { INFO_FIELDS, LISTING_SAVE, SAVED_ELSEWHERE_LINE, editedLine, ndaAgainLine, parseSave, saveLine } from "@/lib/listingSave";
import { LISTING_SAVED, panelKeysOf, parseSaved } from "@/lib/listingPanel";
import { callMinutesOf } from "@/lib/callMeasure";
import { sidOf } from "./shownLines";

type Tx = Prisma.TransactionClient;

// (Owner, Oct 22, NEWEST+3) Reason E: anything a person did themselves in ANOTHER tab since this page loaded stops the
// first press once ("You sent your written answers in another tab"; batch 29 sections 12-13). Every action is logged
// with the browser tab (page load) that sent it; that same tab never stops for its own presses.

export const tabOf = (body: Record<string, unknown>) => (typeof body.tab === "string" ? body.tab.slice(0, 64) : "");

/**
 * (Owner, Oct 28, batch 16 section 21) What an action was about, kept with its log line (after META, so no new column): the press (`a`, e.g. "pay")
 * and the things it touched (`k`: "c:<contract>", "sub:<id>", "call:<id>", "req:<id>", "t:<tester>", "set:<id>", "app:<id>", "test").
 */
export type OwnAbout = { a: string; k: string[]; /** (Batch 35 §34) a listing Save's consequences ("re-sent fbbb's invite"): each its own line */ x?: string[]; answers?: Answers };
const META = "\u001f";
/**
 * A press on the developer's side. (Owner, Oct 31, batch 35 §67) Every action of theirs made in another tab stops EVERY press on the test page and on Edit once.
 */
export type Press = {
  acts: readonly string[]; keys: readonly string[];
  /** (Batch 16 sections 21 and 25) Stop on a test another tab stopped after this page loaded: it still stops once, then it's refused. */
  inState?: boolean;
  /** (Batch 17 section 12) Pay / Pay more on this contract: a stop (or that tester's work ended early) since the page loaded stops it once ("" = test-wide only). */
  stopCheck?: string;
  /** (Batch 35 §79) What the press answers: the change lines about that very thing never stop it. */
  answers?: Answers;
  /**
   * (Owner, Nov 4, §171 A3) The blue notice inside an open bank window (the peek, never a press): every line about the payment's tester (`stopCheck`'s contract) is
   * listed whatever the Alerts ticks; lines about other testers keep following them.
   */
  wholeTester?: boolean;
  /**
   * (Owner, Nov 4, §171 item 7) "Confirm with your bank" on a charge made while away, and Confirm all's items: their press-time gate keeps §159's always-stop rules
   * (not §171 A1/A2) while the owner decides the waiting-charge rules. Their open windows still get A3 and B4.
   */
  awayCharge?: boolean;
  /** (Owner, Nov 4, §193) With `awayCharge`: the parts (submission or call ids) this press confirms. Confirm all: every covered part; a charge line on one never forces. */
  confirms?: readonly string[];
};
/**
 * (Owner, Oct 31, batch 35 §79) A press never stops once for the line about the very thing it answers (Accept on a call request that just arrived, Accept on an
 * application just made, Join from an invite just re-sent). Matched on the line's item id where it carries one, else on its kind and the contract (or its exact
 * text, for an application, which has no contract yet). Every other unseen change still stops.
 * (Owner, Nov 3, batch 35 §155) Narrowed: Pay, Pay more and Confirm with your bank on a piece no longer answer that piece's own work lines (payPressOf).
 */
export type Answers = {
  item?: string; kinds?: readonly string[]; contractId?: string | null; texts?: readonly string[];
  /** A piece of work: its line names it ("… written answers" / "… recording"), so another piece of the same tester's still stops (§86: a Pay's logged answer). */
  label?: string;
};
export const answersIt = (e: TestEventLike & { contractId?: string | null }, a?: Answers) => {
  if (!a) return false;
  if (a.item && e.item) return e.item === a.item;
  if (!a.kinds?.includes(e.kind)) return false;
  // (Batch 35 §89) The tester's own "joined" line names no piece: paying their work answers it too.
  if (a.label && e.kind !== "joined" && !e.text.includes(` ${a.label}`)) return false;
  return (!!a.contractId && e.contractId === a.contractId) || !!a.texts?.includes(e.text);
};
export type OwnEvent = TestEventLike & { about?: OwnAbout; live?: string };
export const CALL_ACTS = ["request-time", "answer-request", "cancel-call", "cancel-set", "no-show"] as const;
/** The call changes (request, withdraw, accept, decline, cancel). (Batch 16 section 26: no Lower the length.) */
export const CALL_CHANGE_ACTS = ["request-time", "answer-request", "cancel-call", "cancel-set"] as const;
export const PAY_ACTS = ["pay", "pay-more"] as const;
/**
 * (Owner, Oct 29, batch 26 section 9) The ONE press description Pay, Pay more and "Confirm with your bank" on a piece share, so Confirm stops for exactly what Pay on
 * that piece stops for (the same devGate call, the same Alerts types): another tab's Pay or Pay more on the piece, and a stop of the test or of that tester's work.
 */
export const payPressOf = (contractId: string, piece: { callId?: string | null; submissionId?: string | null }) => ({
  acts: [...PAY_ACTS] as string[], keys: [piece.callId ? `call:${piece.callId}` : piece.submissionId ? `sub:${piece.submissionId}` : `c:${contractId}`], stopCheck: contractId,
  // (Owner, Nov 3, batch 35 §155; narrows §79) The piece's own work lines ("sent their …", "updated their …", "added to …") are changes like any other: one the
  // page hasn't shown yet stops the press once, naming it; one it already showed (redrawn, the pill, the top box) is before its seen time and never stops.
  // (Owner, Oct 31, batch 35 §89) Kept: that tester joining. Paying their work, you know they're in ("fbbb joined" doesn't stop Pay on fbbb's answers).
  answers: { kinds: ["joined"], contractId },
});
export const INVITE_ACTS = ["invite", "cancel-invite"] as const;
/**
 * (Owner, Oct 29, batch 29 section 12) The developer's own changes made in another tab or device that stop EVERY developer press on the test page and on Edit once:
 * an Edit save (any field), Pay, Pay more (and Confirm with your bank, logged as the Pay it finishes), End early, Stop, any call change
 * (request, withdraw, accept, decline, cancel), Invite / Cancel invite, Accept / Decline of an application or rejoin ask. Ratings and excerpt decisions are never lines
 * (they only race with the same press). Not in Alerts (your own actions can't be switched off). (Owner, Nov 3, batch 35 §168) Next round is no longer one: it
 * never changes this test.
 */
export const BIG_OWN_ACTS = ["end-early", "stop", "edit", ...PAY_ACTS, ...CALL_CHANGE_ACTS, ...INVITE_ACTS, "application"] as const;
/** (Batch 29 section 12) The same changes show in the live top box at once (and raise the pill), on the test page and on Edit. */
export const LIVE_OWN_ACTS = BIG_OWN_ACTS;
const has = (list: readonly string[], a?: string) => !!a && list.includes(a);
/** Does this action from another tab touch this press? */
export const touches = (o: OwnEvent, p: Press) => !!o.about && p.acts.includes(o.about.a) && o.about.k.some((k) => p.keys.includes(k) || p.keys.includes("*"));

/** Log one thing a person did on a test (any button that changes something), with what it was about. */
export async function logAction(userId: string, testId: string, body: Record<string, unknown>, text: string, about?: OwnAbout) {
  await db.actionLog.create({ data: { userId, testId, text: about ? `${text}${META}${JSON.stringify(about)}` : text, tab: tabOf(body) } });
}

/** A log line's text and what it was about. */
function parseLog(raw: string): { text: string; about?: OwnAbout } {
  const i = raw.indexOf(META);
  if (i < 0) return { text: raw };
  try {
    const about = JSON.parse(raw.slice(i + 1)) as OwnAbout;
    return { text: raw.slice(0, i), about: typeof about?.a === "string" && Array.isArray(about.k) ? about : undefined };
  } catch {
    return { text: raw.slice(0, i) };
  }
}

export function seenOf(v: unknown): Date | null {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? d : null;
}

/** (Batch 35 §86) Answers persist across page loads and devices. Never cap the history.
 * Only changes before the answer are seen; own other-tab actions still stop (§67).
 */
export async function unanswered<T extends TestEventLike & { contractId?: string | null }>(userId: string, testId: string, lines: T[], tx: Tx | typeof db = db): Promise<T[]> {
  if (!lines.length) return lines;
  const since = new Date(Math.min(...lines.map((e) => e.createdAt.getTime())));
  const rows = await tx.actionLog.findMany({ where: { userId, testId, createdAt: { gt: since } }, select: { text: true, createdAt: true } });
  const logs = rows.map((r) => ({ ...parseLog(r.text), at: r.createdAt }));
  // Existing developer logs already have item keys. Reuse them too; older tester logs
  // had no keys, so new tester answers now retain the exact id in the same metadata.
  const oldPieces = logs.flatMap(({ about }) => !about?.answers && about && (about.a === "pay" || about.a === "pay-more") ? about.k.filter((k) => k.startsWith("sub:")).map((k) => k.slice(4)) : []);
  const kinds = oldPieces.length ? await subKinds(oldPieces, tx) : new Map<string, string>();
  const answers = logs.flatMap(({ about, text, at }) => {
    const key = (prefix: string) => about?.k.find((k) => k.startsWith(prefix))?.slice(prefix.length);
    let a = about?.answers;
    const sub = key("sub:"), request = key("req:"), app = key("app:"), dispute = key("dispute:");
    if (!a && sub && (about?.a === "pay" || about?.a === "pay-more")) a = { item: sub, kinds: ["sent", "sentpaid"], contractId: key("c:"), label: kinds.get(sub) === "recording" ? "recording" : "written answers" };
    if (!a && request && about?.a === "answer-request" && /^(accepted|declined) /.test(text)) a = { item: request, kinds: ["requested"], contractId: key("c:") };
    if (!a && app && about?.a === "application") {
      const name = /^(?:accepted|declined) (.*)'s application$/.exec(text)?.[1];
      a = { item: app, kinds: ["applied"], texts: name ? [`${name} applied to join`, `${name} asks to rejoin`] : [] };
    }
    if (!a && dispute && about?.a === "dispute-side") a = { item: dispute };
    return a ? [{ a, at }] : [];
  });
  return lines.filter((e) => e.kind === "own" || !answers.some(({ a, at }) => at > e.createdAt && answersIt(e, a)));
}

/**
 * (Owner, Nov 4, batch 35 §163) This developer's LATEST own action that touched `key` ("sub:<id>", "call:<id>", "pay:<payment>"), of one of `acts`, when it was
 * made in ANOTHER tab than `tab` (null when none, or when the latest was this tab's or a page that sends no tab): its log text and time. A press it settled is
 * refused at once naming it ("You already paid $10.00 for Ana Silva's written answers in another tab at 3:20 PM.").
 */
export async function ownOtherTabAction(userId: string, key: string, tab: string, acts: readonly string[], tx: Tx | typeof db = db) {
  if (!tab) return null;
  const rows = await tx.actionLog.findMany({ where: { userId, text: { contains: `"${key}"` } }, orderBy: { createdAt: "desc" }, take: 20 });
  for (const r of rows) {
    const { text, about } = parseLog(r.text);
    if (!about || !about.k.includes(key) || !acts.includes(about.a)) continue;
    return r.tab && r.tab !== tab ? { text, at: r.createdAt } : null;
  }
  return null;
}

/** This person's own actions on the test since `since`, from other tabs. */
export async function ownChanges(userId: string, testId: string, since: Date, tab: string, tx: Tx | typeof db = db): Promise<OwnEvent[]> {
  const rows = await tx.actionLog.findMany({ where: { userId, testId, createdAt: { gt: since }, ...(tab ? { tab: { not: tab } } : { tab: { not: "" } }) }, orderBy: { createdAt: "asc" }, take: 50 });
  return rows.map((r) => {
    const { text, about } = parseLog(r.text);
    // (Batch 16 section 21; batch 29 sections 12 and 13) One wording on both sides, in the stop box and the live box: "You invited Ana Silva in another tab".
    const own = text.startsWith("You ") ? text : `You ${text} in another tab`;
    return { kind: "own", text: renderTimes(own, dateZone()), createdAt: r.createdAt, ...(about ? { about } : {}), live: renderTimes(own, dateZone()) };
  });
}

/**
 * The developer's stop-once reasons on a test since `since`: what testers did (joined, left, sent, calls, requests,
 * charges...) plus the developer's own actions in another tab. The developer's own events ("You paid ...") come only
 * through the action log, so the tab that did them never stops for them.
 */
export async function devChanges(devId: string, testId: string, since: Date, tab: string, tx: Tx | typeof db = db, opts: { all?: boolean; press?: Press } = {}): Promise<TestEventLike[]> {
  // (Batch 14) The live box (`all`) also lists the quiet kinds: a tester's Switch (stacked per day) and a key reported as not working. They never stop a press.
  const events = stackSwitches(await tx.testEvent.findMany({ where: { testId, createdAt: { gt: since }, kind: { in: [...DEV_STOP_KINDS, "renamed", ...(opts.all ? DEV_QUIET_KINDS : [])] } }, orderBy: { createdAt: "asc" }, take: 100 }));
  // (Owner, Oct 28) The developer's OWN listing edit (from another tab) is already said once, in their own voice, by the action log ("You saved the listing in another tab: description, access keys"):
  // its listing-info event ("Nora Lane changed the description") is dropped, and a rename of their own reads "You renamed the test to ...".
  const me = displayName(await tx.user.findUniqueOrThrow({ where: { id: devId } }));
  const mine = await ownChanges(devId, testId, since, tab, tx);
  const ownRenames = events.filter((e) => e.kind === "renamed" && e.text.startsWith(`${me} `));
  const saves = ownRenames.length ? await savesUpTo(testId, ownRenames[ownRenames.length - 1].createdAt, tx) : [];
  const theirs = events.filter((e) => !e.text.startsWith("You ")).flatMap((e): (typeof e & { listing?: boolean; item?: string; eventId?: string })[] => {
    if (e.kind === "info" && e.text.startsWith(`${me} `)) return [];
    if (e.kind === "renamed" && e.text.startsWith(`${me} `)) {
      // (Batch 30, Oct 29 addition) One line per save: a rename saved in another tab with other fields is already in that save's line ("title (now “X”)").
      const title = e.text.slice(`${me} renamed the test to `.length);
      if (mine.some((o) => o.about?.a === "edit" && o.text.includes(`title (now “${title}”)`))) return [];
      // (Batch 35 §17, seen on video Oct 31) The Save's own line is written to the action log only after its transaction (and its response): a poll in that moment
      // (the other tab's page redraw asks at once) found the rename without it, and the live box keeps every line it got, so the next poll's Save line made two.
      // The Save's own record says it at once: a Save of more than the title (or with the access keys) from another tab has that line, so its rename isn't one.
      if (hasSaveLine(saves.find((x) => x.createdAt.getTime() <= e.createdAt.getTime()), tab)) return [];
      // (Batch 35 §34) The tab that saved it: its own Save (the rename in it) is never a line there.
      const sv = saves.find((x) => x.createdAt.getTime() <= e.createdAt.getTime());
      if (tab && sv?.tab === tab) return [];
      return [{ ...e, text: e.text.replace(`${me} `, "You "), listing: true }];
    }
    // (Owner, Nov 4, §171 A1) A line about one part ("part-<submission>", "call-<call>": work sent, a Charge, an automatic call charge…) names it (`piece`), so a
    // payment press on that very part always stops for it.
    const piece = /^(?:part|call)-/.test(e.link) ? e.link.replace(/^(?:part|call)-/, "") : "";
    // (Owner, Nov 4, §193) A charge about a tester: their Charge on a part, or an automatic call charge on one of their calls (a "paid" line on a part that isn't the
    // developer's own "You paid …"; those never reach here). A call closed with nothing to pay charged nothing: not a charge.
    const charge = e.kind === "paid" && !!piece && !!e.contractId && !e.text.endsWith(" closed with nothing to pay");
    // (Owner, Nov 5, §250) The line is this test event: its row id is its identity once a stop box listed it.
    return [{ ...e, eventId: e.id, ...(/^(?:req|part|item-app|item-dispute)-/.test(e.link) ? { item: e.link.replace(/^(?:req|part|item-app|item-dispute)-/, "") } : {}), ...(piece ? { piece } : {}), ...(charge ? { charge } : {}) }];
  });
  // (Owner, Oct 29, batch 29 section 12) What the developer did in another tab can't be switched off in Alerts: the changes in BIG_OWN_ACTS show in the live box;
  // (batch 35 §67) every action of theirs in another tab stops every press on the test page and on Edit once (Edit's Save turns another tab's Save into its per-field lines). A line reads "You paid Ana Silva $10.00 for the written answers in another tab".
  const own = mine.flatMap((o): TestEventLike[] => {
    // (Batch 34 §14) A listing Save in another tab: its line carries See it to the test page's Listing panel. (Batch 35 §34) What it closed or re-sent: own lines.
    const line = { kind: "own", text: o.live ?? o.text, createdAt: o.createdAt, ...(o.about?.a === "edit" ? { listing: true } : {}) };
    const lines: TestEventLike[] = [line, ...(o.about?.a === "edit" ? (o.about.x ?? []).map((x) => ({ kind: "own", text: consequenceLine(x), createdAt: o.createdAt, save: true })) : [])];
    if (opts.all) return has(LIVE_OWN_ACTS, o.about?.a) ? lines : [];
    // (Owner, Oct 31, batch 35 §67) ANY action of theirs in another tab since the page's seen time stops every press once (no longer only BIG_OWN_ACTS or a
    // press it touches), on the test page and on Edit, both ways.
    return opts.press ? lines : [];
  });
  // (Owner, Oct 31, batch 35 §34) Every listing change of the developer's own since the page's seen time (Saves in other tabs, renames) is ONE line: "You saved
  // the listing in another tab · See it", at the latest one, marking every field any of them changed; a Save's consequences keep their own lines.
  const listing = await collapseListing([...theirs, ...own], SAVED_ELSEWHERE_LINE, testId, since, tab, tx);
  const calls = opts.all ? [] : await payCallLines(since, opts.press, tx);
  const all = await withSaveAt(testId, [...listing, ...calls, ...(await devPaymentChanges(devId, testId, since, tx))].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()), tx);
  // (Design doc 6) Update types the developer ignores in the Alerts menu no longer stop a press (the live box still lists them, greyed).
  if (opts.all) return all;
  const loud = await unanswered(devId, testId, all.filter((c) => !c.quiet), tx);
  // (Batch 35 §73) The ticks of this test's own Alerts menu.
  const ignored = new Set((await tx.test.findUnique({ where: { id: testId }, select: { ignoredAlerts: true } }))?.ignoredAlerts ?? []);
  // (Owner, Nov 3, batch 35 §159 rule 1; narrows the same day's "any part") The team's dispute decision about the SAME tester (any of their parts in this test: the
  // decision's contract is the press's) always stops a payment press once (Pay, Pay more, Confirm with your bank), even with "Decisions by the team" ticked: what
  // was decided changes what that tester is owed. A decision about ANOTHER tester follows the Alerts ticks like every other line.
  // (§159 rule 2) Likewise the tester's sent, updated or added work on the SAME part being paid ("sent" lines carry the part as their item) always stops once,
  // even with "Work sent" ticked; work on their other parts, and other testers' work, follows the tick.
  // (§159) And that tester leaving the test (or being removed: a suspension or deletion reads "left") always stops a payment press on THEIR parts; another tester
  // leaving follows "Testers leaving".
  // (Owner, Nov 4, §171) Widened: anything on the part being paid, and a dispute by the press's tester or the team's decision on it, for every press about that
  // tester (alwaysStops). (§171 A3) The blue notice in an open bank window lists everything about the payment's tester whatever the ticks (`wholeTester`).
  const press = opts.press;
  const keep = (c: TestEventLike & { contractId?: string | null }) => {
    const a = alertOf(c.kind);
    return !a || !ignored.has(a) || alwaysStops(c, press) || (!!press?.wholeTester && !!press.stopCheck && c.contractId === press.stopCheck);
  };
  return ignored.size ? loud.filter(keep) : loud;
}

/** (Owner, Nov 4, §171 A2) The testers (contracts) a developer press is about: a payment press's `stopCheck`, and every "c:<contract>" it touches (End early, call requests and their answers or cancels). */
export const pressContracts = (press?: Press) => (press ? [...(press.stopCheck ? [press.stopCheck] : []), ...press.keys.filter((k) => k.startsWith("c:")).map((k) => k.slice(2))] : []);
/** A payment press (Pay, Pay more, Confirm with your bank: `payPressOf`): its tester's contract, else null. */
const payContractOf = (press?: Press) => (press?.stopCheck && press.acts.some((x) => (PAY_ACTS as readonly string[]).includes(x)) ? press.stopCheck : null);
/** (§171 A1) The line is about the very part a payment press pays ("sub:<id>" / "call:<id>" among its keys). */
const onPart = (c: TestEventLike, press?: Press) => {
  const id = c.piece ?? (c.kind === "sent" ? c.item : undefined);
  return !!id && !!press && (press.keys.includes(`sub:${id}`) || press.keys.includes(`call:${id}`));
};

/**
 * (§159) The lines that stop a payment press (Pay, Pay more, Confirm with your bank: `payPressOf`) whatever the Alerts ticks: the team's decision about that same
 * tester, that tester leaving (or removed), and work sent, updated or added on the very part being paid.
 * (Owner, Nov 4, §171 A1) Same part always stops: ANYTHING on the part being paid (work sent, updated or added; a dispute on it; another payment on it: a Charge,
 * an automatic call charge, a team decision's charge; for a call, a problem the tester reported and its length becoming final: `payCallLines`).
 * (§171 A2) A dispute by the tester a press is about, or the team's decision on one, stops EVERY press about that tester once (Pay, Pay more, Confirm with your
 * bank on any of her parts; End early including her; call requests with her and answering or cancelling them). Presses about the whole test and about other
 * testers follow the Disputes / Decisions ticks.
 * (Owner, Nov 4, §193) A charge about that tester (`charge`: their Charge on any part, an automatic call charge, the team's dispute-decision charge) stops the
 * same presses once; the developer's own payments are never charges. Presses about the whole test and about other testers follow the Payments tick.
 */
export function alwaysStops(c: TestEventLike & { contractId?: string | null }, press?: Press) {
  if (press?.awayCharge) {
    // (§171 item 7) As before §171: the team's decision about that tester, that tester leaving, work sent on the very part.
    const pc = payContractOf(press);
    // (Owner, Nov 4, §193) And a charge about that same tester, except a charge on a part this press itself confirms (`confirms`: the waiting charge's own line,
    // which the box already shows as its row; Confirm all: every part it covers): stopping for it could only show the press what it is paying.
    const ownCharge = !!c.piece && (onPart(c, press) || !!press.confirms?.includes(c.piece));
    // (Owner, Nov 5) A dispute by that tester forces it too, like the team's decision and a charge (it followed the Disputes tick before).
    return !!pc && (((c.kind === "dispute" || isTeamDecision(c) || c.kind === "left" || (!!c.charge && !ownCharge)) && c.contractId === pc) || (c.kind === "sent" && !!c.item && press.keys.includes(`sub:${c.item}`)));
  }
  // (Owner, Nov 4, §193) A charge about the tester (their Charge on any part, an automatic call charge, the team's dispute-decision charge) stops every press about
  // that tester once, exactly like a dispute (§171 A2). Presses about the whole test and about other testers follow the Payments tick.
  if ((c.kind === "dispute" || isTeamDecision(c) || !!c.charge) && !!c.contractId && pressContracts(press).includes(c.contractId)) return true;
  const payContract = payContractOf(press);
  if (!payContract) return false;
  return (c.kind === "left" && c.contractId === payContract) || onPart(c, press);
}

/**
 * (Owner, Nov 4, §171 A1) A payment press on a call: what changed on that call itself that no test event says: the tester reported a problem with it, or its
 * measured length became final. Never in the live box; forced (no Alerts type).
 */
async function payCallLines(since: Date, press: Press | undefined, tx: Tx | typeof db): Promise<TestEventLike[]> {
  const id = payContractOf(press) && !press!.awayCharge ? press!.keys.find((k) => k.startsWith("call:"))?.slice(5) : undefined;
  if (!id) return [];
  const call = await tx.call.findUnique({ where: { id }, include: { contract: { include: { tester: true } } } });
  if (!call) return [];
  const name = displayName(call.contract.tester), when = fmtDateTime(call.startsAt);
  const out: TestEventLike[] = [];
  if (call.noShowBy === "tester" && call.noShowAt && call.noShowAt > since)
    out.push({ kind: CALL_PROBLEM, text: callProblemLine(name, when, call.noShowNote), createdAt: call.noShowAt, contractId: call.contractId, piece: id } as TestEventLike);
  const minutes = callMinutesOf(call);
  if (call.measuredAt && call.measuredAt > since && minutes != null)
    out.push({ kind: CALL_LENGTH, text: callLengthLine(name, when, minutes), createdAt: call.measuredAt, contractId: call.contractId, piece: id } as TestEventLike);
  return out;
}
/** (§171 A1) The kinds of `payCallLines`' lines (no Alerts type: always forced). */
export const CALL_PROBLEM = "call_problem", CALL_LENGTH = "call_length";
/** "Ana Silva reported a problem with the call on Thu, Nov 5, 3:00 PM: Was late" */
export const callProblemLine = (name: string, when: string, note: string) => `${name} reported a problem with the call on ${when}${note.trim() ? `: ${note.trim().replace(/\.$/, "")}` : ""}`;
/** "The length of the call with Ana Silva on Thu, Nov 5, 3:00 PM is final: 42 minutes" */
export const callLengthLine = (name: string, when: string, minutes: number) => `The length of the call with ${name} on ${when} is final: ${minutes} minute${minutes === 1 ? "" : "s"}`;
/** (Owner, Nov 3, §160) A developer's stop line that no Alerts tick could switch off: one with no Alerts type (own other-tab actions, a stop, a listing change…) or one that always stops this press. */
export const devForced = (c: TestEventLike & { contractId?: string | null }, press?: Press) => !alertOf(c.kind) || alwaysStops(c, press);

/** (Owner, Nov 3) A line recording the team's dispute decision ("The team decided Ana Silva's dispute: …"). */
export const isTeamDecision = (c: { kind: string; text: string }) => c.kind === "admin" && c.text.startsWith("The team decided ");

/** (Batch 35 §34) A listing Save's consequence as its own line: "You re-sent fbbb's invite (the listing changed)". */
export const consequenceLine = (x: string) => `You ${x}${/\)$/.test(x) ? "" : " (the listing changed)"}`;

/**
 * (Owner, Oct 31, batch 35 §34; replaces batch 34 §8's one line per Save naming its fields) All the listing lines among `lines` (`listing`: a Save's line, a rename)
 * become ONE line with `text` and no field list, at the latest one's time, keyed "listing" (a box replaces its earlier one), with every panel line any listing
 * Save since `since` changed (`keys`: See it marks the union; `tab`: only other tabs' Saves). A rename alone stays info only (kind "renamed": it never stops).
 */
export async function collapseListing(lines: TestEventLike[], text: string, testId: string, since: Date, tab: string | null, tx: Tx | typeof db = db): Promise<TestEventLike[]> {
  const ls = lines.filter((l) => l.listing);
  if (!ls.length) return lines;
  const latest = ls.reduce((a, l) => (l.createdAt > a.createdAt ? l : a), ls[0]);
  const saves = await tx.testEvent.findMany({ where: { testId, kind: LISTING_SAVED, createdAt: { gt: since, lte: latest.createdAt } }, select: { text: true, tab: true } });
  const fields = saves.filter((s) => tab == null || (tab ? s.tab !== tab : true)).flatMap((s) => parseSaved(s.text)?.fields ?? []);
  const renamedOnly = ls.every((l) => l.kind === "renamed");
  const one: TestEventLike = { kind: renamedOnly ? "renamed" : latest.kind === "renamed" ? "own" : latest.kind, text, createdAt: latest.createdAt, listing: true, key: "listing", keys: panelKeysOf(fields.length ? fields : renamedOnly ? ["title"] : []) };
  return [...lines.filter((l) => !l.listing), one];
}

/** (Batch 35 §17) The listing Saves' records up to `at`, newest first (each rename sits in its Save's transaction, after that Save's record). */
async function savesUpTo(testId: string, at: Date, tx: Tx | typeof db) {
  return tx.testEvent.findMany({ where: { testId, kind: LISTING_SAVED, createdAt: { lte: at } }, orderBy: { createdAt: "desc" }, take: 50, select: { createdAt: true, text: true, tab: true } });
}

/**
 * (Batch 35 §17) Does this listing Save have its own "You saved the listing in another tab: …" line for a page in `tab`? Its action log line exists when the Save
 * changed more than the title, or the access keys too (a rename alone is its own line: actionText "edit"); the page sees it when the Save came from another tab
 * (ownChanges: another tab's row; a page without a tab sees the rows that have one).
 */
export function hasSaveLine(save: { text: string; tab: string } | undefined, tab: string) {
  const v = save ? parseSaved(save.text) : null;
  if (!save || !v || !(v.fields.some((f) => f !== "title") || v.keys)) return false;
  return tab ? save.tab !== tab : save.tab !== "";
}

/**
 * (Owner's finding, Oct 30, batch 35 §3) Each listing line names the Save it is about: the time of that Save's record (the newest "listing_saved" at or before the
 * line; the Save writes it, then its line). The test page's Listing panel says which Save it shows, so See it marks that Save's fields only, after a redraw when the
 * line is newer than the panel.
 */
async function withSaveAt(testId: string, lines: TestEventLike[], tx: Tx | typeof db): Promise<TestEventLike[]> {
  const ls = lines.filter((l) => l.listing);
  if (!ls.length) return lines;
  const newest = Math.max(...ls.map((l) => l.createdAt.getTime()));
  const saves = await tx.testEvent.findMany({ where: { testId, kind: LISTING_SAVED, createdAt: { lte: new Date(newest) } }, orderBy: { createdAt: "desc" }, take: 50, select: { createdAt: true } });
  return lines.map((l) => {
    if (!l.listing) return l;
    const s = saves.find((x) => x.createdAt.getTime() <= l.createdAt.getTime());
    return s ? { ...l, saveAt: s.createdAt } : l;
  });
}

/** (Batch 14 section 4) Several testers switching in one day: one line, "3 testers switched to the new terms" (at the latest one; no contract link). */
function stackSwitches<T extends { kind: string; createdAt: Date; contractId: string | null; text: string }>(events: T[]): T[] {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const byDay = new Map<string, T[]>();
  for (const e of events) if (e.kind === "terms") byDay.set(day(e.createdAt), [...(byDay.get(day(e.createdAt)) ?? []), e]);
  return events.flatMap((e) => {
    if (e.kind !== "terms") return [e];
    const same = byDay.get(day(e.createdAt))!;
    if (same.length === 1) return [e];
    return e === same[same.length - 1] ? [{ ...e, contractId: null, text: switchedLine(same.length) }] : [];
  });
}

async function subKinds(ids: (string | null)[], tx: Tx | typeof db = db) {
  const subs = await tx.submission.findMany({ where: { id: { in: ids.filter((x): x is string => !!x) } }, select: { id: true, kind: true } });
  return new Map(subs.map((s) => [s.id, s.kind]));
}
/**
 * (Owner, Nov 4, §177) WHICH part a payment line is about: a call with its date and time ("live call on Tue, Oct 27, 8:00 AM"); a dispute decision names the part
 * it decided ("dispute decision on the live call on Tue, Oct 27, 8:00 AM"). `starts`: the payments' calls' starts.
 */
const partLabel = (p: { kind: string; callId: string | null; submissionId: string | null }, kinds: Map<string, string>, starts: Map<string, Date>) => {
  const part = partWhen(p.callId ? "live call" : kinds.get(p.submissionId ?? "") === "recording" ? "recording" : "written answers", p.callId && starts.has(p.callId) ? fmtDateTime(starts.get(p.callId)!) : null);
  return p.kind === "dispute" ? (p.callId || p.submissionId ? `dispute decision on the ${part}` : "dispute decision") : part;
};
async function callStarts(ids: (string | null)[], tx: Tx | typeof db = db) {
  const calls = await tx.call.findMany({ where: { id: { in: ids.filter((x): x is string => !!x) } }, select: { id: true, startsAt: true } });
  return new Map(calls.map((c) => [c.id, c.startsAt]));
}

/**
 * (NEWEST+3, payments ACROSS TESTS) The developer's payment problems on ANY of their tests, naming the test: an owed
 * charge declined, a failed payment that went through (paid off with Pay what you owe), a chargeback opened
 * or resolved. (A declined Pay press the developer repeats is their own action: reason E from another tab. Ordinary
 * successful payments stay on their own test. A hold shows as the paused banner.)
 */
export async function devPaymentChanges(devId: string, testId: string, since: Date, tx: Tx | typeof db = db): Promise<TestEventLike[]> {
  const pays = await tx.payment.findMany({
    where: { developerId: devId, contractId: { not: null }, OR: [{ status: "failed", owedUntil: { not: null }, createdAt: { gt: since } }, { settledAt: { gt: since } }] },
    take: 100,
  });
  const contracts = await tx.contract.findMany({ where: { id: { in: pays.map((p) => p.contractId!) } }, select: { id: true, tester: true, test: { select: { title: true } } } });
  const cmap = new Map(contracts.map((c) => [c.id, c]));
  const kinds = await subKinds(pays.map((p) => p.submissionId), tx);
  const starts = await callStarts(pays.map((p) => p.callId), tx);
  // (Owner, Nov 3, batch 35 §163) A charge the developer confirmed with their bank themselves (Confirm with your bank, Confirm all) is ONE line: their own
  // "You confirmed … with your bank in another tab" in the other tabs, nothing in the tab that pressed; never a second "Payment went through" for it.
  const settled = pays.filter((p) => p.settledAt && p.settledAt > since).map((p) => `pay:${p.id}`);
  const confirmedByMe = new Set(settled.length ? (await tx.actionLog.findMany({ where: { userId: devId, testId, createdAt: { gt: since }, text: { startsWith: "confirmed " } }, select: { text: true } })).flatMap((r) => parseLog(r.text).about?.k.filter((k) => settled.includes(k)) ?? []) : []);
  const out: TestEventLike[] = [];
  for (const p of pays) {
    if (confirmedByMe.has(`pay:${p.id}`)) continue;
    const c = cmap.get(p.contractId!);
    const title = c?.test.title ?? "a test";
    // (Owner, Nov 4, §177) "$15.00 to Nina Park for the live call on Tue, Oct 27, 8:00 AM", "… for the dispute decision on the recording".
    const who = `${money(p.amountCents)} to ${c ? displayName(c.tester) : "a tester"} for the ${partLabel(p, kinds, starts)}`;
    const next = " · pay what you owe in Payments"; // (Owner, Oct 27) no retries and no cut-off any more: a declined payment is a hold at once
    // (Batch 35 §78) An owed payment that went through was the developer's own (Pay what you owe, a retry, a new card): it lifts their hold, so like a
    // reinstatement (§72) it shows in the live box but never stops their press. A tester's Charge, a dispute decision or a failed payment stop as before.
    // (Owner, Nov 4, §171 A1) Each names its part (`piece`): a payment on the part being paid always stops that press.
    const piece = (p.submissionId ?? p.callId) || undefined;
    // (Owner, Nov 4, §193) A charge about the tester (`charge`): the team's dispute-decision charge, and the tester's Charge or an automatic call charge (a "review"
    // or "call" row the developer never pressed: no press key). The developer's own Pay keeps its press key; Pay more is "extra": never a charge.
    const charge = p.kind === "dispute" || ((p.kind === "review" || p.kind === "call") && !p.pressKey);
    const tags = { ...(piece ? { piece } : {}), ...(charge ? { charge } : {}) };
    if (p.settledAt && p.settledAt > since) out.push({ kind: "payment", text: `Payment went through on ${title}: ${who}`, createdAt: p.settledAt, contractId: p.contractId, key: `pay:${p.id}`, ...tags, ...(p.owedUntil ? { quiet: true } : {}) } as TestEventLike);
    else if (p.status === "failed" && p.createdAt > since) out.push({ kind: "payment", text: `Payment failed on ${title}: ${who}${next}`, createdAt: p.createdAt, contractId: p.contractId, key: `pay:${p.id}`, ...tags } as TestEventLike);
  }
  // Chargebacks opened / resolved on the developer's OTHER tests (this test's come as its own events).
  const others = await tx.testEvent.findMany({ where: { kind: { in: ["chargeback", "payment"] }, createdAt: { gt: since }, testId: { not: testId }, test: { developerId: devId } }, include: { test: { select: { title: true } } }, take: 50 });
  for (const e of others) out.push({ kind: e.kind, text: `On ${e.test.title}: ${e.text[0].toLowerCase()}${e.text.slice(1)}`, createdAt: e.createdAt });
  return out;
}

/**
 * (NEWEST+3, payments ACROSS this developer's tests) The tester's OWN payments: delayed (an owed charge or one deferred
 * by a hold; a declined Pay the developer must press again is not a payment yet) or a delayed payment that arrived,
 * on any of their sessions with this developer, naming the test; the team's decision on their dispute (this session).
 * Never the words "failed", "hold" or "chargeback"; never other testers' payments.
 */
/** (Batch 17 section 14) `onlyHere`: only payments on this contract (what Rate stops for: the developer's pay on this shared work). */
export async function testerPaymentChanges(testerId: string, contractId: string, since: Date, onlyHere = false): Promise<TestEventLike[]> {
  const me = await db.contract.findUniqueOrThrow({ where: { id: contractId }, select: { test: { select: { developerId: true, developer: true } } } });
  const [pays, disputes] = await Promise.all([
    // (Owner, Nov 2) Never a developer's repayment of a reversed payment, or Pay what you owe's own record: not the tester's.
    db.payment.findMany({ where: { testerId, developerId: me.test.developerId, kind: { notIn: ["chargeback", "owed"] }, contractId: onlyHere ? contractId : { not: null }, OR: [{ status: "failed", owedUntil: { not: null }, createdAt: { gt: since } }, { status: { in: ["deferred", "owed"] }, createdAt: { gt: since } }, { settledAt: { gt: since } }] }, orderBy: { createdAt: "asc" }, take: 50 }),
    db.dispute.findMany({ where: { contractId, decidedAt: { gt: since } }, include: { submission: { select: { kind: true } }, call: { select: { startsAt: true } } } }),
  ]);
  const titles = new Map((await db.contract.findMany({ where: { id: { in: pays.map((p) => p.contractId!) } }, select: { id: true, title: true } })).map((c) => [c.id, c.title]));
  const kinds = await subKinds(pays.map((p) => p.submissionId));
  const starts = await callStarts(pays.map((p) => p.callId));
  const out: TestEventLike[] = [];
  const dev = displayName(me.test.developer);
  for (const p of pays) {
    // (Owner, Nov 4, §177) Which part: "your live call on Tue, Oct 27, 8:00 AM"; a dispute's payment names the part it was about ("your dispute about the recording").
    const part = partLabel({ ...p, kind: "" }, kinds, starts);
    const label = p.kind === "dispute" ? (p.callId || p.submissionId ? `dispute about the ${part}` : "dispute") : part;
    const title = p.contractId === contractId ? "" : titles.get(p.contractId!) ?? "";
    // When a delayed payment goes through: the normal paid line (on another session: naming the test).
    const late = (p.status === "deferred" || p.status === "owed" || !!p.owedUntil) && p.createdAt > since;
    const piece = (p.contractId === contractId && (p.submissionId ?? p.callId)) || undefined;
    // (Batch 35 §76) One line per payment, its latest state: once it went through, the paid line replaces its "delayed" line (a failed then paid one shows paid); both
    // carry the payment's key, so the live box's paid line replaces the delayed one it already lists.
    if (late && !(p.settledAt && p.settledAt > since)) out.push({ kind: "payment", text: delayedPayLine(dev, label, p.amountCents, title), createdAt: p.createdAt, piece, key: `pay:${p.id}` });
    if (p.settledAt && p.settledAt > since) out.push({ kind: "paid", text: `${dev} paid ${money(p.amountCents)} for your ${label}${title ? ` on ${title}` : ""}`, createdAt: p.settledAt, piece, key: `pay:${p.id}` });
  }
  for (const d of disputes) {
    const r = await db.review.findFirst({ where: d.submissionId ? { submissionId: d.submissionId } : { callId: d.callId! } });
    const raised = d.decidedCents != null && r && d.decidedCents > r.amountCents;
    const part = d.call ? `live call on ${fmtDateTime(d.call.startsAt)}` : d.submission?.kind === "recording" ? "recording" : "written answers";
    // (Owner, Nov 5, §214) Names whose pay it was: "The team decided your dispute with Omar Reyes about your written answers: …".
    out.push({ kind: "admin", text: raised ? `The team decided your dispute with ${dev} about your ${part}: the pay was raised to ${money(d.decidedCents!)}` : `The team decided your dispute with ${dev} about your ${part}: the pay stays at ${money(r?.amountCents ?? 0)}`, createdAt: d.decidedAt!, piece: (d.submissionId ?? d.callId) || undefined });
  }
  return out;
}

/** A line on the test's event list (what the developer's stop-once reasons and live top box read). */
export async function logEvent(testId: string, kind: string, text: string, contractId: string | null = null, link = "") {
  await db.testEvent.create({ data: { testId, kind, text, contractId, link } });
}

/**
 * A stop decision with renamed lines (info only): stops only for the other lines (and then lists the renamed ones too);
 * otherwise the press goes ahead (batch 15 section 24: with no note).
 */
export function withRenamed(changes: TestEventLike[], body: Record<string, unknown>): TestEventLike[] {
  const stopping = changes.filter((c) => c.kind !== "renamed");
  if (stopping.length) return changes;
  // (Owner, Oct 30, batch 15 section 24) No note under the press any more: a rename is recorded in each working tester's contract changes instead.
  void body;
  return [];
}

/**
 * (Batch 30 §10) The tester's lines for the listing saves since `since`: ONE line per save, in the reader's own zone ("Marc Hanna edited the listing at 6:55 PM:
 * product name, title (now “lllllq”), description · See it"). `join`: the join page (every field, the NDA to accept again); `session`: a working tester's page (the
 * listing information only). A rename alone is info only (kind "renamed": it never stops a press by itself).
 */
export async function listingSaveLines(testId: string, since: Date, viewerId: string, side: "join" | "session", tx: Tx | typeof db = db): Promise<TestEventLike[]> {
  const rows = await tx.testEvent.findMany({ where: { testId, kind: LISTING_SAVE, createdAt: { gt: since } }, orderBy: { createdAt: "asc" }, take: 100 });
  if (!rows.length) return [];
  // (Owner, Oct 31, batch 35 §34) ONE line for every edit since the page's seen time, no field list: "Nora Lane edited the listing · See it", at the latest edit,
  // marking every field any of them changed (`keys`). A rename alone stays info only. The join page's NDA to accept again keeps its own line (it clears the tick).
  const saves = rows.flatMap((e) => {
    const s = parseSave(e.text);
    const l = s ? saveLine(s, e.createdAt, null, side) : null;
    return s && l ? [{ s, l, at: e.createdAt }] : [];
  });
  if (!saves.length) return [];
  const last = saves[saves.length - 1];
  const fields = [...new Set(saves.flatMap((x) => (side === "join" ? x.s.fields : x.s.fields.filter((f) => f === "title" || (INFO_FIELDS as string[]).includes(f)))))];
  const lines: TestEventLike[] = [{ kind: saves.every((x) => x.l.titleOnly) ? "renamed" : "info", text: editedLine(last.s.by), createdAt: last.at, listing: true, key: "listing", keys: panelKeysOf(fields) }];
  const ndaSave = [...saves].reverse().find((x) => x.s.fields.includes("ndaText"));
  if (side === "join" && ndaSave?.s.nda) lines.push({ kind: "info", text: ndaAgainLine(ndaSave.s.by), createdAt: ndaSave.at, nda: true });
  void viewerId; // (the times are the box's, in the reader's zone)
  return side === "join" ? withSaveAt(testId, lines, tx) : lines;
}

/** (Owner, Nov 5, §250) Each line carries its identity (`sid`): once a stop box lists it, no other press on that page stops for it (shownLines.ts). */
export const asLines = (changes: TestEventLike[], ignored: ReadonlySet<string> = new Set()) => changes.map((e) => ({ text: renderTimes(e.text, dateZone()), at: e.createdAt, ...sidOf(e), ...(e.forced ? { forced: true } : {}), ...(e.key ? { key: e.key } : {}), ...(e.keys?.length ? { keys: e.keys } : {}), ...(e.timed ? { timed: true } : {}), ...(e.nda ? { nda: true } : {}), ...(e.listing ? { listing: true } : {}), ...(e.saveAt ? { saveAt: e.saveAt } : {}), ...((e as { link?: string }).link ? { link: (e as { link?: string }).link } : {}), ...(e.kind === "stop" || e.kind === "info" || e.kind === "renamed" || e.kind === "keygiven" /* (batch 34 §12) its See it jumps to the key box */ ? { kind: e.kind } : {}), ...(e.kind === "terms" && (e as { contractId?: string | null }).contractId ? { kind: "terms", contract: (e as { contractId?: string | null }).contractId } : {}), ...(alertOf(e.kind) ? { alert: alertOf(e.kind)! } : {}), ...(ignored.has(alertOf(e.kind) ?? "") ? { ignored: true } : {}) }));
