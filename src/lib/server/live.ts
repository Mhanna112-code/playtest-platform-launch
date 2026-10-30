import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, money } from "@/lib/format";
import { DEV_QUIET_KINDS, DEV_STOP_KINDS, delayedPayLine, switchedLine, type TestEventLike } from "@/lib/rules";
import { alertOf } from "@/lib/alerts";
import { LISTING_SAVE, parseSave, saveLine } from "@/lib/listingSave";

type Tx = Prisma.TransactionClient;

// (Owner, Oct 22, NEWEST+3) Reason E: anything a person did themselves in ANOTHER tab since this page loaded stops the
// first press once ("You sent your written answers in another tab"; batch 29 sections 12-13). Every action is logged
// with the browser tab (page load) that sent it; that same tab never stops for its own presses.

export const tabOf = (body: Record<string, unknown>) => (typeof body.tab === "string" ? body.tab.slice(0, 64) : "");

/**
 * (Owner, Oct 28, batch 16 section 21) What an action was about, kept with its log line (after META, so no new column): the press (`a`, e.g. "pay")
 * and the things it touched (`k`: "c:<contract>", "sub:<id>", "call:<id>", "req:<id>", "t:<tester>", "set:<id>", "app:<id>", "test").
 */
export type OwnAbout = { a: string; k: string[] };
const META = "\u001f";
/**
 * A press on the developer's side. (Owner, Oct 29, batch 29 section 12) The changes made in another tab (BIG_OWN_ACTS) stop EVERY press on the test page and on Edit
 * once; any other action of theirs elsewhere stops only a press it touches (acts × things).
 */
export type Press = {
  acts: readonly string[]; keys: readonly string[];
  /** (Batch 16 sections 21 and 25) Stop on a test another tab stopped after this page loaded: it still stops once, then it's refused. */
  inState?: boolean;
  /** (Batch 17 section 12) Pay / Pay more on this contract: a stop (or that tester's work ended early) since the page loaded stops it once ("" = test-wide only). */
  stopCheck?: string;
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
});
export const INVITE_ACTS = ["invite", "cancel-invite"] as const;
/**
 * (Owner, Oct 29, batch 29 section 12) The developer's own changes made in another tab or device that stop EVERY developer press on the test page and on Edit once:
 * an Edit save (any field), Pay, Pay more (and Confirm with your bank, logged as the Pay it finishes), End early, Stop, Next round (the draft made), any call change
 * (request, withdraw, accept, decline, cancel), Invite / Cancel invite, Accept / Decline of an application or rejoin ask. Ratings and excerpt decisions are never lines
 * (they only race with the same press). Not in Alerts (your own actions can't be switched off).
 */
export const BIG_OWN_ACTS = ["end-early", "stop", "edit", "next-round", ...PAY_ACTS, ...CALL_CHANGE_ACTS, ...INVITE_ACTS, "application"] as const;
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

/** This person's own actions on the test since `since`, from other tabs. */
export async function ownChanges(userId: string, testId: string, since: Date, tab: string, tx: Tx | typeof db = db): Promise<OwnEvent[]> {
  const rows = await tx.actionLog.findMany({ where: { userId, testId, createdAt: { gt: since }, ...(tab ? { tab: { not: tab } } : { tab: { not: "" } }) }, orderBy: { createdAt: "asc" }, take: 50 });
  return rows.map((r) => {
    const { text, about } = parseLog(r.text);
    // (Batch 16 section 21; batch 29 sections 12 and 13) One wording on both sides, in the stop box and the live box: "You invited Ana Silva in another tab".
    const own = text.startsWith("You ") ? text : `You ${text} in another tab`;
    return { kind: "own", text: own, createdAt: r.createdAt, ...(about ? { about } : {}), live: own };
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
  const theirs = events.filter((e) => !e.text.startsWith("You ")).flatMap((e) => {
    if (e.kind === "info" && e.text.startsWith(`${me} `)) return [];
    if (e.kind === "renamed" && e.text.startsWith(`${me} `)) {
      // (Batch 30, Oct 29 addition) One line per save: a rename saved in another tab with other fields is already in that save's line ("title (now “X”)").
      const title = e.text.slice(`${me} renamed the test to `.length);
      if (mine.some((o) => o.about?.a === "edit" && o.text.includes(`title (now “${title}”)`))) return [];
      return [{ ...e, text: e.text.replace(`${me} `, "You ") }];
    }
    return [e];
  });
  // (Owner, Oct 29, batch 29 section 12) What the developer did in another tab can't be switched off in Alerts: the changes in BIG_OWN_ACTS show in the live box and
  // stop every press on the test page and on Edit once (Edit's Save turns another tab's Save into its per-field lines); any other action of theirs stops only a
  // press it touches. A line reads "You paid Ana Silva $10.00 for the written answers in another tab".
  const own = mine.flatMap((o): TestEventLike[] => {
    const line = { kind: "own", text: o.live ?? o.text, createdAt: o.createdAt };
    if (opts.all) return has(LIVE_OWN_ACTS, o.about?.a) ? [line] : [];
    if (!opts.press) return [];
    return has(BIG_OWN_ACTS, o.about?.a) || touches(o, opts.press) ? [line] : [];
  });
  const all = [...theirs, ...(await devPaymentChanges(devId, testId, since, tx)), ...own].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  // (Design doc 6) Update types the developer ignores in the Alerts menu no longer stop a press (the live box still lists them, greyed).
  if (opts.all) return all;
  const ignored = new Set((await tx.user.findUnique({ where: { id: devId }, select: { ignoredAlerts: true } }))?.ignoredAlerts ?? []);
  return ignored.size ? all.filter((c) => { const a = alertOf(c.kind); return !a || !ignored.has(a); }) : all;
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
const pieceLabel = (p: { kind: string; callId: string | null; submissionId: string | null }, kinds: Map<string, string>) =>
  p.kind === "dispute" ? "dispute decision" : p.callId ? "live call" : kinds.get(p.submissionId ?? "") === "recording" ? "recording" : "written answers";

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
  const out: TestEventLike[] = [];
  for (const p of pays) {
    const c = cmap.get(p.contractId!);
    const title = c?.test.title ?? "a test";
    const who = `${money(p.amountCents)} to ${c ? displayName(c.tester) : "a tester"} for the ${pieceLabel(p, kinds)}`;
    const next = " · pay what you owe in Payments"; // (Owner, Oct 27) no retries and no cut-off any more: a declined payment is a hold at once
    if (p.settledAt && p.settledAt > since) out.push({ kind: "payment", text: `Payment went through on ${title}: ${who}`, createdAt: p.settledAt, contractId: p.contractId } as TestEventLike);
    else if (p.status === "failed" && p.createdAt > since) out.push({ kind: "payment", text: `Payment failed on ${title}: ${who}${next}`, createdAt: p.createdAt, contractId: p.contractId } as TestEventLike);
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
    db.payment.findMany({ where: { testerId, developerId: me.test.developerId, contractId: onlyHere ? contractId : { not: null }, OR: [{ status: "failed", owedUntil: { not: null }, createdAt: { gt: since } }, { status: { in: ["deferred", "owed"] }, createdAt: { gt: since } }, { settledAt: { gt: since } }] }, orderBy: { createdAt: "asc" }, take: 50 }),
    db.dispute.findMany({ where: { contractId, decidedAt: { gt: since } } }),
  ]);
  const titles = new Map((await db.contract.findMany({ where: { id: { in: pays.map((p) => p.contractId!) } }, select: { id: true, title: true } })).map((c) => [c.id, c.title]));
  const kinds = await subKinds(pays.map((p) => p.submissionId));
  const out: TestEventLike[] = [];
  const dev = displayName(me.test.developer);
  for (const p of pays) {
    const label = pieceLabel(p, kinds) === "dispute decision" ? "dispute" : pieceLabel(p, kinds);
    const title = p.contractId === contractId ? "" : titles.get(p.contractId!) ?? "";
    // When a delayed payment goes through: the normal paid line (on another session: naming the test).
    const late = (p.status === "deferred" || p.status === "owed" || !!p.owedUntil) && p.createdAt > since;
    if (late) out.push({ kind: "payment", text: delayedPayLine(dev, label, p.amountCents, title), createdAt: p.createdAt });
    if (p.settledAt && p.settledAt > since) out.push({ kind: "paid", text: `${dev} paid ${money(p.amountCents)} for your ${label}${title ? ` on ${title}` : ""}`, createdAt: p.settledAt });
  }
  for (const d of disputes) {
    const r = await db.review.findFirst({ where: d.submissionId ? { submissionId: d.submissionId } : { callId: d.callId! } });
    const raised = d.decidedCents != null && r && d.decidedCents > r.amountCents;
    out.push({ kind: "admin", text: raised ? `The team decided your dispute: the pay was raised to ${money(d.decidedCents!)}` : `The team decided your dispute: the pay stays at ${money(r?.amountCents ?? 0)}`, createdAt: d.decidedAt! });
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
  const tz = (await tx.user.findUnique({ where: { id: viewerId }, select: { timeZone: true } }))?.timeZone;
  return rows.flatMap((e) => {
    const s = parseSave(e.text);
    const l = s ? saveLine(s, e.createdAt, tz, side) : null;
    return l ? [{ kind: l.titleOnly ? "renamed" : "info", text: l.text, createdAt: e.createdAt, timed: true, ...(l.nda ? { nda: true } : {}) }] : [];
  });
}

export const asLines = (changes: TestEventLike[], ignored: ReadonlySet<string> = new Set()) => changes.map((e) => ({ text: e.text, at: e.createdAt, ...(e.timed ? { timed: true } : {}), ...(e.nda ? { nda: true } : {}),...((e as { link?: string }).link ? { link: (e as { link?: string }).link } : {}), ...(e.kind === "info" || e.kind === "renamed" ? { kind: e.kind } : {}), ...(e.kind === "terms" && (e as { contractId?: string | null }).contractId ? { kind: "terms", contract: (e as { contractId?: string | null }).contractId } : {}), ...(alertOf(e.kind) ? { alert: alertOf(e.kind)! } : {}), ...(ignored.has(alertOf(e.kind) ?? "") ? { ignored: true } : {}) }));
