import { ndaOnlyEdit, NDA_ONLY_EDIT } from "@/lib/ndaEditing";
import { stoppedPressLine } from "@/lib/refusal";
import * as RF from "@/lib/refusal";
import { overPressLine } from "@/lib/rules";
import { additionTerms } from "./submissionAdditions";
import { dateZone } from "./dateZone";
import { TEAM_LIFTED_EVENT, TEAM_PAUSED_EVENT, devLiftSince, devPauseMoments, devPauseSince, devStopSince, loadedOf } from "./stopMoment";
import { replaceLine, takesTheirs } from "@/lib/editMerge";
import { FIELD_NAMES, INFO_FIELDS, editedLine, saveText } from "@/lib/listingSave";
import { CALL_ACTS, PAY_ACTS, unanswered, answersIt, devBoxRule, devChanges, devForced, logEvent, pageOf, seenOf, tabOf, withRenamed, type Press } from "./live";
import { notListed, sidOf } from "./shownLines";
import { ANSWER_ONE, NOT_REQUIRED, answerChars, answerMin, answerShortLine, answersMissing, qText, sameQuestionSet } from "@/lib/questions";
import { answerUnit, NOTES_UNIT } from "@/lib/draftUnits";
import { patchKept, setKept } from "./kept";
import { beforeLock } from "./pressRace";
import { addOwnText, writtenOwnText } from "./actionText";
import { questionChangeTexts } from "@/lib/questionHistory";
import { itemsFor, itemsOf, prevSetsOf, sameQuestions, snapshotOnlyFiles } from "@/lib/answerSets";
import { ADDITIONS_MAX, ADD_UNDER_QUESTION, ANYTHING_ELSE_KEY, ANYTHING_ELSE_TITLE, QUESTION_GONE, addedToWhat, youAddedLine, additionsFull, additionsOf, addsCounted, carriedAnswers, currentQuestionsFor, latestItems, questionKey, questionKeys } from "@/lib/additions";
import { countersOf, countingSince, countsAfter, countsOf, criticalLine, lockedFields, storedCounts, type CriticalCounts } from "@/lib/limits";
import { alertOf } from "@/lib/alerts";
import { KEY_GIVEN, applyKeyChange, assignKeyAtJoin, checkTypedKeys, giveKeysToWorking, planKeyChange } from "./accessKeys";
import { givenDeletedLine, keyGivenEventLine, keyNeedLine, keysAddedLine, keysRemovedLine, parseKeys } from "@/lib/keys";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { LIMITS } from "@/lib/limits";
import { BUILD_URL_LINE, BUILD_URL_TOO_LONG, buildUrlOk } from "@/lib/listingFields";
import { displayName, fmtDate, fmtDateTime, fmtDateTimeIn, pronouns, stopTimeIn, toCents } from "@/lib/server/dateFormat";
import { CATEGORIES, DEVICES, LANGUAGES } from "@/lib/options";
import { T, safeZone, renderTimes } from "@/lib/tz";
import { LISTING_INFO_FIELDS, LISTING_VALUES, valuesText } from "@/lib/listingInfo";
import { LISTING_SAVED, savedText } from "@/lib/listingPanel";
import { andList, testClosedToNewLine, daysBetween, dueAfterDays, movedDue, endOfDayIn, openUntilDay, testerDaysOf, testPaused, testerPaused, checkWrittenLength, checkAdditionLength, openUntilShortened, changedTerms, sameListingValue, checkListing, checkOpenUntilChange, contractSnapshot, editCheck, joinCheck, payByFrom, testerRefusal, workOver, LISTING_FIELDS, mergeEdit, dropHiddenPartFields, termsLine, type Listing, type TestEventLike } from "@/lib/rules";
import { gapsOf, gapsUnseen, missingNeedText, noGaps, readGaps } from "@/lib/gaps";
import { HttpError, readText } from "./http";
import { notify } from "./notify";
import { answerTermsFirst, followNda, followQuestions, offerNewTerms, testerSendGate } from "./terms";
import { ndaChangedLine, ndaNoticeHref } from "@/lib/ndaNotice";
import { questionChangeLines, testerGate } from "./testerGate";
import { blockPartners } from "./blocks";
import { notifyPaidUpdate, paidUpdateRoom, resendRefusal } from "./paidUpdates";
import { addedWhat, updatedAfterPaidLive, updatedAtCapLive } from "@/lib/moneyLines";
import { markerIds, withoutAttachmentMarkers } from "@/lib/answerAttachments";
import { forgetDeadlineMarks, callCancelledLine, questionsUpdatedLine, STOP_NOTE_KIND, stopEventText, stopNoteText, PAY_RULES_TICK_MISSING, payRulesTicked, PART_PRICE_MISSING, SENT_ANSWERS_LOCKED, NOTHING_TO_ADD, WHY_MIN_CHARS, WHY_TOO_SHORT, MAX_SPOTS } from "@/lib/rules";
import { closeOffersOfEnded } from "./offerClose";
import { testerRow } from "@/lib/lineAnchors";

type Tx = Prisma.TransactionClient;
type U = { id: string; email: string; name: string; pronoun: string; isDeveloper: boolean; isTester: boolean; timeZone?: string | null };

// ---------- helpers ----------

export const asListing = (t: { [K in keyof Listing]: unknown }): Listing => ({
  productName: (t.productName as string) ?? "", mature: !!t.mature, matureWhy: (t.matureWhy as string) ?? "", ndaText: (t.ndaText as string) ?? "",
  title: t.title as string, description: t.description as string, buildUrl: t.buildUrl as string, categories: (t.categories as string[]) ?? [],
  devices: t.devices as string[], languages: t.languages as string[], spots: t.spots as number,
  writtenCents: t.writtenCents as number | null, recordingCents: t.recordingCents as number | null,
  liveRateCents: t.liveRateCents as number | null, liveMinutes: t.liveMinutes as number | null,
  writtenRequired: !!t.writtenRequired, recordingRequired: !!t.recordingRequired, liveRequired: !!t.liveRequired,
  deadlineDays: t.deadlineDays as number, questions: (t.questions as string[]) ?? [],
  openUntil: t.openUntil ? new Date(t.openUntil as string | Date).toISOString() : null,
  joinMode: (t.joinMode as string) ?? "anyone",
});

/** Listing → database fields (Open until as a Date). */
export const listingData = (l: Listing) => ({ ...l, openUntil: l.openUntil ? new Date(l.openUntil) : null, liveMinutes: l.liveRateCents == null ? null : l.liveMinutes });

/** The written-answer questions in a contract; extra written work with no questions gets one open box. */
/**
 * (Owner, Oct 31, batch 35 §66; replaces batch 14 section 2's start) The 3-change count starts when the FIRST TESTER JOINS (a working contract: a join, an Accept or
 * an auto-join that joins); an invite or an application no longer starts it, and saves before the first join never count. Stored as "since" in criticalCounts
 * (kept when the tester leaves). Called on a join only (joinTest); a test from before this counts from its first contract (startedCounting reads it).
 */
export async function stampCounting(testId: string, tx: Prisma.TransactionClient | typeof db = db, at = new Date()) {
  await tx.$executeRaw`UPDATE "Test" SET "criticalCounts" = COALESCE("criticalCounts", '{}'::jsonb) || jsonb_build_object('since', ${at.toISOString()}::text) WHERE id = ${testId} AND NOT jsonb_exists(COALESCE("criticalCounts", '{}'::jsonb), 'since')`;
}
/**
 * When the count started (null: nobody joined yet, edits are free and nobody is told), with the counts as they stand. (Batch 35 §66) A "since" stored from an
 * invite or an application (before the first join, or with nobody joined) is recomputed from the first join: the saves counted before it never count, so
 * the counts start again at 0 from the first join (none at all while nobody has joined).
 */
export async function countingState(t: { id: string; criticalCounts: unknown }, tx: Prisma.TransactionClient | typeof db = db): Promise<{ since: Date | null; counts: CriticalCounts }> {
  const stored = countingSince(t.criticalCounts);
  const c = await tx.contract.findFirst({ where: { testId: t.id }, orderBy: { joinedAt: "asc" }, select: { joinedAt: true } });
  const first = c?.joinedAt ?? null;
  if (stored && first && stored.getTime() >= first.getTime() - 1000) return { since: stored, counts: countsOf(t.criticalCounts) };
  if (!stored && !first) return { since: null, counts: countsOf(t.criticalCounts) };
  if (!stored) {
    await stampCounting(t.id, tx, first!);
    return { since: first, counts: countsOf(t.criticalCounts) };
  }
  const counts = countsOf({});
  await tx.test.update({ where: { id: t.id }, data: { criticalCounts: storedCounts(counts, first) } });
  return { since: first, counts };
}
/** When the count started (null: nobody joined yet, edits are free and nobody is told). */
export const startedCounting = async (t: { id: string; criticalCounts: unknown }, tx: Prisma.TransactionClient | typeof db = db): Promise<Date | null> => (await countingState(t, tx)).since;

/** (Owner, Nov 5, §263) This tester's questions now: defined once, in lib/additions.ts (currentQuestionsFor). */
export const writtenQuestions = currentQuestionsFor;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown, allowed: string[]) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && allowed.includes(x)))] : []);
const int = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
/** A price field: null/"" = not offered; "0" = free; "7.50" = $7.50. */
function price(v: unknown, label: string, missing = ""): number | null {
  // (Batch 20 section 22) Ticked with a blank price (the form sends "" for a ticked part, null for one that's off): refused, $0 is only the Free tick ("0").
  if (missing && typeof v === "string" && !v.trim()) throw new HttpError(400, "bad_price", missing);
  if (v === null || v === undefined || v === "" || v === false) return null;
  const c = toCents(v);
  if (c == null) throw new HttpError(400, "bad_price", `Enter the ${label} like 7.50 (or 0 for free).`);
  return c;
}

/** Read the listing fields the form sent. Only fields present in the body are returned (Edit sends only touched ones). */
/** `tz`: the developer's zone; (batch 35 §54) a chosen Open until day is stored as the end of that day there (unknown: UTC). */
export function parseListing(body: Record<string, unknown>, partial = false, tz?: string | null): Partial<Listing> {
  const out: Partial<Listing> = {};
  const has = (k: string) => !partial || k in body;
  // (Design doc 4) Longer than the limits are kept so the check can say so (never cut silently).
  if (has("productName")) out.productName = str(body.productName, 400);
  if (has("title")) out.title = str(body.title, 400);
  if (has("description")) out.description = str(body.description, LIMITS.whatToDo + 5000); // (batch 15 section 17) over the limit is kept so the check can say so
  if (has("mature")) out.mature = body.mature === true;
  if (has("matureWhy")) out.matureWhy = str(body.matureWhy, 1000);
  if (has("ndaText")) out.ndaText = typeof body.ndaText === "string" ? body.ndaText.replace(/\r\n/g, "\n").trim().slice(0, 30_000) : "";
  if (has("buildUrl")) {
    out.buildUrl = str(body.buildUrl, LIMITS.buildUrl + 1); // (Owner, Nov 3) one over is kept so the check below refuses it (a cut link would break)
    if (out.buildUrl.length > LIMITS.buildUrl) throw new HttpError(400, "bad_url", BUILD_URL_TOO_LONG);
    // (Batch 15 section 35) https:// only, as the message says.
    if (out.buildUrl && !buildUrlOk(out.buildUrl)) throw new HttpError(400, "bad_url", BUILD_URL_LINE); // (batch 35 §27) the same rule and line as the box
  }
  // (Owner, Nov 9, §345) Saved in the CATEGORIES list's order, so the first one (the tile's) never depends on the order they were ticked.
  if (has("categories")) { const picked = list(body.categories, CATEGORIES); out.categories = CATEGORIES.filter((c) => picked.includes(c)); }
  if (has("devices")) out.devices = list(body.devices, DEVICES);
  if (has("languages")) out.languages = list(body.languages, LANGUAGES);
  if (has("spots")) out.spots = int(body.spots);
  if (has("writtenCents")) out.writtenCents = price(body.writtenCents, "written answers price", PART_PRICE_MISSING.written);
  if (has("recordingCents")) out.recordingCents = price(body.recordingCents, "recording price", PART_PRICE_MISSING.recording);
  if (has("writtenRequired")) out.writtenRequired = body.writtenRequired === true;
  if (has("recordingRequired")) out.recordingRequired = body.recordingRequired === true;
  if (has("liveRequired")) out.liveRequired = body.liveRequired === true;
  if (has("liveRateCents")) out.liveRateCents = price(body.liveRateCents, "live call rate", PART_PRICE_MISSING.live);
  if (has("liveMinutes")) out.liveMinutes = body.liveMinutes === null || body.liveMinutes === "" ? null : int(body.liveMinutes);
  // (Batch 12 section 6) No "days after joining" field any more: a value sent by an old page is kept, unused for new joins.
  // Post stores a value (an old page's, or 7) that new joins never use; Edit ignores it.
  if (!partial) { const d = int(body.deadlineDays); out.deadlineDays = Number.isInteger(d) && d >= 1 && d <= 90 ? d : 7; }
  if (has("joinMode")) out.joinMode = ["anyone", "apply", "invite"].includes(body.joinMode as string) ? (body.joinMode as string) : "anyone";
  if (has("openUntil")) {
    const v = str(body.openUntil, 40);
    out.openUntil = v ? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? endOfDayIn(v, tz).toISOString() : v) : null;
  }
  // (Batch 26 section 14) A page from before the switch may still send the old "[not required] " marker: it is the default now, so it's dropped (never a change).
  if (has("questions")) out.questions = Array.isArray(body.questions) ? body.questions.filter((q): q is string => typeof q === "string").map((q) => q.trim()).map((q) => (q.startsWith(NOT_REQUIRED) ? q.slice(NOT_REQUIRED.length).trim() : q)).filter(Boolean) : [];
  return out;
}

export async function lockTest(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${id} FOR UPDATE`;
  const t = await tx.test.findUnique({ where: { id } });
  if (!t) throw new HttpError(404, "not_found", "This test was deleted.");
  return t;
}

/** Record what happened. bump=true moves the test's version on (Edit's Save will notice). */
export async function recordEvent(tx: Tx, testId: string, kind: string, text: string, bump: boolean, extra: Prisma.TestUpdateInput = {}, contractId: string | null = null, /** (Batch 34 §9) the tab that saved the listing */ tab = "", link = "") {
  let version: number | null = null;
  if (bump || Object.keys(extra).length) {
    const t = await tx.test.update({ where: { id: testId }, data: { ...(bump ? { version: { increment: 1 } } : {}), ...extra } });
    if (bump) version = t.version;
  }
  return tx.testEvent.create({ data: { testId, kind, text, version, contractId, ...(link ? { link } : {}), ...(tab ? { tab } : {}) } }); // (batch 35 §49) the event, for a reason kept with it
}

const working = (testId: string) => ({ testId, status: "working" });

/**
 * (Owner, correction 4) When the test fills, every pending application and every open invite closes (nothing reopens
 * later). Runs inside the transaction that took the last spot. The developer's line stops once in all tabs.
 */
export async function closeOnFull(tx: Tx, testId: string, exceptTesterId: string | null) {
  const t = await tx.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  const now = new Date();
  const apps = await tx.application.findMany({ where: { testId, status: "pending", ...(exceptTesterId ? { testerId: { not: exceptTesterId } } : {}) } });
  // (Correction 6) Open invites STAY open while the test is full; they're told, and told again when a spot opens.
  const invs = await tx.invite.findMany({ where: { testId, status: "sent", ...(exceptTesterId ? { testerId: { not: exceptTesterId } } : {}) } });
  await tx.application.updateMany({ where: { id: { in: apps.map((a) => a.id) } }, data: { status: "closed", closedReason: "full", decidedAt: now } });
  const closed = apps.length ? `: closed ${apps.length} application${apps.length === 1 ? "" : "s"}.` : ".";
  const open = invs.length ? ` ${invs.length} invite${invs.length === 1 ? " stays" : "s stay"} open until a spot opens.` : "";
  await tx.testEvent.create({ data: { testId, kind: "full", text: `${t.title} is full${closed}${open}`.replace(/\.$/, "") } });
  const people = await tx.user.findMany({ where: { id: { in: [...apps.map((a) => a.testerId), ...invs.map((i) => i.testerId)] } } });
  const email = (id: string) => people.find((p) => p.id === id)?.email ?? "";
  // Once per invite: only those never told it filled.
  const tell = invs.filter((i) => !i.fullNotifiedAt);
  await tx.invite.updateMany({ where: { id: { in: tell.map((i) => i.id) } }, data: { fullNotifiedAt: now } });
  return { title: t.title, testId, dev: displayName(t.developer), apps: apps.map((a) => email(a.testerId)), invites: tell.map((i) => email(i.testerId)) };
}

export const fullInviteLine = (title: string) => `${title} is full right now. Your invite stays open; we'll tell you when a spot opens.`;
export const spotOpenLine = (title: string, dev: string) => `A spot opened on ${title}: you can accept ${dev}'s invite now.`;

/** (Owner, Oct 29, batch 29 §23) The tester's lines about their applications and invites stack into ONE entry per day across tests: "Applications and invites". */
export const APPS_GROUP = { group: "apps" } as const;

export async function tellFull(f: { title: string; testId: string; dev: string; apps: string[]; invites: string[] }) {
  for (const e of f.apps) if (e) await notify(e, `${f.title} is full, so your application was closed.`, [`${f.title} is full, so your application was closed.`], `/app/find/${f.testId}`, { ...APPS_GROUP, testId: f.testId });
  for (const e of f.invites) if (e) await notify(e, fullInviteLine(f.title), [fullInviteLine(f.title)], `/app/find/${f.testId}`, { ...APPS_GROUP, testId: f.testId });
}

/**
 * (Correction 6) A spot opened (someone left / was ended, or spots were raised) on a test that was full: every open
 * invite is told (first come, first served). Closed applicants aren't. Reminders resume by themselves.
 */
export async function spotOpened(testId: string, opts: { /** (§341) a free key was added to a test full for want of one */ keyAdded?: boolean } = {}) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  const last = await db.testEvent.findFirst({ where: { testId, kind: { in: ["full", "spot_open"] } }, orderBy: { createdAt: "desc" } });
  if (last?.kind !== "full" && !opts.keyAdded) return;
  if ((await db.contract.count({ where: working(testId) })) >= t.spots) return;
  // (Owner, Nov 9, §341) A spot that opened with no free key isn't open to testers yet: they hear of it when a key is added.
  if (await (await import("./accessKeys")).keysFullNow(db, testId)) return;
  await db.testEvent.create({ data: { testId, kind: "spot_open", text: spotOpenLine(t.title, displayName(t.developer)) } });
  // Once per invite: only those never told a spot opened.
  const invs = await db.invite.findMany({ where: { testId, status: "sent", openNotifiedAt: null } });
  await db.invite.updateMany({ where: { id: { in: invs.map((i) => i.id) } }, data: { openNotifiedAt: new Date() } });
  const people = await db.user.findMany({ where: { id: { in: invs.map((i) => i.testerId) } } });
  for (const p of people) await notify(p.email, spotOpenLine(t.title, displayName(t.developer)), [spotOpenLine(t.title, displayName(t.developer))], `/app/find/${testId}`, { ...APPS_GROUP, testId });
}

/**
 * (NEWEST+4) Rejoining keeps the time they had left when they left (hours count; if it had passed, it stays passed). (Owner, Nov 3, batch 35 §154) The new deadline
 * is rounded UP to the end of the day it lands on (11:59 PM in the developer's zone, where deadlines are counted), never an odd time.
 */
export const rejoinDue = (oldDue: Date, leftAt: Date | null, now: Date, tz?: string | null) => {
  const left = oldDue.getTime() - (leftAt ?? now).getTime();
  return left > 0 ? movedDue(now, left, tz) : new Date(now.getTime() + left);
};

/** The developer's own test, or a refusal. Other people's tests look like they don't exist. */
export async function ownTest(devId: string, testId: string) {
  const t = await db.test.findUnique({ where: { id: testId } });
  if (!t || t.developerId !== devId) throw new HttpError(404, "not_found", "That test doesn't exist or isn't yours.");
  return t;
}

export const seenDate = (v: unknown) => {
  const d = typeof v === "string" ? new Date(v) : null;
  if (!d || isNaN(d.getTime())) throw new HttpError(400, "bad_request", "This page is out of date.");
  return d;
};

// ---------- developer: post, edit ----------

/** The parts whose "I confirm this part pays more than $200." tick was ticked. */
const confirmedHighOf = (body: Record<string, unknown>) => (Array.isArray(body.confirmHigh) ? body.confirmHigh.map(String) : []);

/** Post a test's checks (Post a test, and posting a draft): the listing (at most 10 spots) and the access keys. */
async function checkPost(dev: U, body: Record<string, unknown>) {
  if (!dev.isDeveloper) throw new HttpError(403, "not_developer", "Turn on “post tests” in your profile to post a test.");
  if (await devOnHold(dev.id)) throw new HttpError(409, "on_hold", RF.pressRefused(RF.HELD_CAUSE, "Post the test")); // (§364 item 7)
  const l = parseListing(body, false, tzOf(body, dev)) as Listing;
  if (!l.mature) l.matureWhy = "";
  const now = new Date();
  // (Batch 15 section 32) The press sends the developer's time zone (the account's stored one otherwise): "today" is their date.
  const errs = checkListing(l, 0, now, { openedAt: now, confirmedHigh: confirmedHighOf(body), tz: tzOf(body, dev) });
  const keys = checkTypedKeys(body.accessKeys);
  if (keys.length && Number.isInteger(l.spots) && keys.length < l.spots) errs.push(keyNeedLine(l.spots, keys.length));
  // (Batch 19 section 7) The required tick about Charge, red at the tick (listed last, with every other mistake).
  if (!payRulesTicked(body)) errs.push(PAY_RULES_TICK_MISSING);
  if (errs.length) throw new HttpError(400, "bad_listing", errs[0], { errors: errs });
  return { l, keys };
}

/** (Batch 8) Posting (or opening a draft): the free plan runs one open test at a time, and Approved-only testers are a subscriber perk. */
async function postPerks(devId: string, joinMode: string, exceptId = "") {
  const subs = await import("./subscription");
  await subs.canOpenAnother(devId, exceptId);
  if (joinMode === "apply") await subs.requirePerk(devId, "approved");
}

/**
 * (Owner, Oct 30, batch 34 §7) A developer's open tests and drafts have different names (two tabs posted the same test twice, 10 seconds apart): the second Post,
 * or a Save renaming to a name in use, is refused naming the other test, with its link. Other developers' tests, and stopped tests, don't count. Inside the
 * Post's transaction a per-developer lock makes two Posts at the same moment take turns.
 */
async function requireUniqueTitle(tx: Tx, devId: string, title: string, exceptId?: string) {
  const name = title.trim();
  if (!name) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"title:" + devId}))`;
  const same = await tx.test.findFirst({ where: { developerId: devId, status: { in: ["open", "draft"] }, title: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) }, orderBy: { createdAt: "asc" } });
  if (!same) return;
  const tz = (await tx.user.findUnique({ where: { id: devId }, select: { timeZone: true } }))?.timeZone;
  throw new HttpError(409, "same_title", sameTitleLine(same.title, same.status === "draft" ? null : fmtDateTimeIn(same.createdAt, tz)), { link: `/app/tests/${same.id}` });
}
/** "You already have a test called “Harbor Run” (posted Fri, Oct 30, 11:00 AM): give this one a different name." */
export const sameTitleLine = (title: string, postedAt: string | null) => `You already have a test called “${title}” (${postedAt ? `posted ${postedAt}` : "a draft"}): give this one a different name.`;

async function requireCardToPost(devId: string) {
  const user = await db.user.findUnique({ where: { id: devId }, select: { stripePaymentMethodId: true } });
  if (!user?.stripePaymentMethodId) throw new HttpError(402, "card_required", "Add a card in Payments before posting: testers' pay is charged to it.", { link: "/app/payments" });
}

/** (Owner, Oct 28 evening) A draft (a next round not opened yet) opens in Post a test: "Post the test" saves the typed details and opens it for testers. */
export async function postDraft(dev: U, testId: string, body: Record<string, unknown>) {
  const t0 = await ownTest(dev.id, testId);
  if (t0.status !== "draft") throw new HttpError(409, "not_draft", t0.status === "stopped" ? stoppedPressLine("Post the test") : "This test is already open."); // (§363)
  const { l, keys } = await checkPost(dev, body);
  await requireCardToPost(dev.id);
  await postPerks(dev.id, l.joinMode, testId);
  return db.$transaction(async (tx) => {
    const t = await lockTest(tx, testId);
    if (t.status !== "draft") throw new HttpError(409, "not_draft", "This test is already open.");
    await requireUniqueTitle(tx, dev.id, l.title, testId);
    if (keys.length) await tx.accessKey.createMany({ data: keys.map((value) => ({ testId, value })) });
    // It opens now: the deadline buffer and the dashboard order count from here; (batch 15 section 18) so do the tester days.
    await recordEvent(tx, testId, "opened", "The test opened for testers", true, { ...listingData(l), status: "open", createdAt: new Date(), testerDays: testerDaysFor(l.openUntil, dev) });
    return tx.test.findUniqueOrThrow({ where: { id: testId } });
  });
}

/** (Owner, Oct 28 evening) Delete a draft from its Post page (after the confirm pop-up). Nobody can have joined a draft. */
export async function deleteDraft(dev: U, testId: string) {
  const t = await db.test.findUnique({ where: { id: testId } });
  // (Owner, Nov 3, batch 35 §157) Deleted in another tab (or by both presses at once): "You already deleted this draft.", never "doesn't exist" or a 500.
  if (!t && (await draftDeletedBy(dev.id, testId))) throw new HttpError(409, "deleted", DRAFT_ALREADY_DELETED);
  if (!t || t.developerId !== dev.id) throw new HttpError(404, "not_found", "That test doesn't exist or isn't yours.");
  if (t.status !== "draft") throw new HttpError(409, "not_draft", "Only a draft can be deleted.");
  // One claim: deleted only while still this developer's draft, with its record (which draft, by whom) in the same commit.
  const gone = await db.$transaction(async (tx) => {
    const n = (await tx.test.deleteMany({ where: { id: testId, developerId: dev.id, status: "draft" } })).count;
    if (n) await tx.actionLog.create({ data: { userId: dev.id, testId: DRAFT_DELETED, tab: testId, text: "deleted the draft" } });
    return n;
  });
  if (!gone) {
    if (await draftDeletedBy(dev.id, testId)) throw new HttpError(409, "deleted", DRAFT_ALREADY_DELETED);
    throw new HttpError(409, "not_draft", (await db.test.findUnique({ where: { id: testId }, select: { status: true } }))?.status === "stopped" ? stoppedPressLine("Delete") : "Only a draft can be deleted."); // (§363)
  }
  await db.keptForm.deleteMany({ where: { userId: dev.id, key: `test:draft:${testId}` } }).catch(() => null);
  return { deleted: true };
}
/** (§157) The ActionLog "test" that records a deleted draft (its id in `tab`): never a real test id. */
const DRAFT_DELETED = "draft-deleted";
export const DRAFT_ALREADY_DELETED = "You already deleted this draft.";
const draftDeletedBy = async (devId: string, testId: string) => !!(await db.actionLog.findFirst({ where: { userId: devId, testId: DRAFT_DELETED, tab: testId }, select: { id: true } }));

export async function createTest(dev: U, body: Record<string, unknown>) {
  // (Batch 31) At most 10 spots; (design doc 4) with access keys, at least as many keys as open spots.
  const { l, keys } = await checkPost(dev, body);
  await requireCardToPost(dev.id);
  await postPerks(dev.id, l.joinMode);
  return db.$transaction(async (tx) => {
    await requireUniqueTitle(tx, dev.id, l.title);
    const t = await tx.test.create({ data: { ...listingData(l), developerId: dev.id, status: "open", testerDays: testerDaysFor(l.openUntil, dev) } });
    if (keys.length) await tx.accessKey.createMany({ data: keys.map((value) => ({ testId: t.id, value })) });
    return t;
  });
}

/**
 * Save an edit. The body carries the version the page loaded and only the fields the user touched.
 * If the test changed since: the first Save stops and lists what changed; the second (confirmed) saves the typed values on top.
 * Edit only changes the listing for new joiners: contracts are snapshots.
 */
export async function editTest(dev: U, testId: string, body: Record<string, unknown>) {
  // (Owner, Nov 9, §358; replaces batch 35 §168's "a closed test has no Edit") A closed test is edited like a stopped one: the NDA only (ndaOnlyEdit, below), and
  // an older full-editor tab's Save is refused with the NDA-only line.
  await ownTest(dev.id, testId);
  // (Owner, Nov 9, §341) Full for want of a free key before this Save: once a key is added, the spot reopens (spotOpened, below).
  const keysWereFull = await (await import("./accessKeys")).keysFullNow(db, testId);
  const loaded = Number(body.version);
  const confirmed = body.confirmed === true;
  const touched = parseListing((body.fields ?? {}) as Record<string, unknown>, true, tzOf(body, dev));
  // (Batch 8) Switching a test to Approved-only is a new use of the perk (a test that already is Approved-only stays so, and keeps working).
  if (touched.joinMode === "apply") {
    const cur = await db.test.findUniqueOrThrow({ where: { id: testId }, select: { joinMode: true } });
    if (cur.joinMode !== "apply") await (await import("./subscription")).requirePerk(dev.id, "approved");
  }
  // (Design doc 5) Access keys: the keys added and the free keys removed in this tab (applied on top of the newest keys).
  const keysAdd = checkTypedKeys(body.keysAdd);
  const keysRemove = parseKeys(body.keysRemove);
  let termsChanged = false;
  let switchedToAnyone = false;
  let changedNames: string[] = [];
  let reinvite = false;
  let spotsChanged = false;
  let switchedToInvite = false;
  let changeId: string | null = null;
  let keysGiven: Awaited<ReturnType<typeof giveKeysToWorking>> = [];
  // (Owner, Nov 5, §265) The working testers whose questions this Save changed (each is told in the bell).
  const questionsFollowed: { contractId: string; email: string }[] = [];
  // (Owner, Nov 5, §267) The working testers whose NDA this Save changed (each gets its own notice in the bell).
  let ndaFollowed: Awaited<ReturnType<typeof followNda>> = [];
  // (Owner, Nov 6, §286) The working testers whose top box gets this Save's "Nora Lane edited the listing" line (it changed the title or the listing information).
  let editedFor: { id: string; testerId: string; tester: { email: string } }[] = [];
  const result = await db.$transaction(async (tx) => {
    const t = await lockTest(tx, testId);
    const devNow = await tx.user.findUniqueOrThrow({ where: { id: dev.id }, select: { holdStartedAt: true, devSuspendedAt: true } });
    const ndaOnly = ndaOnlyEdit(t, devNow) || body.ndaOnly === true;
    if (ndaOnly && (Object.keys((body.fields ?? {}) as Record<string, unknown>).some((k) => k !== "ndaText") || keysAdd.length || keysRemove.length)) throw new HttpError(409, "nda_only", NDA_ONLY_EDIT);
    if (typeof touched.title === "string" && touched.title.trim().toLowerCase() !== t.title.trim().toLowerCase()) await requireUniqueTitle(tx, dev.id, touched.title, testId);
    // (Batch 34 §9, owner's finding) A save made from this same browser tab is never "another tab": its own saves never stop it, and when every listing save since
    // this page loaded was this tab's own (its base is behind only because of them), there is nothing to name per field either.
    const tab = tabOf(body);
    const ownSave = (e: { kind: string; tab: string }) => !!tab && e.tab === tab && LISTING_SAVE_KINDS.includes(e.kind);
    const events = (await tx.testEvent.findMany({ where: { testId, version: { gt: loaded } } })).filter((e) => !ownSave(e));
    const pageAt = seenOf(body.pageSeenAt) ?? seenOf(body.seenAt);
    const savesSincePage = pageAt ? await tx.testEvent.findMany({ where: { testId, kind: { in: LISTING_SAVE_KINDS }, createdAt: { gt: pageAt } }, select: { kind: true, tab: true } }) : [];
    const onlyOwnSaves = savesSincePage.length > 0 && savesSincePage.every(ownSave);
    // (Owner) A second Save goes ahead only if nothing new happened since its box last updated (boxAt).
    const boxAt = confirmed ? seenOf(body.boxAt) : null;
    const newSinceBox = boxAt ? events.filter((e) => e.createdAt > boxAt) : [];
    const gate = boxAt ? (newSinceBox.length ? { go: false as const, changes: newSinceBox } : { go: true as const }) : editCheck(loaded, t.version, events, confirmed);
    // (NEWEST+3) Save follows the same rule as the test page's buttons: every developer reason since Edit opened
    // (testers' actions, and anything saved or done in another tab), then any other change to the listing's version.
    const seen = boxAt ?? (confirmed ? null : seenOf(body.seenAt));
    // (Owner, Oct 29, batch 29 section 12) The developer's own changes in another tab stop Save once like every test-page press (a Pay, a call change,
    // an invite…); another tab's Save becomes the per-field lines below.
    // (Owner, Nov 5, §250) Minus what a stop box on this page already listed. Edit's own per-field and key lines (below: what THIS Save holds against what's saved)
    // are not updates but this Save's consequences: they always show.
    const dc = seen ? withRenamed(notListed(await devChanges(dev.id, testId, seen, tabOf(body), tx, { press: EDIT_PRESS, page: pageOf(body) }), body), body) : [];
    // The "fields you didn't touch keep the newer values" tail only when the listing itself was saved elsewhere.
    const listingEdited = events.some((e) => e.kind === "edited" || e.kind === "edited_spots");
    const current = asListing(t);
    dropHiddenPartFields(current, touched); // (§349) an unticked part's hidden fields are neither saved nor announced
    const next = mergeEdit(current, touched);
    if (!next.mature) next.matureWhy = "";
    const ou = checkOpenUntilChange(t.openUntil, next.openUntil ? new Date(next.openUntil) : null, new Date(), dev.timeZone);
    if (!ndaOnly && !ou.ok) throw new HttpError(409, "open_until_passed", ou.message);
    if (current.openUntil && next.openUntil && openUntilDay(current.openUntil, dev.timeZone) === openUntilDay(next.openUntil, dev.timeZone)) next.openUntil = current.openUntil;
    if (next.liveRateCents == null) next.liveMinutes = null;
    const testersIn = await tx.contract.count({ where: working(testId) });
    // (Owner, Nov 5, §269) Order doesn't matter: questions holding the same words and Required ticks in another order are not a questions change (no count, no
    // "Updated" mark, top-box line or bell, no Terms history set, no stop-once reason). The new order is simply saved (`reordered`, below).
    const fields = LISTING_FIELDS.filter((k) => !sameListingValue(k, current[k], next[k]));
    const reordered = !fields.includes("questions") && JSON.stringify(current.questions) !== JSON.stringify(next.questions);
    // (Design doc 4/5) The Post rules, then the critical-change limit and the access keys: every red mistake is found FIRST
    // (a stop-once reason never hides one), and nothing saves while any remains.
    const errs = checkListing(next, testersIn, new Date(), { changed: new Set(fields), openedAt: t.createdAt, edit: true, confirmedHigh: confirmedHighOf(body), saved: { writtenCents: t.writtenCents, recordingCents: t.recordingCents }, savedSpots: t.spots, tz: tzOf(body, dev) });
    if (fields.includes("openUntil")) { const short = openUntilShortened(current.openUntil, next.openUntil, tzOf(body, dev)); /* (batch 35 §30) the same line as the box */ if (short) errs.push(short); }
    // (Batch 14) Each limited field's counter (the parts and prices share one); the count runs once anyone is affected.
    const critical = countersOf(fields);
    const { since, counts } = await countingState(t, tx);
    const everJoined = !!since;
    // (Owner, Oct 28 afternoon) Each limited field has its OWN 3 changes: only a field that used all of them is refused (the others still save).
    const lockedNow = everJoined ? critical.filter((f) => lockedFields(counts).includes(f)) : [];
    errs.push(...lockedNow.map(criticalLine));
    const plan = await planKeyChange(tx, testId, keysAdd, keysRemove, next.spots);
    const keyErrs = [...plan.errors, ...(plan.need ? [plan.need] : [])];
    if (!ndaOnly) errs.push(...keyErrs);
    // (Batch 19 section 7) Every Save needs the tick about Charge (the page shows it while Save is enabled), red at the tick.
    if (!ndaOnly && !payRulesTicked(body)) errs.push(PAY_RULES_TICK_MISSING);
    const keysChanged = plan.toAdd.length > 0 || plan.removable.length > 0 || plan.toReuse.length > 0;
    // (Owner, Oct 28, batch 16 sections 17 and 18) Another tab's (or device's) save is a reason to stop only for the fields where what this press holds
    // differs from what's saved now. Its lines are replaced by one line naming just those fields ("You changed the description in another tab", carrying
    // the fields for the box's Before / What you typed) and, ALWAYS (keys decide what can still be added), the keys' "Added: …" / "Removed: …" lines since
    // the page loaded (or its last stop box). A page that doesn't send what it loaded and holds (an older page) keeps every line.
    let dcN: (TestEventLike & { fields?: string[] })[] = dc;
    let gateChanges = gate.go ? [] : notListed(gate.changes.map((e) => ({ ...e, eventId: (e as { id?: string }).id })), body);
    const news = seen && !onlyOwnSaves ? await editNews(tx, testId, body, current, tzOf(body, dev)) : null;
    // (Batch 16 section 20) A key this press deletes that a joining tester was given meanwhile (the page hadn't shown it): not a mistake, a stop with the
    // warning; the second press saves the rest of the key edits.
    if (seen) {
      const given = await tx.accessKey.findMany({ where: { testId, value: { in: keysRemove }, status: { in: ["inuse", "broken"] } }, include: { contract: { include: { tester: true } } } });
      if (given.length) dcN = [...dcN, { kind: "own", text: givenDeletedLine(given.map((k) => ({ name: k.contract ? displayName(k.contract.tester) : "A tester", value: k.value }))), createdAt: given.reduce((a, k) => ((k.assignedAt ?? k.createdAt) > a ? k.assignedAt ?? k.createdAt : a), given[0].assignedAt ?? given[0].createdAt) }];
    }
    if (news) {
      const isEdit = (e: TestEventLike) => (e.kind === "own" && (OTHER_TAB_EDIT.test(e.text) || !!e.save)) || (e.kind === "renamed" && !!e.listing) || e.kind === "edited" || e.kind === "edited_spots";
      const dropped = [...dc, ...gateChanges].filter(isEdit);
      dcN = dcN.filter((e) => !isEdit(e));
      gateChanges = gateChanges.filter((e) => !isEdit(e));
      const at = dropped.reduce((a, e) => (e.createdAt > a ? e.createdAt : a), dropped[0]?.createdAt ?? new Date());
      // (Batch 23 section 5) One line per typed field: "Instructions: your version will replace the one saved in another tab" (the page adds " at 3:54 PM."); spots and
      // Open until keep today's line.
      const theirs = news.fields.filter((f) => takesTheirs(f)), yours = news.fields.filter((f) => !takesTheirs(f));
      const lines: (TestEventLike & { fields?: string[] })[] = [
        ...(theirs.length ? [{ kind: "own", text: `You changed the ${andList(theirs.map((f) => FIELD_NAMES[f]))} in another tab`, createdAt: at, fields: theirs as string[] }] : []),
        ...yours.map((f) => ({ kind: "yours", text: replaceLine(f), createdAt: at, fields: [f] as string[] })),
        ...(news.added.length ? [{ kind: "own", text: keysAddedLine(news.added), createdAt: at }] : []),
        ...(news.removed.length ? [{ kind: "own", text: keysRemovedLine(news.removed), createdAt: at }] : []),
      ];
      if (lines.length) dcN = [...dcN, ...lines];
    }
    // (Owner, Nov 5, §271) A pause since Edit opened (their own hold or suspension starting, e.g. a charge declined in another tab; a team pause is the banner's
    // refusal instead) or the team's lift of its pause stops Save once, whatever the Alerts, in their own words ("Your tests were paused at 3:10 PM.", "The team
    // lifted its pause on this test at 3:10 PM."). It stands in for the team's own pause / lift records among the listing's version changes (no line twice).
    const stopMoment = await devStopSince(testId, null, loadedOf(body));
    const pauseLines = notListed([...(await devPauseMoments(testId, loadedOf(body))), ...(stopMoment ? [stopMoment] : [])], body);
    if (pauseLines.length) {
      const teamRecord = (e: TestEventLike) => (e.kind === "paused" && e.text === TEAM_PAUSED_EVENT) || (e.kind === "resumed" && e.text === TEAM_LIFTED_EVENT);
      const others = gateChanges.filter((e) => !teamRecord(e));
      dcN = [...dcN.filter((e) => !teamRecord(e)), ...pauseLines.map((e) => ({ ...e, forced: true })), ...(dcN.length ? [] : others)];
    }
    dcN = [...dcN].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const stop = dcN.length ? dcN.map((c) => ({ ...devLine(c, false), ...(c.fields ? { fields: c.fields } : {}), ...(c.kind === "yours" ? { kind: "yours" } : {}) })) : gateChanges.length ? gateChanges.map((c) => ({ text: renderTimes(c.text, dateZone()), at: c.createdAt, ...sidOf(c) })) : null;
    if (stop) {
      // Both together: the blue stop and any red mistakes (red wins: the next press still saves nothing while red remains).
      throw new HttpError(409, body.ndaOnly === true ? "stop_once" : "changed", dcN.length ? "Press Save again to save." : "This test changed since you opened Edit. Press Save again to save your changes on top.", {
        changes: stop, version: t.version, criticalCounts: counts, current, listingEdited, errors: errs, keys: await keysState(tx, testId), critical: critical.length ? critical : undefined,
        // (§373) The rule its developer lines were picked under (Save's press): the lines Edit picks up while the box is open follow it.
        ...(await devBoxRule(testId, EDIT_PRESS, tx)),
      });
    }
    if (errs.length) throw new HttpError(400, "bad_listing", errs[0], { errors: errs, critical: lockedNow.length ? lockedNow : undefined, criticalCounts: counts });
    if (!fields.length && !keysChanged) {
      if (!ndaOnly) keysGiven = await giveKeysToWorking(tx, testId); // (Batch 30 §17)
      // (§269) A Save that only reorders the questions: the order is saved and shown, nothing else happens.
      if (reordered) {
        await saveQuestionOrder(tx, testId, next.questions);
        return tx.test.update({ where: { id: testId }, data: { questions: next.questions as Prisma.InputJsonValue } });
      }
      return t;
    }
    const terms = changedTerms(current, next);
    const what = [...fields.map((f) => FIELD_NAMES[f]), ...(keysChanged ? ["access keys"] : [])].join(", ");
    // (Owner, Nov 5, §265) The questions are no longer a term: they follow the listing (below), so a Save that changes only them makes no Switch / Keep offer.
    // (Owner, Nov 5, §267) Nor the NDA: it follows the listing (below), with its own notice; a Save that changes only it makes no offer.
    termsChanged = terms.some((f) => ["writtenCents", "recordingCents", "liveRateCents", "liveMinutes", "writtenRequired", "recordingRequired", "liveRequired", "deadlineDays"].includes(f));
    // (NEWEST+12) Testers are alerted to EVERY change except the number of spots and Open until: those two never make an "edited" line / bump the listing version.
    const listingFields = fields.filter((f) => f !== "spots" && f !== "openUntil");
    switchedToAnyone = fields.includes("joinMode") && next.joinMode === "anyone";
    await recordEvent(tx, testId, listingFields.length ? "edited" : "edited_spots", `The listing was edited: ${listingFields.length ? listingFields.map((f) => FIELD_NAMES[f]).join(", ") : what}`, true, {
      ...listingData(next), ...(listingFields.length ? { listingVersion: { increment: 1 } } : {}),
      // (5; owner, Oct 28 afternoon) A save that changed limited fields after the first tester joined uses one change of EACH of them.
      ...(critical.length && everJoined ? { criticalCounts: storedCounts(countsAfter(counts, critical), since) } : {}),
    }, null, tab);
    if (keysChanged) {
      await applyKeyChange(tx, testId, plan.toAdd, plan.removable, plan.toReuse);
    }
    // (Owner, Nov 5, §265) Questions follow the listing: a Save that changed them writes them into every working tester's contract in this transaction (the one
    // place that keeps them in step, so "old" means the same on both sides), each change kept as a Terms history entry with that moment's answers and draft
    // (followQuestions). A contract whose questions already differ from the listing (an offer kept before §265) is brought in line here too.
    // (Owner, Nov 6, §283; was working contracts only) EVERY contract on the test follows, working or not (left, ended): the same Terms history entry, so an
    // ended tester's old answered questions live in Terms history like everyone else's and the Testers list shows the listing's questions. Only the working
    // testers are told (the bell); one who comes back is on the listing's questions already.
    if (fields.includes("questions")) {
      const now = new Date();
      for (const c of await tx.contract.findMany({ where: { testId }, select: { id: true, testerId: true, questions: true, prevSets: true, status: true, tester: { select: { email: true } } } }))
        if (await followQuestions(tx, c, next.questions, now) && c.status === "working") questionsFollowed.push({ contractId: c.id, email: c.tester.email });
    }
    // (§269) Reordered only (the Save changed other fields): the listing took the new order above; every working contract with the same questions takes it too.
    if (reordered) await saveQuestionOrder(tx, testId, next.questions);
    // (Owner, Nov 5, §267) The NDA follows the listing the same way: copied into every working contract, with the change's kind for its notice (and block).
    // (Owner, Nov 6, §283) And into every other contract on the test (left, ended), with no notice (followNda).
    if (fields.includes("ndaText")) ndaFollowed = await followNda(tx, testId, current.ndaText ?? "", next.ndaText ?? "", new Date(), ndaOnly);
    // (Owner, Oct 29, batch 30 §17) Keys added to a test whose working testers have none: each still WORKING tester gets one of the free keys, in order of joining.
    keysGiven = await giveKeysToWorking(tx, testId);
    // (Owner, Oct 30, batch 15 section 43) A Save that changed the terms or the names: one entry in the developer's Contract changes.
    const dealFields = fields.filter((f) => DEAL_FIELDS.includes(f));
    if (dealFields.length) {
      const pick = (l: Listing) => Object.fromEntries(dealFields.map((f) => [f, l[f] ?? null]));
      changeId = (await tx.testChange.create({ data: { testId, fields: dealFields, before: pick(current) as Prisma.InputJsonValue, after: pick(next) as Prisma.InputJsonValue } })).id;
    }
    // (Batch 30 §15) A Save that changed the listing information: kept before and after, for the testers' session pages ("Updated <time>", before → now, Terms
    // history). The Mature box and its note are kept together.
    const infoShown = fields.filter((f) => (LISTING_INFO_FIELDS as readonly string[]).includes(f));
    if (infoShown.length) {
      const keep = [...new Set(infoShown.flatMap((f) => (f === "mature" || f === "matureWhy" ? ["mature", "matureWhy"] as const : [f])))];
      const pick = (l: Listing) => Object.fromEntries(keep.map((f) => [f, l[f] ?? null]));
      await tx.testEvent.create({ data: { testId, kind: LISTING_VALUES, text: valuesText({ fields: infoShown, before: pick(current), after: pick(next) }) } });
    }
    // (Batch 34 §14) Every Save, kept whole (every changed field, before and after) for the developer's Listing panel: the fields its most recent Save changed carry
    // "Updated <time>" (Before / Now). A Save of only the access keys keeps one with no fields (nothing in the panel is tagged).
    {
      const pick = (l: Listing) => Object.fromEntries(fields.map((f) => [f, l[f] ?? null]));
      // (Batch 35 §17) With `keys` when it changed the access keys too, and the tab that saved it: devChanges knows from it alone whether this Save has its own
      // "You saved the listing in another tab" line (its rename then isn't a second line), before that line's action log is written.
      await tx.testEvent.create({ data: { testId, kind: LISTING_SAVED, text: savedText({ fields, before: pick(current), after: pick(next), ...(keysChanged ? { keys: true } : {}) }), ...(tab ? { tab } : {}) } });
    }
    // (Batch 15 section 24) A rename is recorded in every working tester's contract changes (never a note under a press).
    if (fields.includes("title") || fields.includes("productName")) {
      const nameOf = (l: Listing) => (l.productName ? `${l.productName} · ${l.title}` : l.title);
      const text = `Renamed: “${nameOf(current)}” → “${nameOf(next)}”`;
      const cs = await tx.contract.findMany({ where: working(testId), select: { id: true } });
      if (cs.length) await tx.contractNote.createMany({ data: cs.map((c) => ({ contractId: c.id, kind: "renamed", text })) });
    }
    // (Owner, Oct 30, batch 15 section 18) Moving Open until later by D days: tester days grow by D, and every working tester's deadline moves D days later.
    // (Owner, Nov 2) Only deadlines that haven't passed: a tester whose deadline already passed keeps it.
    if (fields.includes("openUntil") && next.openUntil && current.openUntil) {
      const d = daysBetween(openUntilDay(current.openUntil, tzOf(body, dev)), openUntilDay(next.openUntil, tzOf(body, dev)));
      if (d > 0) {
        await tx.test.update({ where: { id: testId }, data: { testerDays: (t.testerDays ?? testerDaysOf(t.createdAt, current.openUntil, dev.timeZone)) + d } });
        // (Owner, Nov 3, batch 35 §154) D calendar days in the developer's zone (where deadlines are counted), landing on that day's 11:59 PM.
        for (const c of await tx.contract.findMany({ where: { ...working(testId), dueAt: { gt: new Date() } }, select: { id: true, dueAt: true } }))
          await tx.contract.update({ where: { id: c.id }, data: { dueAt: dueAfterDays(c.dueAt, d, dev.timeZone) } });
      }
    }
    // (F) Listing info (description, devices, languages): shown to working testers and on the join page; stops once.
    const info = fields.filter((f) => INFO_FIELDS.includes(f));
    if (info.length) await tx.testEvent.create({ data: { testId, kind: "info", text: `${displayName(dev)} changed ${andList(info.map((f) => (f === "joinMode" ? FIELD_NAMES[f] : `the ${FIELD_NAMES[f]}`)))}` } });
    // A title change is info only everywhere (never stops; a press notes it).
    if (fields.includes("title")) await tx.testEvent.create({ data: { testId, kind: "renamed", text: `${displayName(dev)} renamed the test to ${next.title}` } });
    // (Batch 30 §10) Testers read ONE line per save, everywhere (join page, session page, stop boxes, top boxes): what this save changed, for each page to word.
    if (listingFields.length) await tx.testEvent.create({ data: { testId, kind: "listing_save", text: saveText({ by: displayName(dev), fields: listingFields, title: next.title, nda: !!next.ndaText }) } });
    // (§286) The fields a working tester's line counts (saveLine's "session" side): the title and the listing information.
    if (listingFields.some((f) => f === "title" || INFO_FIELDS.includes(f))) editedFor = await tx.contract.findMany({ where: working(testId), select: { id: true, testerId: true, tester: { select: { email: true } } } });
    changedNames = [...fields.map((f) => FIELD_NAMES[f]), ...(keysChanged ? ["access keys"] : [])];
    reinvite = !ndaOnly && fields.some((f) => CLOSING_FIELDS.includes(f));
    spotsChanged = fields.includes("spots");
    switchedToInvite = fields.includes("joinMode") && next.joinMode === "invite";
    return tx.test.findUniqueOrThrow({ where: { id: testId } });
  });
  // (Batch 34 §9) The Save went through: the kept draft ("Not saved yet") is gone, here as well as in the page, so no later visit (a tab switch, Back, another
  // device) can restore older text.
  await db.keptForm.deleteMany({ where: { userId: dev.id, key: `test:edit:${testId}` } });
  // Working testers are OFFERED the new contract terms (Switch / Keep); their contract changes only if they switch.
  const offered = termsChanged ? await offerNewTerms(testId, changeId) : 0;
  const closedApps = reinvite ? await (await import("./joining")).closeApplicationsAfterEdit(testId) : switchedToInvite ? await (await import("./joining")).closeApplicationsAfterEdit(testId, "invite_only") : [];
  // (Correction 4/5) Lowering spots never closes invites by itself; lowering them to the testers in fills the test.
  if (spotsChanged) {
    const filled = await db.$transaction(async (tx) => {
      const t = await lockTest(tx, testId);
      return (await tx.contract.count({ where: working(testId) })) >= t.spots ? closeOnFull(tx, testId, null) : null;
    });
    if (filled) await tellFull(filled);
    else await spotOpened(testId);
  }
  // (§341) A key added to a test that was full for want of one: joinable again, and invitees told it was full hear a spot opened (once per invite).
  if (keysWereFull && !(await (await import("./accessKeys")).keysFullNow(db, testId))) await spotOpened(testId, { keyAdded: true });
  // (Owner, Nov 9, §338) Applicants it couldn't join for want of a free access key stay waiting; the Save's note names them.
  const noKeyApps = switchedToAnyone ? (await (await import("./joining")).onSwitchToAnyone(testId)).noKey : [];
  // (NEWEST+4) Any listing change except spots / who can join re-sends open invites on the new listing.
  const { skipped: notReinvited, resent } = reinvite ? await (await import("./invites")).reinviteAfterEdit(testId) : { skipped: [], resent: [] };
  // (Batch 15 section 43) The Save's effects on others, on its Contract changes entry.
  const effects = [closedApps.length ? `${closedApps.length} application${closedApps.length === 1 ? "" : "s"} closed` : "", resent.length ? `${resent.length} invite${resent.length === 1 ? "" : "s"} re-sent` : ""].filter(Boolean).join(" · ");
  if (changeId && effects) await db.testChange.update({ where: { id: changeId }, data: { effects } });
  // (Owner, Nov 5, §265) Each tester whose questions changed: a bell line in the listing's words ("Nora Lane updated the listing: questions"), linking to their
  // contract box, where the questions carry "Updated <time>" (the top box's line comes from the Save's "listing_save" record).
  for (const q of questionsFollowed) {
    const line = questionsUpdatedLine(displayName(dev));
    await notify(q.email, line, [`${line}.`, "Questions you haven't answered yet are on your session page; your earlier answers are in Terms history."], `/app/sessions/${q.contractId}#scope`, { about: dev.id, testId });
  }
  // (Owner, Nov 5, §267) The NDA's own notice, apart from "updated the listing".
  // (Owner, Nov 6, §302) "<developer> changed the NDA" whatever the kind, linking to the session page's notice, whose Acknowledge button lifts the block
  // every NDA change now makes.
  for (const n of ndaFollowed) {
    const line = ndaChangedLine(displayName(dev));
    await notify(n.email, line, [`${line}.`, "Acknowledge it on your session page: until then your presses on this test wait for it (except Rate and Leave)."], ndaNoticeHref(n.contractId), { about: dev.id, testId });
  }
  // (Owner, Nov 6, §286) Every other working tester whose top box shows "Nora Lane edited the listing" gets it in the bell too, linking to "Your agreed scope" (each
  // changed line marked there). A tester told of this Save's questions above already has its line (never two for one Save); the NDA keeps its own notice.
  const questionsTold = new Set(questionsFollowed.map((q) => q.contractId));
  for (const c of editedFor.filter((x) => !questionsTold.has(x.id))) {
    const line = editedLine(displayName(dev));
    await notify(c.tester.email, line, [`${line}.`, "What changed is marked in Your agreed scope on your session page."], `/app/sessions/${c.id}#scope`, { recipientId: c.testerId, about: dev.id, testId });
  }
  // (Batch 30 §17) Each tester given a key: a line in their session page's top box (the key itself only on their page). (Owner, Nov 6, §312c) No bell or email
  // line any more ("<dev> gave you an access key for “X”").
  for (const g of keysGiven) await logEvent(testId, KEY_GIVEN, keyGivenEventLine(displayName(dev), g.name), g.contractId);
  return Object.assign(result, { offered, changed: changedNames, notReinvited, resent, closedApps, keysGiven: keysGiven.length, noKeyApps });
}

/** The access keys as an Edit tab needs them to tell what changed elsewhere (the free keys and how many are in use). */
async function keysState(tx: Tx, testId: string) {
  const keys = await tx.accessKey.findMany({ where: { testId }, orderBy: { createdAt: "asc" } });
  return { free: keys.filter((k) => k.status === "free").map((k) => k.value), inUse: keys.filter((k) => k.status === "inuse" || k.status === "broken").length };
}

/** (Batch 15 sections 24 and 43) The fields a Contract changes entry records: the terms and the names. */
export const DEAL_FIELDS: (keyof Listing)[] = ["productName", "title", "writtenCents", "recordingCents", "liveRateCents", "liveMinutes", "writtenRequired", "recordingRequired", "liveRequired", "deadlineDays", "questions", "ndaText"];

/** (Correction 2) The changes that close applications and re-send invites: prices / parts / questions, deadline, devices, languages, description. */
export const CLOSING_FIELDS: (keyof Listing)[] = ["ndaText", "writtenCents", "recordingCents", "liveRateCents", "liveMinutes", "writtenRequired", "recordingRequired", "liveRequired", "questions", "deadlineDays", "devices", "languages", "description", "buildUrl"]; // (batch 14) the build link too

export async function openDraft(dev: U, testId: string, body: Record<string, unknown> = {}) {
  const t = await ownTest(dev.id, testId);
  await devGateIfSeen(testId, body, { acts: ["open"], keys: ["test"] });
  if (t.status !== "draft") throw new HttpError(409, "not_draft", t.status === "stopped" ? stoppedPressLine("Accept testers again") : "This test is already open."); // (§363)
  await postPerks(dev.id, t.joinMode, testId);
  // (Owner, Nov 3, batch 35 §157) Checked again under the test's lock: of two Opens at once (two tabs) one opens it and records "opened"; the other reads
  // "This test is already open."
  return db.$transaction(async (tx) => {
    const now = await lockTest(tx, testId);
    if (now.status !== "draft") throw new HttpError(409, "not_draft", now.status === "stopped" ? stoppedPressLine("Accept testers again") : "This test is already open."); // (§363)
    return recordEvent(tx, testId, "opened", "The test opened for testers", true, { status: "open", testerDays: testerDaysFor(t.openUntil, dev) });
  });
}

/** (Batch 15 section 18) Tester days at the moment a test opens: today (the developer's date) to Open until. */
function testerDaysFor(openUntil: Date | string | null, dev: { timeZone?: string | null }) {
  return openUntil ? testerDaysOf(new Date(), openUntil, dev.timeZone) : null;
}

// ---------- developer: the top panel's big buttons (stop once) ----------

/**
 * The one stop-once gate for every developer button (top panel, live-call panel, Pay / Reject). If since the page loaded
 * (seenAt) any tester joined, left or sent work, a call was booked/confirmed/cancelled, times were offered/removed, or a
 * payment/rejection was made, the first press stops and returns the list; the second press (confirmed) goes ahead.
 */
/** (Batch 34 §9) The test events a listing Save records (its version bump). */
const LISTING_SAVE_KINDS = ["edited", "edited_spots"];
/** The developer's own listing save in another tab, as the action log says it ("You saved the listing in another tab: description, access keys"). */
const OTHER_TAB_EDIT = /^You (saved|changed) the listing in another tab/; // (batch 35 §34) the one line for every Save since the page loaded
/** Fields the form never sends as typed (kept from an older page, or set by the server). */
const NOT_COMPARED = new Set<keyof Listing>(["deadlineDays", "liveMinutes"]);
/** Two values of one field are the same (Open until by its day: a pause shift moves it by the minute). */
const sameValue = (k: keyof Listing, a: unknown, b: unknown, tz?: string | null) =>
  k === "openUntil" ? (a ? openUntilDay(String(a), tz) : null) === (b ? openUntilDay(String(b), tz) : null) : sameListingValue(k, a ?? null, b ?? null); // (§269) questions as a set
/**
 * (Owner, Nov 5, §269) A Save that reordered the questions without changing them: every working contract holding the same questions (words and Required ticks)
 * takes the new order, so the tester's question numbers follow it. No Terms history set, no notice: answers stay with their questions by their words.
 */
async function saveQuestionOrder(tx: Tx, testId: string, next: string[]) {
  for (const c of await tx.contract.findMany({ where: working(testId), select: { id: true, questions: true } })) {
    const qs = Array.isArray(c.questions) ? (c.questions as string[]) : [];
    if (sameQuestionSet(qs, next) && JSON.stringify(qs) !== JSON.stringify(next)) await tx.contract.update({ where: { id: c.id }, data: { questions: next as Prisma.InputJsonValue } });
  }
}
/**
 * (Owner, Oct 28, batch 16 sections 17 and 18) What another tab or device saved that THIS tab doesn't have: the fields it loaded (`base`) that differ from
 * what's saved now and where what it holds (`has`, typed or not) differs too. Keys are always news (the owner's exception): every free key added and
 * removed since the keys it loaded (`keysLoaded`), even one this tab also added or removed (a key given to a joining tester is a join, not a removal).
 * null when the page didn't send them (nothing is dropped then).
 */
export async function editNews(tx: Tx, testId: string, body: Record<string, unknown>, current: Listing, tz?: string | null) {
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const b = obj(body.base), h = obj(body.has);
  if (!b || !h) return null;
  let base: Partial<Listing>, has: Partial<Listing>;
  try {
    base = parseListing(b, true, tz);
    has = parseListing(h, true, tz);
  } catch {
    return null; // a box this press can't read (its own mistake is said elsewhere): every line stays
  }
  // (Owner, Oct 29, batch 23 section 5) Edit keeps what you typed: a field this press doesn't send took the other tab's value (it is never undone), so only the fields it
  // sends count, except spots and Open until (they take the other tab's value even when typed: today's rule, with the press holding what it had typed).
  const sent = new Set(Object.keys(obj(body.fields) ?? {}));
  const fields = LISTING_FIELDS.filter((k) => !NOT_COMPARED.has(k) && k in base && k in has && (takesTheirs(k) || sent.has(k)) && !sameValue(k, base[k], current[k], tz) && !sameValue(k, has[k], current[k], tz));
  let added: string[] = [], removed: string[] = [];
  if (Array.isArray(body.keysLoaded)) {
    const loaded = parseKeys(body.keysLoaded);
    const keys = await tx.accessKey.findMany({ where: { testId }, select: { value: true, status: true } });
    const free = keys.filter((k) => k.status === "free").map((k) => k.value);
    const used = keys.filter((k) => k.status === "inuse" || k.status === "broken").map((k) => k.value);
    added = free.filter((v) => !loaded.includes(v));
    removed = loaded.filter((v) => !free.includes(v) && !used.includes(v));
  }
  return { fields, added, removed };
}

/**
 * One line of a developer's stop-once box. (Owner, Oct 28) A tester's Switch / Keep line carries its contract, so the box under the button shows "See their contract" like the top box.
 */
export const devLine = (c: TestEventLike & { contractId?: string | null }, withAlert = true) => ({
  text: renderTimes(c.text, dateZone()), at: c.createdAt,
  // (Owner, Nov 5, §250) Its identity: once this box lists it, no other press on the page stops for it.
  ...sidOf(c),
  ...(c.kind === "terms" && c.contractId ? { kind: "terms", contract: c.contractId } : {}), ...(withAlert && alertOf(c.kind) ? { alert: alertOf(c.kind) } : {}),
  // (Batch 26 section 4) A stop line says its own time: the box doesn't add it again.
  ...(c.kind === "stop" ? { kind: "stop" } : {}),
  // (Batch 20 section 4) A line that stands for one thing (a ticked tester's needs): a later stop's line with the same key replaces it in the box.
  ...(c.key ? { key: c.key } : {}),
  // (Batch 34 §14) A listing change: See it jumps to the test page's Listing panel.
  ...(c.listing ? { listing: true } : {}),
  // (Batch 35 §3) ... and names its Save, so See it marks that Save's fields only.
  ...(c.saveAt ? { saveAt: c.saveAt } : {}),
  // (Batch 35 §34) ... and the panel lines all the listing changes it covers changed (See it marks the union).
  ...(c.keys?.length ? { keys: c.keys } : {}),
  // (Owner, Nov 3, §160) A line no Alerts tick could switch off: the box shows no "turn these stops off" for it.
  ...(c.forced ? { forced: true } : {}),
});

/**
 * (Batch 16 section 21) `press`: what this press is and touches. What the developer did in another tab stops it once only when that action touches it (the same
 * press, or one on the same thing); (batch 29 section 12) the changes in BIG_OWN_ACTS stop every press once ("You paid Ana Silva $10.00 … in another tab").
 */
export async function devGate(tx: Tx, testId: string, body: Record<string, unknown>, extra: Record<string, unknown> = {}, extraChanges: TestEventLike[] = [], keep?: (e: TestEventLike) => boolean, press: Press = { acts: [], keys: [] }) {
  // (Owner) The second press goes ahead only if nothing new happened since the box last updated (boxAt).
  const boxAt = seenOf(body.boxAt);
  if (body.confirmed === true && !boxAt) return;
  const seenAt = body.confirmed === true && boxAt ? boxAt : seenDate(body.seenAt);
  // (Owner, Oct 28, batch 17 section 12) Pay / Pay more on a page opened BEFORE the test stopped, closed or this tester's work ended early: it stops once with the stop as the
  // one change; the second press (its box shown after the stop) goes ahead, as on a page opened after it.
  // (Batch 30, Oct 29 addition) The stop is listed WITH every other change since the page last showed them (it no longer replaces them), oldest first.
  const moments: TestEventLike[] = [];
  if (press.stopCheck !== undefined) {
    const loaded = loadedOf(body);
    const stop = (await devStopSince(testId, press.stopCheck || null, loaded)) ?? (await devPauseSince(testId, loaded));
    if (stop) moments.push(stop);
    // (Owner, Nov 5, §207) The team lifting its pause is named like the pause: "The team lifted its pause on this test at 3:10 AM.".
    moments.push(...(await devLiftSince(testId, loaded)));
  }
  // (Owner, Oct 29, batch 29 section 11; replaces batch 16 section 25's "goes through on the first press") On a stopped, closed or paused test (any cause), and while the
  // developer is held or suspended, every press still allowed follows the SAME stop-once rules as on a running test. The stop, close or pause itself is a change like any
  // other: a page opened before it stops once naming it ("You stopped this test at 3:10 PM.", "The team paused this test at 3:10 PM.").
  if (press.stopCheck === undefined && !press.inState) {
    const stop = await devStopSince(testId, null, loadedOf(body));
    if (stop) moments.push(stop);
    const pause = await devPauseSince(testId, loadedOf(body));
    if (pause) moments.push(pause);
    moments.push(...(await devLiftSince(testId, loadedOf(body)))); // (§207) and its lift, named the same way
  }
  if (body.confirmed === true) extraChanges = extraChanges.filter((c) => c.createdAt > seenAt);
  const t = await tx.test.findUniqueOrThrow({ where: { id: testId }, select: { developerId: true } });
  const found = await devChanges(t.developerId, testId, seenAt, tabOf(body), tx, { press, page: pageOf(body) });
  // The developer's own Stop in another tab already reads "You stopped the test in another tab": the stop moment isn't said twice.
  const own = found.some((e) => e.kind === "own" && e.text === OWN_STOP_LINE);
  const additional = await unanswered(t.developerId, testId, [...extraChanges, ...moments.filter((m) => !(own && m.text.startsWith("You stopped this test")))], tx);
  // (Batch 35 §79) Never the line about the very thing this press answers (a call request, an application). (§155) Pay, Pay more and Confirm on a piece answer
  // none of the piece's own work lines: an unseen one stops them once.
  // (Owner, Nov 5, §250) Nor a line a stop box on this page already LISTED (any button's box: `shownIds`), forced ones and the stop / pause moments included:
  // it counts as seen for every button on the page. A line no box listed (left out by that press's Alerts) still stops by the usual rules.
  const raw = notListed([...found, ...additional].filter((e) => !answersIt(e, press.answers)), body).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  // (Owner, Oct 28) `keep`: a button that stops for only some kinds (Rate after the test closed).
  const changes = withRenamed(keep ? raw.filter((e) => e.kind === "renamed" || e.kind === "stop" || keep(e)) : raw, body);
  if (changes.length) {
    // (Owner, Nov 3, §160) Each line says whether any Alerts tick could have switched it off (`forced`): the box offers to turn off only the ones that could.
    // (§373) With the rule it was built under: the lines the page picks up while the box is open follow it.
    throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes: changes.map((c) => devLine({ ...c, forced: devForced(c, press) })), ...extra, ...(await devBoxRule(testId, press, tx)) });
  }
}
/** (§373) Edit's Save, as its developer lines are picked: it touches the whole test. */
const EDIT_PRESS: Press = { acts: ["edit"], keys: ["*"] };
/** The developer's own Stop made in another tab, as its line reads. */
const OWN_STOP_LINE = "You stopped the test in another tab";

/** Is this developer on a payment hold? (All their tests are paused.) */
export async function devOnHold(devId: string) {
  const u = await db.user.findUnique({ where: { id: devId }, select: { holdStartedAt: true } });
  return !!u?.holdStartedAt;
}
/** (Owner, Oct 27) Does this developer owe a declined charge (before or during the hold)? Their Pay buttons wait; testers' Dispute and Charge wait. */
export async function devOwes(devId: string) {
  return (await db.payment.count({ where: { developerId: devId, status: "failed", owedUntil: { not: null }, settledAt: null } })) > 0;
}
export const topPanelGate = devGate;

/** The developer gate for buttons that older pages sent without a "seen" marker: gated only when the page sends one. */
export async function devGateIfSeen(testId: string, body: Record<string, unknown>, press?: Press) {
  if (seenOf(body.seenAt)) await db.$transaction((tx) => devGate(tx, testId, body, {}, [], undefined, press));
}

/** Calls ahead are cancelled (no charge) when a tester's work ends. Their offered times open again for others. */
export async function cancelCallsAhead(tx: Tx, contractIds: string[], note: string, after = new Date()) {
  const ahead = await tx.call.findMany({ where: { contractId: { in: contractIds }, status: "booked", startsAt: { gt: after } }, include: { contract: { include: { tester: true, test: { select: { title: true } } } } } });
  for (const c of ahead) {
    await tx.call.update({ where: { id: c.id }, data: { status: "cancelled", cancelledBy: "system", cancelledAt: new Date(), cancelNote: note } });
    await tx.callSlot.update({ where: { id: c.slotId }, data: { status: "removed" } });
  }
  return ahead.map((c) => ({ email: c.contract.tester.email, startsAt: c.startsAt, contractId: c.contractId, title: c.contract.test.title, callId: c.id }));
}

/** Tell each tester their booked call was cancelled (never any fault). */
export async function tellCancelled(list: { email: string; startsAt: Date; contractId: string; title: string; callId?: string }[], why: Parameters<typeof callCancelledLine>[1]) {
  for (const c of list) await notify(c.email, callCancelledLine(c.startsAt, why, c.title), [callCancelledLine(c.startsAt, why, c.title)], `/app/sessions/${c.contractId}${c.callId ? `#call-${c.callId}` : ""}`);
}

export async function stopTest(dev: U, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  // (Batch 17 §15) A required "Why?" like End early's: at least one character, at most 10,000, refused beyond (never cut). Testers read it (also when paused or restricted).
  const reason = readText(body.reason, LIMITS.stopReason, "bad_reason");
  if (!reason) throw new HttpError(400, "bad_reason", "Say why you're stopping the test (testers read it).");
  if (reason.length < WHY_MIN_CHARS) throw new HttpError(400, "bad_reason", WHY_TOO_SHORT); // (batch 20 section 27)
  let cancelled: Awaited<ReturnType<typeof cancelCallsAhead>> = [];
  let invitesClosed: string[] = [];
  const contracts = await db.$transaction(async (tx) => {
    const t = await lockTest(tx, testId);
    // (Owner, Nov 11, §380; replaces batch 16 section 21's stop then refusal) Already stopped: what Stop wanted, so no stop box and no refusal (the page redraws).
    if (t.status === "stopped") return null;
    // (Owner, Oct 29, batch 29 section 11; replaces batch 15 sections 23, 29 and 37) While the test is paused (any cause) Stop follows the same stop-once rules.
    await topPanelGate(tx, testId, body, {}, [], undefined, { acts: ["stop"], keys: ["test"] });
    const cs = await tx.contract.findMany({ where: working(testId), include: { tester: true, test: { select: { title: true } } } });
    // (Batch 17 §15) The reason is each ended contract's endReason, and an entry in each tester's contract changes (the marker that it's the developer's own reason).
    await tx.contract.updateMany({ where: working(testId), data: { status: "ended", endKind: "stopped", endedAt: new Date(), endReason: reason } });
    await (await import("./accessKeys")).releaseInactiveKeys(tx, testId);
    if (cs.length) await tx.contractNote.createMany({ data: cs.map((c) => ({ contractId: c.id, kind: STOP_NOTE_KIND, text: stopNoteText(reason) })) });
    cancelled = await cancelCallsAhead(tx, cs.map((c) => c.id), "The test was stopped.");
    await closeOffersOfEnded(tx, cs.map((c) => c.id)); // (batch 35 §118)
    await tx.callRequest.updateMany({ where: { contractId: { in: cs.map((c) => c.id) }, status: "pending" }, data: { status: "closed", closedReason: "the test was stopped", decidedAt: new Date() } });
    // (Owner, Oct 31, batch 35 §83) Waiting applications and rejoin asks close too, like the team's Stop (restrictions.ts): nothing left to Accept on a stopped test.
    await tx.application.updateMany({ where: { testId, status: "pending" }, data: { status: "closed", closedReason: "stopped", decidedAt: new Date() } });
    await tx.callSlot.updateMany({ where: { testId, status: "open" }, data: { status: "removed" } });
    invitesClosed = await (await import("./invites")).openInviteIds({ testId }, tx);
    await tx.invite.updateMany({ where: { testId, status: "sent" }, data: { status: "cancelled" } }); // (batch 16 section 32) a stop closes open invites
    await recordEvent(tx, testId, "stopped", stopEventText(reason), true, { status: "stopped", stoppedAt: new Date() });
    return cs;
  });
  if (!contracts) return { stopped: true, testers: 0, already: true };
  await tellCancelled(cancelled, "stopped");
  await (await import("./invites")).tellInvitesClosed(invitesClosed); // (batch 30 §6)
  // (Batch 17 §15) The reason in full in the email, never in the bell line.
  for (const c of contracts)
    await notify(c.tester.email, `“${c.test.title}” was stopped`, [`${displayName(dev)} stopped “${c.test.title}”: “${reason}”`, "Your work on it has ended. Work you already sent is still reviewed and paid. Calls ahead are cancelled."], `/app/sessions/${c.id}`, { group: "tstopped" });
  return { stopped: true, testers: contracts.length };
}

/**
 * End the ticked testers' work now. Work they sent is still reviewed; calls ahead are cancelled; later presses are refused.
 * (`contractIds`: the ticks; `contractId` still works for one.) If every ticked tester is already out, nothing is ended and the refusal names them.
 * (Owner, Nov 5, §278) If only some are out (left, ended, rated… since the page loaded), each of those gets its own refusal line ("Your End early didn't go
 * through for mhann: mhann already left the test.", `gone`) and the press goes on for the others by the ordinary rules: a stop once for what's new (with the
 * refusal lines beside it; the page unticks them), or their work ends at once (the refusal lines beside the done line).
 */
export async function endEarly(dev: U, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  // (Owner, Oct 30, batch 15 section 22) Required (at least one character), at most 10,000, refused beyond (never cut).
  const reason = readText(body.reason, LIMITS.endEarlyReason, "bad_reason");
  if (!reason) throw new HttpError(400, "bad_reason", "Say why you're ending their work (they read it).");
  if (reason.length < WHY_MIN_CHARS) throw new HttpError(400, "bad_reason", WHY_TOO_SHORT); // (batch 20 section 27)
  const ids = [...new Set((Array.isArray(body.contractIds) ? body.contractIds : [body.contractId]).map((x) => String(x ?? "")).filter(Boolean))];
  if (!ids.length) throw new HttpError(400, "none", "Tick at least one tester.");
  let cancelled: Awaited<ReturnType<typeof cancelCallsAhead>> = [];
  let goneLines: EndEarlyGone[] = [];
  const ended = await db.$transaction(async (tx) => {
    const lockedTest = await lockTest(tx, testId);
    // (Owner) After a stop, a stale press fails and names the stop.
    if (lockedTest.status === "stopped") throw new HttpError(409, "stopped", stoppedPressLine("End early")); // (§363)
    const list = [];
    // (Owner, Oct 28, batch 16 section 21) Testers this developer already ended early in another tab: this press stops once ("You ended Ana Silva's work early
    // in another tab"); on the second press they're dropped and the rest go through.
    const endedElsewhere: { id: string; name: string }[] = [];
    // (Owner, Nov 5, §278) Ticked testers whose part ended otherwise (left, rated, removed, ended…): a refusal line each.
    const gone: { id: string; name: string; why: string }[] = [];
    for (const id of ids) {
      const c = await tx.contract.findUnique({ where: { id }, include: { tester: true, test: { select: { title: true } } } });
      if (!c || c.testId !== testId) throw new HttpError(404, "not_found", "Choose a tester.");
      const name = displayName(c.tester);
      if (c.status === "left") { gone.push({ id, name, why: RF.pressRefused(RF.sessionEndedCause(name), "End early") }); continue; } // (§364 item 4)
      if (c.status === "ended" && c.endKind === "early" && seenOf(body.seenAt) && c.endedAt && c.endedAt > seenOf(body.seenAt)!) { endedElsewhere.push({ id, name }); continue; }
      if (c.status !== "working") { gone.push({ id, name, why: RF.pressRefused(RF.sessionEndedCause(name), "End early") }); continue; } // (§364 item 4)
      list.push(c);
    }
    // (§278) Nobody ticked is still working: one refusal naming them, as before.
    if (!list.length && gone.length) throw new HttpError(409, "gone", [...gone.map((g) => g.why), ...endedElsewhere.map((x) => RF.pressRefused(RF.sessionEndedCause(x.name), "End early"))].join(" "));
    // (§278) Some still working: the others' refusal lines go with whatever this press shows (its stop box, or its done line).
    if (list.length) {
      goneLines = [...gone, ...endedElsewhere.map((x) => ({ ...x, why: RF.pressRefused(RF.sessionEndedCause(x.name), "End early") }))].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)).map((g) => ({ contractId: g.id, text: g.why })); // (§364 item 4) one line each
    }
    const goneIds = new Set(gone.map((g) => g.id));
    // (§278) A gone tester's own leaving line is what their refusal line says: it doesn't stop the press for the others.
    const notTheirLeaving = goneIds.size ? (e: TestEventLike & { contractId?: string | null }) => !(e.kind === "left" && !!e.contractId && goneIds.has(e.contractId)) : undefined;
    // (Batch 29 sections 11-12) Paused or not, it stops once for what changed since the page loaded, the developer's own changes in another tab included (batch 16
    // section 21: ended the ticked testers early, paid their work, or requested, booked or cancelled a call with them; batch 29: any of BIG_OWN_ACTS).
    // (§278) The press is about the ticked testers still in it (and those ended in another tab, as before).
    await topPanelGate(tx, testId, body, goneLines.length ? { gone: goneLines } : {}, [], notTheirLeaving, { acts: ["end-early", ...PAY_ACTS, ...CALL_ACTS], keys: ids.filter((id) => !goneIds.has(id)).map((id) => `c:${id}`) });
    if (!list.length && endedElsewhere.length) throw new HttpError(409, "gone", endedElsewhere.map((x) => RF.pressRefused(RF.sessionEndedCause(x.name), "End early")).join(" ")); // (§364 item 4)
    for (const c of list) {
      await tx.contract.update({ where: { id: c.id }, data: { status: "ended", endKind: "early", endedAt: new Date(), endReason: reason } });
      await (await import("./accessKeys")).releaseTesterKeys(tx, c.id);
      cancelled = cancelled.concat(await cancelCallsAhead(tx, [c.id], "The developer ended the work early."));
      await closeOffersOfEnded(tx, [c.id]); // (batch 35 §118)
      await tx.callRequest.updateMany({ where: { contractId: c.id, status: "pending" }, data: { status: "closed", closedReason: "the session ended", decidedAt: new Date() } });
      await recordEvent(tx, testId, "ended", `You ended ${displayName(c.tester)}'s work early`, false, {}, c.id);
    }
    return list;
  });
  await tellCancelled(cancelled, "ended");
  for (const c of ended)
    await notify(c.tester.email, `Your work on “${c.test.title}” was ended early`, [`${displayName(dev)} ended your work on “${c.test.title}”: “${reason}”`, "Work you already sent is still reviewed and paid. Calls ahead are cancelled."], `/app/sessions/${c.id}`, { about: dev.id, group: "tstopped" });
  await spotOpened(testId);
  // (§278) With refusal lines for ticked testers already out: the done line they show beside.
  return { ended: true, count: ended.length, endedIds: ended.map((c) => c.id), ...(goneLines.length ? { gone: goneLines, done: `You ended ${andList(ended.map((c) => displayName(c.tester)))}'s work early.` } : {}) };
}
/** (Owner, Nov 5, §278) One ticked tester End early couldn't act on (already out): its own refusal line, and the tick the page removes. */
export type EndEarlyGone = { contractId: string; text: string };
/** "Your End early didn't go through for mhann: mhann already left the test." */
export const endEarlyGoneLine = (name: string, why: string) => `Your End early didn't go through for ${name}: ${why}`;

/**
 * Next round: a draft copy of the test for the next build.
 * (Owner, Nov 3, batch 35 §168; replaces batch 16 §21's and batch 27 §2's next-round rules and the Oct 28 one-draft rule) One tap: every press makes a new draft
 * and opens it in Post a test. No stop-once, no check of drafts made before (in this tab or another): the developer names each one. The draft's name starts
 * EMPTY (Post asks for it); everything else is this test's saved details.
 */
export async function nextRound(dev: U, testId: string) {
  await ownTest(dev.id, testId);
  // (Batch 8) Next round is a subscriber perk.
  await (await import("./subscription")).requirePerk(dev.id, "nextRound");
  const res = await db.$transaction(async (tx) => {
    const t = await lockTest(tx, testId);
    // (Owner, Oct 28 evening) Next round stays on a stopped test: it starts a new draft from it.
    if (await devOnHold(dev.id)) throw new HttpError(409, "on_hold", RF.pressRefused(RF.HELD_CAUSE, "Next round")); // (§364 item 7)
    const round = t.round + 1;
    const copy = await tx.test.create({
      data: {
        // (Batch 31) The next round takes at most 10 testers, like any test posted now. (§168) No name: the developer types it in Post.
        ...listingData(asListing(t)), spots: Math.min(t.spots, MAX_SPOTS), title: "", developerId: dev.id, status: "draft", round, previousId: t.id,
        questions: t.questions as Prisma.InputJsonValue,
      },
    });
    // (Owner) Starting a next round never changes this round: it keeps taking testers and everyone carries on. (§168) One event per press (several drafts:
    // several lines); it no longer moves this test's version, so it never stops an Edit Save either.
    await recordEvent(tx, testId, "next_round", `Round ${round} was started`, false, {});
    return { id: copy.id };
  });
  return res;
}

// ---------- tester: find and join ----------

/** Open tests the tester can join (not their own, not full, not already joined). (Batch 17 section 8) `q`: the search box (test, product or developer name). */
export async function findTests(tester: U, q?: unknown) {
  const query = typeof q === "string" ? q.trim() : "";
  const { previousNamesFor, previousNameMatch } = await import("./previousNames");
  const names = query ? await previousNamesFor(tester.id) : new Map<string, string[]>();
  const { nameMatches } = await import("@/lib/nameSearch");
  const matches = [...names].filter(([, aliases]) => aliases.some((name) => nameMatches(name, query))).map(([id]) => id);
  const search = (await import("./findSearch")).testSearchWhere(q, false, matches);
  const include = { _count: { select: { contracts: { where: { status: "working" } } } }, developer: { select: { name: true, email: true, timeZone: true } }, contracts: { where: { testerId: tester.id }, select: { id: true, status: true } } } as const;
  const [tests, joined] = await Promise.all([
    db.test.findMany({
      where: {
        ...search,
        status: "open", adminPausedAt: null, developerId: { notIn: [tester.id, ...(await blockPartners(tester.id))] }, developer: { devSuspendedAt: null, holdStartedAt: null },
        // Not joined, or LEFT (they can come back: not after rating, not if the developer ended them).
        contracts: { none: { testerId: tester.id, OR: [{ status: { not: "left" } }, { endKind: "rated" }] } },
        // (Owner, Oct 30, batch 15 section 38) Invite-only tests are never in Find, not even for invited testers (they reach them from their invites, the bell or the email).
        joinMode: { not: "invite" },
        // (Batch 15 section 18) After Open until the test is closed to everyone who hasn't joined: out of Find.
        OR: [{ openUntil: null }, { openUntil: { gt: new Date() } }],
      },
      include,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    // (Owner, Nov 6, §279) A test the tester is working in stays in Find (the search applies as to any other test), even when it's closed to new joiners (full,
    // joining closed, invite only, paused): the card reads "Joined" and opens their session. Left, ended or rated: only the query above (today's rules).
    db.test.findMany({ where: { ...search, contracts: { some: { testerId: tester.id, status: "working" } } }, include, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  // Most relevant first (owner): tests needing a device the tester has, then tests open to any device, then tests
  // needing a device they don't list; newest first within each group.
  const p = await db.testerProfile.findUnique({ where: { userId: tester.id } });
  const rank = (t: { devices: string[]; languages: string[] }) =>
    t.devices.length ? (t.devices.some((d) => p?.devices.includes(d)) ? 0 : 2) : 1;
  // (Owner, Nov 9, §341) A test that uses access keys with none free is full to testers too: out of Find like a full one.
  const noKey = await (await import("./accessKeys")).noFreeKeyTests(db, tests.map((t) => t.id));
  const all = [...tests.filter((t) => t._count.contracts < t.spots && !noKey.has(t.id)), ...joined.filter((j) => !tests.some((t) => t.id === j.id))].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return all.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map(({ t }) => ({ ...t, previousName: previousNameMatch(t.developer.name, names.get(t.developerId), query) }));
}

/** (Owner, Nov 6, §279) The tester's working contract on a Find card's test (its card reads "Joined" and opens /app/sessions/<id>), if any. */
export const joinedContract = (t: { contracts?: { id: string; status: string }[] }) => t.contracts?.find((c) => c.status === "working") ?? null;

/** (NEWEST+8) One line for EACH unmet need (devices, languages); none when the profile fits. */
export function needsLines(t: { devices: string[]; languages: string[] }, p: { devices: string[]; languages: string[] } | null) {
  const out: string[] = [];
  if (t.devices.length && !t.devices.some((d) => p?.devices.includes(d))) out.push(`This test needs one of: ${t.devices.join(", ")}. Add your device in your profile.`);
  if (t.languages.length && !t.languages.some((l) => p?.languages.includes(l))) out.push(`This test needs one of: ${t.languages.join(", ")}. Add the language in your profile.`);
  return out;
}
/**
 * (NEXT-UI 4b) Missing device / language: warn, never refuse. The first press says what's missing (the page's pop-up
 * asks); "anyway" goes ahead, but if something is missing now that the pop-up didn't show (`gapsShown`), it stops once more
 * with the list as it is now.
 */
export function gapStop(t: { devices: string[]; languages: string[] }, profile: { devices: string[]; languages: string[] } | null, body: Record<string, unknown>, verb: "Join" | "Apply" | "Ask") {
  const gaps = gapsOf(t, profile);
  if (noGaps(gaps)) return;
  // (Batch 20 section 3) In the Invite anyway box's words, both kinds in one line.
  const message = `Your profile ${missingNeedText(gaps)}.\n${verb === "Ask" ? "Ask to rejoin" : verb} anyway?`;
  // (Batch 35 §44) `now`: the pop-up's open time (server time): a profile or needs save after it names where a change came from.
  if (body.anyway !== true) throw new HttpError(409, "needs", message, { gaps, now: new Date().toISOString() });
  // (Batch 35 §47) Stops again only for a KIND missing now that the pop-up showed as covered (one-or-none, like the Invite rows), never for items within a kind.
  const shown = readGaps(body.gapsShown);
  if (shown && gapsUnseen(gaps, shown)) throw new HttpError(409, "needs", message, { gaps, changed: true, now: new Date().toISOString() });
}
/** (Owner, Nov 2) A tester's profile is saved once it names at least one device and one language (Save requires both; sign-up leaves it empty). */
export const profileSaved = (p: { devices: string[]; languages: string[] } | null) => !!p && p.devices.length > 0 && p.languages.length > 0;
/** (Owner, Nov 2) Like a developer's card before posting: Join, Apply, an invite's Join and Ask to rejoin need a saved profile. */
export const PROFILE_FIRST = "Save your tester profile first: pick the devices and languages you test on in Profile.";
/** Why this tester's profile doesn't fit the test's needs, or "" when it does (every unmet need). */
export const needsGap = (t: { devices: string[]; languages: string[] }, p: { devices: string[]; languages: string[] } | null) => needsLines(t, p).join(" ");

/**
 * Join: the tester sends the listing version they saw. A changed listing stops once and returns the new terms;
 * the second press joins on them. Closed, stopped or full tests refuse for good. The contract is a snapshot.
 */
export async function joinTest(tester: U, testId: string, body: Record<string, unknown>, options: { applicationId?: string; /** what the claimed application becomes (default "joined") */ applicationStatus?: "joined" | "accepted"; quietJoinEvent?: boolean } = {}) {
  if (!tester.isTester) throw new HttpError(403, "not_tester", "Turn on “test apps, games and more” in your profile to join tests.");
  const profile = await db.testerProfile.findUnique({ where: { userId: tester.id } });
  // (Owner, Nov 2) The tester's own press needs a saved profile (a developer accepting their application or ask doesn't: they pressed with one).
  if (!options.applicationId && !profileSaved(profile)) throw new HttpError(409, "profile_first", PROFILE_FIRST);
  const seen = Number(body.listingVersion);
  // (Owner, Nov 11, §377) The tester's own Join, Apply and Ask to rejoin no longer come through here: they make one pass under the test's lock (joining.ts) and
  // save with saveJoin. Here: the developer's Accept, an invite meeting an ask, the switch to "Anyone can join".
  const joined = await db.$transaction(async (tx) => {
    const t = await lockTest(tx, testId);
    if (options.applicationId) {
      const application = await tx.application.findUnique({ where: { id: options.applicationId } });
      if (!application || application.testId !== testId || application.testerId !== tester.id || application.status !== "pending")
        throw new HttpError(409, "application_gone", "This application is no longer waiting.");
      const claimed = await tx.application.updateMany({ where: { id: application.id, status: "pending" }, data: { status: options.applicationStatus ?? "joined", decidedAt: new Date() } });
      if (!claimed.count) throw new HttpError(409, "application_gone", "This application is no longer waiting.");
    }
    if (t.developerId === tester.id) throw new HttpError(409, "own", "You can't join your own test.");
    // (NEWEST+4) Rejoining: a tester who LEFT comes back on the current listing; one the developer ENDED only through
    // a new invite. Their old session is restored (work, reviews, payments, chat, disputes, call history).
    const old = await tx.contract.findUnique({ where: { testId_testerId: { testId, testerId: tester.id } } });
    if (old && old.status === "working") throw new HttpError(409, "already", "You've already joined this test.");
    // (NEWEST+5) A rating finishes the part for good: no rejoin ever.
    if (old && (await tx.rating.count({ where: { contractId: old.id } }))) throw new HttpError(409, "not_again", old.endKind === "rated" && old.status === "left" ? "You rated this test, so you can't join it again." : "You can't join this test again.");
    if (old && old.status === "ended" && body.rejoinAccepted !== true && !(await tx.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } }))) throw new HttpError(409, "not_again", "You can't join this test again.");
    const dev = await tx.user.findUniqueOrThrow({ where: { id: t.developerId } });
    if (testPaused(dev, t)) throw new HttpError(409, "paused", RF.pressRefused(RF.NOT_TAKING_CAUSE, "Join")); // (§364 item 10)
    const testersIn = await tx.contract.count({ where: working(testId) });
    const r = joinCheck({ status: t.status, listingVersion: t.listingVersion, spots: t.spots, testersIn, openUntil: t.openUntil }, seen, body.confirmed === true, new Date(), (d) => fmtDate(d).replace(/, \d{4}$/, ""));
    if (r.result === "refused") throw new HttpError(409, "refused", r.message);
    if (r.result === "changed") {
      throw new HttpError(409, "listing_changed", "The developer changed this test since you opened it. Check the new terms, then press Join again to join on them.", {
        listingVersion: t.listingVersion, terms: termsLine(asListing(t), true), questions: t.questions,
      });
    }
    // (Owner, Nov 11, §380 H) Each person's own block names it in their own press ("You blocked Nora Lane, so your Join didn't go through."; the developer's Accept:
    // "You blocked Ana Silva, so your Accept didn't go through."); the other person's reads neutral.
    const byDev = body.acceptedByDeveloper === true;
    if (await tx.block.count({ where: { blockerId: tester.id, blockedId: t.developerId } })) throw new HttpError(409, "blocked", byDev ? `${displayName(tester)}'s application was closed.` : RF.pressRefused(RF.ownBlockCause(displayName(dev)), "Join"));
    if (await tx.block.count({ where: { blockerId: t.developerId, blockedId: tester.id } })) throw new HttpError(409, "closed", byDev ? RF.pressRefused(RF.ownBlockCause(displayName(tester)), "Accept") : "This test isn't taking new testers right now.");
    gapStop(t, profile, body, "Join");
    // (Design doc 7.3) Joining needs the NDA accepted (the time it was accepted is kept with the terms).
    const ndaAt = typeof body.ndaAcceptedAt === "string" && !isNaN(new Date(body.ndaAcceptedAt).getTime()) ? new Date(body.ndaAcceptedAt) : null;
    if (t.ndaText && body.ndaAccepted !== true && !ndaAt) throw new HttpError(400, "nda", "Accept the NDA to join.");
    return saveJoin(tx, t, tester, body, options);
  });
  await afterJoin(joined, tester, testId, body);
  return joined.contract;
}

/** (Owner, Nov 11, §377) What a join saved, for afterJoin. */
export type Joined = Awaited<ReturnType<typeof saveJoin>>;

/**
 * (Owner, Nov 11, §377) The join itself, inside the transaction that holds the test's lock, once every check passed (joinTest's, or the press's one pass in
 * joining.ts): the contract (new, or the old one restored), the key, the "joined" line, the invites, and the test filling.
 */
export async function saveJoin(tx: Tx, t: Prisma.TestGetPayload<object>, tester: U, body: Record<string, unknown>, options: { quietJoinEvent?: boolean } = {}) {
  const testId = t.id;
  const dev = await tx.user.findUniqueOrThrow({ where: { id: t.developerId } });
  const old = await tx.contract.findUnique({ where: { testId_testerId: { testId, testerId: tester.id } } });
  const ndaAt = typeof body.ndaAcceptedAt === "string" && !isNaN(new Date(body.ndaAcceptedAt).getTime()) ? new Date(body.ndaAcceptedAt) : null;
  // (Batch 15 section 18) The tester's deadline: the day they join + the test's tester days (counted in the developer's time zone, like Open until).
  const snap = contractSnapshot({ ...asListing(t), listingVersion: t.listingVersion, testerDays: t.testerDays, tz: dev.timeZone }, new Date(), body.keepPrivate === true, ndaAt ?? new Date());
  // (Owner, Nov 6, §283) Coming back: on the listing's questions; if theirs still differ (an ended contract no Save reached), the change is a Terms history
  // entry first (followQuestions), so the old answered questions stay readable there.
  if (old) await followQuestions(tx, old, asListing(t).questions, new Date());
  // (Owner, Nov 6, §313c) Work sent before she left keeps the deadline it was sent under (the one in effect when she left): its review date, Charge and closing
  // date don't move with the rejoined stint's new deadline. Stamped once (a piece already stamped by an earlier rejoin keeps its own).
  if (old) {
    await tx.submission.updateMany({ where: { contractId: old.id, stintDueAt: null }, data: { stintDueAt: old.dueAt } });
    await tx.call.updateMany({ where: { contractId: old.id, stintDueAt: null }, data: { stintDueAt: old.dueAt } });
  }
  // (Owner, Nov 6, §312e) Rejoining accepts the listing as it is now, NDA included: the earlier stint's NDA change (and its unacknowledged notice, which blocked
  // every press and showed "… changed the NDA … Acknowledge" on the fresh page) does not carry over.
  if (old) await (await import("./accessKeys")).releaseTesterKeys(tx, old.id);
  const contract = old
    ? await tx.contract.update({ where: { id: old.id }, data: { ...snap, dueAt: rejoinDue(old.dueAt, old.endedAt, new Date(), dev.timeZone), status: "working", endKind: "", endedAt: null, endReason: "", termsSwitchedAt: null, ndaChangedAt: null, ndaChangeKind: "", ndaNoticeSeenAt: null } })
    : await tx.contract.create({ data: { testId, testerId: tester.id, ...snap } });
  await stampCounting(testId, tx); // (batch 35 §66) the 3-change count starts with the first join
  if (old) await tx.termsOffer.updateMany({ where: { contractId: old.id, status: "open" }, data: { status: "superseded", decidedAt: new Date() } });
  // (Owner, Nov 6, §311g) A rejoin is a fresh deadline: the earlier stint's deadline marks go, so the new deadline's latest passed mark is sent once (a "1d" sent
  // before she left no longer swallows the new one when she rejoins with under a day left).
  if (old) {
    const marks = (await tx.test.findUniqueOrThrow({ where: { id: testId }, select: { notifiedMarks: true } })).notifiedMarks;
    const kept = forgetDeadlineMarks(marks, old.id);
    if (kept.length !== marks.length) await tx.test.update({ where: { id: testId }, data: { notifiedMarks: kept } });
  }
  // (Design doc 5) Each joining tester gets an access key (the key they had, else the oldest free one). (Owner, Nov 6, §304) No "still works?" answer.
  await assignKeyAtJoin(tx, testId, contract.id);
  await recordEvent(tx, testId, options.quietJoinEvent === true ? "auto_joined" : "joined", old ? `${displayName(tester)} joined again` : `${displayName(tester)} joined`, true, {}, contract.id, "", testerRow(contract.id)); // (Owner, Nov 6, §284) the place the line opens: their row in Testers
  await tx.invite.updateMany({ where: { testId, testerId: tester.id, status: "sent" }, data: { status: "joined" } });
  // (Correction 4) The last spot taken: every other pending application and open invite closes, in this transaction.
  const filled = (await tx.contract.count({ where: working(testId) })) >= t.spots
    ? await closeOnFull(tx, testId, tester.id)
    : null;
  return { contract, dev, filled, title: t.title };
}

/** (Owner, Nov 11, §377) After a join's commit: the developer's "full" line, and their "joined" bell (not for their own Accept). */
export async function afterJoin(j: Joined, tester: U, testId: string, body: Record<string, unknown>) {
  const { contract, dev, filled, title } = j;
  if (filled) await tellFull(filled);
  // (Owner, Oct 27) The developer who accepted an application made it happen themselves: no second "joined" line for it (the "applied" line was the notice).
  if (body.acceptedByDeveloper !== true) await notify(dev.email, `${displayName(tester)} joined “${title}”`, [`${displayName(tester)} joined your test “${title}”.`, `${pronouns(tester.pronoun).Poss} deal: ${termsLine(contract)}.`], `/app/tests/${testId}#tester-${contract.id}`, { about: tester.id, testId }); // (Owner, Nov 6, §308) a plain per-test line: the test's own "Harbor Run · N updates" stack
}

// ---------- tester: session ----------

/** The tester's own contract, or a refusal. Nobody else's sessions can be read through this. */
export async function ownContract(testerId: string, contractId: string, /** (§375) false for a press made in one pass (it closes the work itself, under its lock) */ closeDue = true) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: { include: { developer: true } }, tester: true } });
  if (!c || c.testerId !== testerId) throw new HttpError(404, "not_found", "That session doesn't exist or isn't yours.");
  if (closeDue && (await (await import("./workWindow")).finishWorkIfDue(c.testId))) return db.contract.findUniqueOrThrow({ where: { id: contractId }, include: { test: { include: { developer: true } }, tester: true } });
  return c;
}

/**
 * Why a tester's press can't happen any more (with the one line their page shows), or "". Late work is allowed. (Batch 28 §3) A team Stop always reads with its time
 * ("This test was stopped at 3:10 PM."; the date added after 12 hours), in the reader's saved zone (`tz`, else the contract's tester's).
 */
export function sessionRefusal(c: { status: string; endKind: string; endedAt: Date | null; tester?: { timeZone?: string | null } | null }, test: { openUntil: Date | null }, devName: string, now = new Date(), tz?: string | null) {
  const zone = tz !== undefined ? tz : c.tester?.timeZone ?? null;
  return testerRefusal({ ...c, teamTime: c.endedAt ? stopTimeIn(c.endedAt, zone, now) : undefined }, test, devName, fmtDate, now);
}

export async function leaveTest(tester: U, contractId: string, body: Record<string, unknown> = {}) {
  const c0 = await ownContract(tester.id, contractId);
  // (Owner, Oct 31, batch 35 §59; replaces batch 15 §25 for Leave) Leave goes through the tester's one gate like their other presses: the first press stops once
  // for changes the page hasn't shown (Alerts Off: only contract changes; new terms send the page up to the offer box), the confirmed press leaves.
  // (Owner, Nov 11, §380; replaces §363 / §364's refusal here) Their part already ended (left, rated, ended early, stopped, blocked, the test closed): already
  // what Leave wanted, so no refusal and no stop: the page just redraws.
  if (sessionRefusal(c0, { openUntil: null }, displayName(c0.test.developer))) return { left: true, already: true };
  // (Owner, Nov 5, §268; replaces §232's open-terms stop) New terms follow the ordinary rule for Leave (Alerts on and not yet shown only); the NDA block never applies.
  await testerGate(tester.id, contractId, c0.testId, body, undefined, { ordinaryTerms: true });
  const c = await db.$transaction(async (tx) => {
    await lockTest(tx, c0.testId);
    const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId }, include: { test: { select: { title: true } } } });
    if (sessionRefusal(c, { openUntil: null }, displayName(c0.test.developer))) return null; // (§380) ended a moment ago: silent too
    await tx.contract.update({ where: { id: c.id }, data: { status: "left", endedAt: new Date() } });
    await (await import("./accessKeys")).releaseTesterKeys(tx, c.id);
    await cancelCallsAhead(tx, [c.id], `${displayName(tester)} left the test.`);
    await closeOffersOfEnded(tx, [c.id]); // (batch 35 §118) leaving ends the part: its open new-terms offer closes
    await tx.callRequest.updateMany({ where: { contractId: c.id, status: "pending" }, data: { status: "closed", closedReason: "the tester left", decidedAt: new Date() } });
    await recordEvent(tx, c.testId, "left", `${displayName(tester)} left the test`, true, {}, c.id, "", testerRow(c.id)); // (Owner, Nov 6, §284) the place the line opens
    return c;
  });
  if (!c) return { left: true, already: true };
  await notify(c0.test.developer.email, `${displayName(tester)} left “${c.test.title}”`, [`${displayName(tester)} left your test “${c.test.title}”. Work ${pronouns(tester.pronoun).subj} already sent still waits for your review.`], `/app/tests/${c.testId}#tester-${c.id}`, { about: tester.id, testId: c.testId }); // (Owner, Nov 6, §308) a plain per-test line: the test's own "Harbor Run · N updates" stack
  await spotOpened(c.testId);
  return { left: true };
}

/*
 * (Owner, Nov 11, §375) ONE PASS under the test's lock for a tester's Send Answers, Add to this answer and a recording's Send / Add: no check before the lock and
 * none repeated after it, so the result can never depend on timing (a Save, a pause, a Leave, a block or another tab's press is either fully before the pass
 * or fully after it). In this order, inside one transaction:
 *   1. save the drafts (only does anything for an out-of-date page), even when the part turns out to be over (harmless);
 *   2. part over (left, rated, blocked, stopped, ended early, the test closed: the work is closed here if it is due) → refusal;
 *   3a. the part's final refusals (closed at $0, rejected, already sent …);
 *   3b. the soft refusals: paused → an NDA change → new terms → an upload still running;
 *   4. the questions changed since the page → the §269 stop-once box (always, whatever the Alerts);
 *   5. the form's mistakes (red 400s);
 *   6. the tester's stop-once gate → box;
 *   7. the save (with its own-action line).
 * Steps 2 to 6 never throw inside the transaction (that would undo the drafts): the pass ends normally with what stopped it, thrown after the commit.
 */

type SentPart = Prisma.SubmissionGetPayload<{ include: { review: true } }>;
type Closed = Awaited<ReturnType<typeof import("./workWindow").closeWorkIfDueIn>>;
/** What one pass ended with: what stopped it (a refusal or a box), or what it saved. `closed`: the work it closed (step 2), told after the commit. */
export type Pass<T> = { stop: HttpError } | { saved: T };
type Run = { closed: Closed };

/**
 * (§375) The pass itself: the test-only pause point (RACE_HOLDS=1) and the test hook just before the lock, the lock, the steps; after the commit the closure's
 * bells (if step 2 closed the work), then what stopped the press is thrown, or what it saved is returned.
 */
export async function onePass<T>(testId: string, hook: string, body: Record<string, unknown>, steps: (tx: Tx, run: Run) => Promise<Pass<T>>): Promise<T> {
  await beforeLock(hook);
  await (await import("./raceHold")).raceHold(body);
  const run: Run = { closed: null };
  const out = await db.$transaction(async (tx) => {
    await lockTest(tx, testId);
    return steps(tx, run);
  });
  if (run.closed) await (await import("./workWindow")).afterWorkClosed(testId, run.closed);
  if ("stop" in out) throw out.stop;
  return out.saved;
}

/** (§375) Ends a step inside the pass: a refusal or a box thrown by a check becomes the pass's result (anything else is a real error). */
export async function stopOf(check: () => Promise<unknown>) {
  try {
    await check();
    return null;
  } catch (e) {
    if (e instanceof HttpError) return e;
    throw e;
  }
}

/**
 * (§375) Step 2: their part is over, in the words and codes the session route always gave (it no longer checks these presses before the pass): a Stop, an
 * early end or the test's end "This test was stopped / ended, so your Send Answers didn't go through." (`work_over`: the page goes to its top); left, rated or
 * blocked "Your part in this test has ended, so …" (§363 / §364). The work is closed here first if it is due (closeWorkIfDueIn, under this same lock).
 */
export async function partOver(tx: Tx, contractId: string, press: string, run: Run) {
  const ww = await import("./workWindow");
  run.closed = await ww.closeWorkIfDueIn(tx, (await tx.contract.findUniqueOrThrow({ where: { id: contractId }, select: { testId: true } })).testId);
  const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
  if (workOver(c)) return new HttpError(409, "work_over", overPressLine(c, press), { failed: press, top: true });
  if (c.status !== "working") return new HttpError(409, "gone", overPressLine(c, press));
  return stopOf(() => ww.assertWorkOpen(tx, c.testId, new Date(), press)); // (§364 item 2) "This test ended, so your … didn't go through."
}

/** (§375) Step 3b: paused → an NDA change not acknowledged → new terms not answered → `uploading` (an upload of this part still running). */
export async function softRefusals(tx: Tx, c: { id: string; test: { adminPausedAt: Date | null; workEndedAt: Date | null; pauseClosedAt: Date | null; developer: { holdStartedAt: Date | null; devSuspendedAt: Date | null } } }, press: string, uploading: () => Promise<HttpError | null>) {
  // (Owner, Oct 28 afternoon; §364 item 5) No sending while the test is paused (what was typed stays kept as a draft).
  if (testerPaused(c.test.developer, c.test)) return new HttpError(409, "paused", RF.pressRefused(RF.PAUSED_CAUSE, press));
  // (§267 / §302) "Acknowledge the NDA change first.", then (batch 27 §1) "Answer the new terms first: Switch or Keep."
  return (await stopOf(() => answerTermsFirst(c.id, tx))) ?? uploading();
}

/** (§375) The part sent so far (the written answers, or the recording) with its review, or null. */
export const sentPart = (tx: Tx, contractId: string, kind: "written" | "recording" = "written") =>
  tx.submission.findUnique({ where: { contractId_kind: { contractId, kind } }, include: { review: true } });

/** (§375) The contract as the pass reads it, with its test and developer. */
export const contractIn = (tx: Tx, contractId: string) => tx.contract.findUniqueOrThrow({ where: { id: contractId }, include: { test: { include: { developer: true } } } });

// ---------- Send Answers ----------

/** (§375) What a Send Answers page sent: the contract's questions now, the page's own (`for`, every page since §269), what it typed for each (by the words). */
function writtenPage(c: { questions: unknown }, body: Record<string, unknown>) {
  const sentAnswers = Array.isArray(body.answers) ? body.answers.map((a) => (typeof a === "string" ? a.trim() : "")) : [];
  const forQs = Array.isArray(body.for) ? body.for.filter((q): q is string => typeof q === "string") : null;
  const rawNotes = typeof body.notes === "string" ? body.notes : "";
  return { qs: writtenQuestions(c), forQs, sentAnswers, typed: new Map((forQs ?? []).map((q, i) => [qText(q), sentAnswers[i] ?? ""])), rawNotes, notes: rawNotes.trim(), body };
}
type WrittenPage = ReturnType<typeof writtenPage>;

/**
 * (§375) The answers this press sends, one per current question, against the part as it is (`part`). (Batch 20 §28) By place on a page without `for`.
 * (Owner, Nov 5, §235) Once answers were sent, the form below them holds only the current questions with no answer yet (`fresh`: their places); every
 * answered question keeps exactly what it has (carriedAnswers), whatever the page sent for it. (§269) A page that says its questions is read by their words.
 */
function answersFor(part: SentPart | null, page: WrittenPage) {
  const { qs, forQs, typed, sentAnswers } = page;
  const carried = forQs && part ? carriedAnswers(part, qs) : null;
  const answers = carried ? qs.map((q, i) => carried[i] ?? typed.get(qText(q)) ?? "") : forQs ? qs.map((q) => typed.get(qText(q)) ?? "") : qs.map((_, i) => sentAnswers[i] ?? "");
  const fresh = carried ? qs.flatMap((_, i) => (carried[i] == null ? [i] : [])) : null;
  return { carried, answers, fresh, answersNew: !!fresh?.some((i) => answers[i].trim()) };
}

/**
 * (Owner, Nov 5, §269) A page whose form holds questions the contract no longer has (or lacks one it has now) never sends: what changed (`lines`) and the
 * form's questions now (`formQs`), or null when the page's questions are the contract's. A question it holds is gone: always. One it lacks: when a change since
 * the page loaded added it (an older page's own form is refused as before).
 */
async function staleQuestions(testId: string, dev: string, page: WrittenPage, part: SentPart | null) {
  const { qs, forQs, body } = page;
  if (!forQs) return null;
  const { carried } = answersFor(part, page);
  const formQs = carried ? qs.filter((_, i) => carried[i] == null) : qs;
  const nowWords = new Set(qs.map(qText)), asked = new Set(forQs.map(qText));
  const gone = forQs.some((q) => !nowWords.has(qText(q))), lacks = formQs.some((q) => !asked.has(qText(q)));
  const lines = gone || lacks ? await questionChangeLines(testId, seenOf(body.pageSeenAt) ?? seenOf(body.seenAt), dev) : [];
  if (!gone && !(lacks && lines.length)) return null;
  // No record since the page (it loaded without a time): what its form differs by (never an answered question it still shows).
  const formWords = new Set(formQs.map(qText));
  const stale: TestEventLike[] = lines.length ? lines : questionChangeTexts(dev, forQs.filter((q) => !nowWords.has(qText(q)) || formWords.has(qText(q))), formQs).map((text) => ({ kind: "info", text, createdAt: new Date(), listing: true, keys: ["questions"] }));
  return { formQs, lines: stale };
}

/**
 * (Owner, Nov 10, §369; Nov 11, §375) Step 1 for Send Answers: what an out-of-date page typed is never lost. Text typed into a question answered meanwhile
 * (another tab's Send) goes into that question's "Add to this answer" draft; a page whose questions changed (`stale`) keeps the rest (keepStaleTyped: an
 * unanswered question's text in the form's draft, a removed or reworded question's in its Terms history entry's "Draft (not sent)").
 */
async function keepTyped(tx: Tx, testerId: string, c: { id: string }, page: WrittenPage, part: SentPart | null, stale: { formQs: string[] } | null) {
  if (!page.forQs) return;
  const inAddDrafts = part ? await keepTypedForAnswered(testerId, c.id, part, page.qs, page.typed) : new Set<string>();
  if (stale) await keepStaleTyped(tx, testerId, c.id, page.forQs, page.sentAnswers, stale.formQs, part ? "" : page.rawNotes, inAddDrafts);
}

/**
 * (§369) Text a page typed into a question already answered (by another tab) is kept as that question's "Add to this answer" draft, never lost (not text the
 * same as what was sent). (Owner, Nov 11, §376; replaces §375's appending) The most recent text replaces an Add draft already kept. Returns the questions (by their
 * words) whose text is safe there, so keepStaleTyped skips them.
 */
async function keepTypedForAnswered(testerId: string, contractId: string, sub: { answers: unknown; additions?: unknown }, qs: string[], typed: Map<string, string>) {
  const carried = carriedAnswers(sub, qs);
  const keys = questionKeys(itemsFor(qs));
  const safe = new Set<string>();
  for (const [i, q] of qs.entries()) {
    const t = typed.get(qText(q))?.trim();
    if (carried[i] == null || !t) continue;
    // The same as what was sent: nothing to keep.
    if (t === carried[i]!.trim()) {
      safe.add(qText(q));
      continue;
    }
    // (Owner, Nov 11, §376; reverses §375's appending) The most recent text REPLACES an Add draft already kept (no appending, no blank-line stacking; the same
    // text again changes nothing), as Terms history's "Draft (not sent)" keeps only the most recent. The Add draft is the only place it lives (keepStaleTyped skips it).
    await setKept(testerId, `add:${contractId}:${keys[i]}`, { text: t });
    safe.add(qText(q));
  }
  return safe;
}

/**
 * (Owner, Nov 5, §269) A stale page's Send never loses what was typed. A current question's text goes into the written draft (by its words, so the boxes have it
 * after the redraw); a removed question's text goes into the draft snapshot ("Draft (not sent)") of the Terms history entry that removed it, so it shows there
 * and comes back into the form if the question comes back (§263). `notes`: the first form's notes box (kept in the draft too). (Owner, Nov 11, §375) Not a
 * question whose text is safe in its "Add to this answer" draft (`inAddDrafts`, keepTypedForAnswered): it isn't written into the form's draft as well. Inside
 * the press's pass (`tx` holds the test's lock).
 */
async function keepStaleTyped(tx: Tx, testerId: string, contractId: string, forQs: string[], typed: string[], formQs: string[], notes: string, inAddDrafts = new Set<string>()) {
  const units: Record<string, string> = {};
  const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId }, select: { questions: true, prevSets: true } });
  const now = new Set(writtenQuestions(c).map(qText));
  const removed: { q: string; text: string }[] = [];
  forQs.forEach((q, i) => {
    const text = typed[i] ?? "";
    if (!text.trim() || inAddDrafts.has(qText(q))) return;
    if (now.has(qText(q))) units[answerUnit(q)] = text;
    else removed.push({ q: qText(q), text });
  });
  // The newest entry that asked the question and changed it away holds its snapshot.
  const sets = prevSetsOf(c.prevSets);
  const newest = [...sets].sort((a, b) => new Date(b.until).getTime() - new Date(a.until).getTime());
  let changed = false;
  for (const r of removed) {
    const p = newest.find((x) => x.items.some((it) => qText(it.question) === r.q) && !(x.to ?? []).some((t) => qText(t) === r.q));
    if (!p) continue;
    const draft = p.versions?.find((v) => v.kind === "draft");
    if (draft) draft.items = draft.items.map((it) => (qText(it.question) === r.q ? { ...it, answer: r.text } : it));
    else p.versions = [...(p.versions ?? []), { kind: "draft", at: new Date().toISOString(), items: p.items.map((it) => (qText(it.question) === r.q ? { ...it, answer: r.text } : it)) }];
    changed = true;
  }
  if (changed) await tx.contract.update({ where: { id: contractId }, data: { prevSets: sets as unknown as Prisma.InputJsonValue } });
  if (notes.trim()) units[NOTES_UNIT] = notes;
  if (Object.keys(units).length) await patchKept(testerId, `written:${contractId}`, units, { questions: formQs });
}

/**
 * Step 3a for Send Answers: what refuses it for good. `openLeft` (Owner, Nov 11, §375): a current question still has no answer, so the form below can still
 * send one: never "already sent" then (the form's own check asks for an answer).
 */
function sendRefusal(existing: SentPart | null, qs: string[], answers: string[], answersNew = false, openLeft = false) {
  // (Batch 30 §2) Only an old rejection or the team's $0 closure stays locked against anything more.
  const locked = resendRefusal(existing?.review, "written");
  if (locked) return new HttpError(409, "paid", locked);
  // (Owner, Nov 3, batch 35 §136; replaces batch 13 §8's "sending replaces the sent version" and batch 20 §26's updated answers) What was sent is locked: a
  // second Send is only for the answers to changed questions (after a switch), and those are ADDED under what was sent ("Added"), never in its place.
  // (Owner, Nov 5, §235) Or the first answers to current questions that had none (the form below the answers): added the same way, the answered ones unchanged.
  if (existing && !existing.setUntil && !answersNew && !openLeft && sameQuestions(latestItems(existing, qs), itemsFor(qs, answers))) return new HttpError(409, "locked", SENT_ANSWERS_LOCKED);
  return null;
}

/** (§375) Step 3b's last check for written answers: an upload still running (or a page whose text still holds an "[Uploading …]" marker). */
async function writtenUploading(tx: Tx, contractId: string, text: unknown) {
  if ((await tx.recording.count({ where: { contractId, ...(await import("./recordings")).stillUploading("written") } })) || JSON.stringify(text).includes("[Uploading ")) return new HttpError(409, "uploading", "Wait for the upload to finish before sending.");
  return null;
}

/**
 * (§375) Step 5 for Send Answers: the form's own mistakes, red at the question. (Batch 26 §14) At least one question answered, plus every Required one (the
 * notes box alone doesn't count); the refusal names which question (`missing`), so the page marks it red there. (Batch 30 §14) Each answer given is at least
 * 50 characters (answerMin). (§235) Only the form's own questions are checked (an answer sent before stays as it is), and `missing` is their place in the page's
 * form (§269); after a switch to changed questions the Send needs no new answer (it moves the part to the current questions). (Owner, Oct 29, batch 11) A
 * length limit for the whole written part (WRITTEN_MAX_CHARS in rules.ts: 20,000 characters; §372 comment fix) (all its answers and notes together).
 */
function formMistakes(page: WrittenPage, part: SentPart | null) {
  const { qs, forQs } = page;
  const { answers, fresh } = answersFor(part, page);
  const switched = !!part && (!!part.setUntil || !sameQuestions(latestItems(part, qs), itemsFor(qs)));
  const missing0 = fresh ? answersMissing(fresh.map((i) => qs[i]), fresh.map((i) => answers[i]), answerMin()) : answersMissing(qs, answers, answerMin());
  const missing = fresh && missing0 ? (missing0.message === ANSWER_ONE && switched ? null : { ...missing0, at: Math.max(0, (forQs ?? []).findIndex((q) => qText(q) === qText(qs[fresh[missing0.at] ?? 0]))) })
    : forQs && missing0 ? { ...missing0, at: Math.max(0, forQs.findIndex((q) => qText(q) === qText(qs[missing0.at] ?? ""))) } /* (§269) its place in the page's form */ : missing0;
  if (missing) return new HttpError(400, "bad_answers", missing.message, { missing: missing.at, ...(missing.chars != null ? { chars: missing.chars } : {}) });
  const long = checkWrittenLength([...answers, page.notes]);
  return long.ok ? null : new HttpError(400, "too_long", long.message);
}

/**
 * Send (or update, until it's paid) the written answers: one answer per question in the contract. Allowed even when
 * written answers aren't in the contract and after the deadline (shown as sent late). (Owner, Nov 11, §375) In one pass under the test's lock, in this order:
 */
export async function sendWritten(tester: U, contractId: string, body: Record<string, unknown>) {
  const c0 = await ownContract(tester.id, contractId, false);
  const press = "Send Answers";
  const done = await onePass(c0.testId, "written", body, async (tx, run): Promise<Pass<Awaited<ReturnType<typeof saveWritten>>>> => {
    const c = await contractIn(tx, contractId);
    const page = writtenPage(c, body); // what the page sent: its questions and what it typed for each
    const sent = await sentPart(tx, contractId); // the part sent so far (or none)
    // 1. The drafts: what an out-of-date page typed is kept (a question answered meanwhile → its Add draft; removed or reworded → its Terms history draft).
    const stale = await staleQuestions(c.testId, displayName(c.test.developer), page, sent);
    await keepTyped(tx, tester.id, c, page, sent, stale);
    // 2. Their part is over, or the test closed.
    const over = await partOver(tx, contractId, press, run);
    if (over) return { stop: over };
    // 3a. Refused for good: rejected, the team's $0 closure, already sent.
    const { answers, fresh, answersNew } = answersFor(sent, page);
    const final = sendRefusal(sent, page.qs, answers, answersNew, !!fresh?.length);
    if (final) return { stop: final };
    // 3b. Paused → an NDA change → new terms → an upload still running.
    const soft = await softRefusals(tx, c, press, () => writtenUploading(tx, contractId, [body.answers, body.notes]));
    if (soft) return { stop: soft };
    // 4. (§269) The page's questions changed: the stop-once box, whatever the Alerts, a confirmed press or what the live pill showed; the page then takes the
    // new questions in place, and the next press sends normally.
    const questionsBox = stale ? await testerSendGate(tx, contractId, body, sent?.id, { stale: stale.lines }) : null;
    if (questionsBox) return { stop: questionsBox };
    // 5. The form's own mistakes, red at the question (Required, 50 characters, 20,000 in all).
    const mistake = formMistakes(page, sent);
    if (mistake) return { stop: mistake };
    // 6. The tester's one gate: the stop-once box for what the page hasn't shown ((Owner, Nov 4, §183) a developer payment on sent answers since the page
    // loaded, whatever the Alerts; another tab's Send: "You sent your written answers in another tab").
    const box = await testerSendGate(tx, contractId, body, sent?.id, { stale: [] });
    if (box) return { stop: box };
    // 7. The save.
    return { saved: await saveWritten(tx, tester, contractId, sent, page, body) };
  });
  await tellSentByBell(c0, tester, done.sub, "written answers", done.updated, done.afterPaid);
  return done.sub;
}

/** (§375) Step 7 for Send Answers: the first answers, or the answers added under what was sent. */
async function saveWritten(tx: Tx, tester: U, contractId: string, existing: SentPart | null, page: WrittenPage, body: Record<string, unknown>) {
  const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
  const { qs, notes } = page;
  const { answers } = answersFor(existing, page);
  const now = new Date();
  const paid = !!existing?.review;
  const items = itemsFor(qs, answers);
  // Additions preserve an existing piece's status; before the deadline they adopt the agreed price.
  const addition = additionTerms(existing, c, c.writtenCents, now);
  const late = addition.late;
  // (Owner, Nov 6, §283) Only unsent uploads (never one already sent), and not one that went with a draft into Terms history (snapshotOnlyFiles).
  const unsentFiles = await tx.recording.findMany({ where: { contractId, part: "written", uploadedAt: { not: null }, submissionId: null }, select: { id: true, filename: true } });
  const snapped = snapshotOnlyFiles(c.prevSets, unsentFiles, [...answers, notes]);
  const files = unsentFiles.filter((f) => !snapped.has(f.id));
  const sub = existing
    ? await tx.submission.update({ where: { id: existing.id }, data: {
        // The shared addition rule decides whether this unpaid piece can adopt current terms.
        additions: [...additionsOf(existing.additions), { at: now.toISOString(), items, notes: notes !== existing.notes ? notes : "", files: files.map((f) => f.id) }] as unknown as Prisma.InputJsonValue,
        setUntil: null, updatedAt: now,
        ...addition,
      } })
    : await tx.submission.create({ data: { contractId, kind: "written", agreedCents: c.writtenCents, answers: items as unknown as Prisma.InputJsonValue, notes, late, updatedAt: now, payBy: payByFrom(now), ...(late ? { choiceOfferedAt: null, choiceBy: null } : {}) } });
  // (Batch 11) Files and recordings attached to the written part go with it.
  await tx.recording.updateMany({ where: { id: { in: files.map((f) => f.id) } }, data: { submissionId: sub.id } });
  const afterPaid = await tellSent(tx, { testId: c.testId, contractId: c.id, subId: sub.id, name: displayName(tester), poss: pronouns(tester.pronoun).poss, part: "written answers", added: !!existing, paid });
  // (§369 NEW-C) The own-action line commits with the save: another tab that sees these answers also sees "You sent your written answers in another tab".
  await (await import("./live")).logAction(tester.id, c.testId, body, writtenOwnText(!!existing), undefined, tx);
  return { sub, updated: !!existing, afterPaid };
}

// ---------- Add to this answer ----------

/** (Owner, Nov 5, §265) A current question with no answer yet (nothing sent for it by its words, nothing added): its first answer is free (§222). */
const unansweredNow = (sub: { answers: unknown; additions?: unknown }, qs: string[], key: string) => {
  const i = questionKeys(itemsFor(qs)).indexOf(key);
  return key !== ANYTHING_ELSE_KEY && i >= 0 && carriedAnswers(sub, qs)[i] == null;
};

/** (§269) A question's key without a repeat's "-2" (questionKeys numbers a repeated question). */
const questionKeyOf = (key: string) => key.replace(/-\d+$/, "");

/** Step 3a for Add to this answer: what refuses it for good ((Owner, Nov 4, §183) never a stop whose second press could only be refused). */
function addRefusal(existing: SentPart | null, c: { questions: unknown }, key: string) {
  if (!existing) return new HttpError(409, "not_sent", "Send your answers first.");
  const locked = resendRefusal(existing.review, "written");
  if (locked) return new HttpError(409, "paid", locked);
  const qs = writtenQuestions(c);
  // (Owner, Nov 5, §265) The questions follow the listing, so an answered current question is added to straight away, by its words, whatever set it was sent
  // in. (Owner, Nov 11, §375) One no longer asked is the questions box (goneQuestionLines, step 4), never this refusal.
  // (Owner, Nov 5, §222; replaces §167's 10 per part) This question's 5 (Anything else's own 5). A question with no answer yet: its first answer (Answer this
  // question) is free and never refused for it.
  if (!unansweredNow(existing, qs, key) && addsCounted(existing.additions, key) >= ADDITIONS_MAX) return new HttpError(409, "add_full", additionsFull(key));
  return null;
}

/** (§375) What an Add to this answer page sent: the question it adds to (its key, questionKeys of the current questions) and the text. */
const addPage = (body: Record<string, unknown>) => ({ key: typeof body.question === "string" ? body.question : "", text: typeof body.text === "string" ? body.text.trim() : "" });
/** (§167) Only the uploads placed in this text (by their markers) go with it. */
const placedIn = (text: string, rows: { id: string; filename: string }[]) => {
  const ids = markerIds(text, rows);
  return rows.filter((r) => ids.has(r.id));
};
const unsentWritten = (contractId: string) => ({ contractId, part: "written", uploadedAt: { not: null }, submissionId: null });

/**
 * (Owner, Nov 11, §375; replaces §269's "once, then QUESTION_GONE" for Add) The question this Add is for is no longer asked: the lines the questions box lists,
 * exactly like Send's stale questions: every questions change since the page loaded, else (the change came before it) the line for that question
 * (questionChangeTexts, as Send's fallback). null: the question is still asked (or it is Anything else). An empty list: a key that was never a question (an
 * old or broken page), refused with QUESTION_GONE.
 */
async function goneQuestionLines(c: { testId: string; questions: unknown; prevSets: unknown; test: { developer: Parameters<typeof displayName>[0] } }, sent: SentPart | null, key: string, body: Record<string, unknown>): Promise<TestEventLike[] | null> {
  const qs = writtenQuestions(c);
  if (key === ANYTHING_ELSE_KEY || questionKeys(itemsFor(qs)).includes(key)) return null;
  const dev = displayName(c.test.developer);
  const lines = await questionChangeLines(c.testId, seenOf(body.pageSeenAt) ?? seenOf(body.seenAt), dev);
  if (lines.length) return lines;
  // Its words: from Terms history, else from what was sent (a set it was answered in).
  const sentSets = sent ? [itemsOf(sent.answers), ...additionsOf(sent.additions).map((a) => a.items ?? [])] : [];
  const old = [...prevSetsOf(c.prevSets).map((p) => p.items), ...sentSets].flat().map((it) => it.question).find((q) => questionKey(q) === questionKeyOf(key));
  return old ? questionChangeTexts(dev, [old], []).map((text) => ({ kind: "info", text, createdAt: new Date(), listing: true, keys: ["questions"] })) : [];
}

/**
 * (§375) Step 5 for Add: the text's own mistakes (400s). (Batch 35 §136) Nothing to add. (Owner, Nov 4, §186; replaces batch 14's one limit over the answers,
 * the notes and everything added) An addition has the same limit as the answers sent first: at most 20,000 characters of its own, whatever the others hold;
 * (batch 30 §14) and at least 50 characters.
 */
async function addMistakes(tx: Tx, contractId: string, text: string) {
  if (!withoutAttachmentMarkers(text).trim() && !placedIn(text, await tx.recording.findMany({ where: unsentWritten(contractId), select: { id: true, filename: true } })).length) return new HttpError(400, "empty", NOTHING_TO_ADD);
  const long = checkAdditionLength(text);
  if (!long.ok) return new HttpError(400, "too_long", long.message);
  const chars = answerChars(text);
  return chars < answerMin() ? new HttpError(400, "too_short", answerShortLine(chars)) : null;
}

/**
 * (Owner, Nov 3, batch 35 §136) Adding to sent written answers: more text (with files placed in it) is added under what was sent. Nothing sent before changes. The
 * same windows as Send (not after the work ends, not while the test is paused, not while an offer of new terms is open) and the same stop-once. Payments and
 * reviews already made stay as they are; after a Pay, Pay more can pay for it (batch 30 §2's update row).
 * (Owner, Nov 3, §167; replaces §136's one "Add more" for the whole part) Each addition is to ONE question (`question`: its key, questionKeys of the current
 * questions), and the developer is told which ("Ana added to her answer to “…”"). An older page's general Add more (no question) is refused (ADD_UNDER_QUESTION).
 * Only the files placed in this text go with it (another question's box may hold the others). (Owner, Nov 5, §222; replaces §167's 10 per part) At most 5
 * additions per question (ADDITIONS_MAX, `addsCounted`: only Add to this answer's own, not the answers to changed questions), counted in the one pass, so
 * two adds at a question's 5th give exactly one. A question with no answer yet (`noAnswerYet`) takes its first answer ("Answer this question") free, stored with
 * `first`, even past any cap; then the normal 5.
 * (Owner, Nov 4, §188) Or to Anything else (`question: "else"`, ANYTHING_ELSE_KEY), the fixed last spot after the questions: the same rules (its own 5, the 20,000,
 * the stop-once, the single refusals), named "added to “Anything else” in her written answers". (Owner, Nov 11, §375) In one pass under the test's lock:
 */
export async function addWritten(tester: U, contractId: string, body: Record<string, unknown>) {
  const c0 = await ownContract(tester.id, contractId, false);
  const { key, text } = addPage(body);
  // (§167) An older page's general Add more (no question) is refused.
  if (!key) throw new HttpError(409, "pick_question", ADD_UNDER_QUESTION);
  const press = "Add";
  const done = await onePass(c0.testId, "written-add", body, async (tx, run): Promise<Pass<Awaited<ReturnType<typeof saveAddition>>>> => {
    const c = await contractIn(tx, contractId);
    const before = await sentPart(tx, contractId); // the answers sent so far (or none)
    // 1. The draft: its question is no longer asked → the typed text stays kept under it (it comes back if the question does).
    const gone = await goneQuestionLines(c, before, key, body);
    if (gone && text) await setKept(tester.id, `add:${contractId}:${key}`, { text });
    // 2. Their part is over, or the test closed.
    const over = await partOver(tx, contractId, press, run);
    if (over) return { stop: over };
    // 3a. Refused for good: not sent yet, rejected or the team's $0 closure, the question's 5 additions; a key that was never a question (QUESTION_GONE).
    const final = addRefusal(before, c, key) ?? (gone && !gone.length ? new HttpError(409, "question_gone", QUESTION_GONE) : null);
    if (final) return { stop: final };
    // 3b. Paused → an NDA change → new terms → an upload still running.
    const soft = await softRefusals(tx, c, press, () => writtenUploading(tx, contractId, text));
    if (soft) return { stop: soft };
    // 4. (§269; §375) Its question is no longer asked: the questions box every time (whatever the Alerts, a confirmed press or a box that listed it), and the
    // page redraws without it (`questions`); never saved.
    if (gone) return { stop: (await testerSendGate(tx, contractId, body, before?.id, { stale: gone }))! };
    // 5. The text's own mistakes: nothing to add, too long, too short.
    const mistake = await addMistakes(tx, contractId, text);
    if (mistake) return { stop: mistake };
    // 6. The tester's one gate ((Owner, Nov 4, §183) a developer payment on these answers since the page loaded, whatever the Alerts; another tab's Add).
    const box = await testerSendGate(tx, contractId, body, before?.id, { stale: [] });
    if (box) return { stop: box };
    // 7. The save.
    return { saved: await saveAddition(tx, tester, contractId, before!, key, text, body) };
  });
  await tellSentByBell(c0, tester, done.sub, "written answers", true, done.afterPaid, 1, done.question);
  return done.sub;
}

/** (§375) Step 7 for Add to this answer. */
async function saveAddition(tx: Tx, tester: U, contractId: string, existing: SentPart, key: string, text: string, body: Record<string, unknown>) {
  const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
  // (Owner, Nov 5, §265) The contract's questions now (they follow the listing), not the set last sent.
  const qs = writtenQuestions(c);
  const at = questionKeys(itemsFor(qs)).indexOf(key);
  const made = additionsOf(existing.additions);
  // (§222) The first answer to a question that had none: stored with `first`, so it isn't one of the question's 5.
  const first = unansweredNow(existing, qs, key);
  const now = new Date();
  // (Owner, Nov 3, races) A Pay in flight (reserved, its review not recorded yet) reads as unpaid here; recordReviewDraft marks this addition as one after the
  // payment once that Pay is recorded.
  const paid = !!existing.review;
  const addition = additionTerms(existing, c, c.writtenCents, now);
  const fresh = placedIn(text, await tx.recording.findMany({ where: unsentWritten(contractId), select: { id: true, filename: true } }));
  const sub = await tx.submission.update({ where: { id: existing.id }, data: {
    additions: [...made, { at: now.toISOString(), text, files: fresh.map((f) => f.id), questionKey: key, ...(first ? { first: true } : {}) }] as unknown as Prisma.InputJsonValue,
    updatedAt: now,
    ...addition,
  } });
  await tx.recording.updateMany({ where: { id: { in: fresh.map((f) => f.id) } }, data: { submissionId: sub.id } });
  const question = key === ANYTHING_ELSE_KEY ? ANYTHING_ELSE_TITLE : qText(qs[at]);
  const afterPaid = await tellSent(tx, { testId: c.testId, contractId: c.id, subId: sub.id, name: displayName(tester), poss: pronouns(tester.pronoun).poss, part: "written answers", added: true, paid, question });
  await (await import("./live")).logAction(tester.id, c.testId, body, addOwnText(c.questions, key), undefined, tx); // (§369) with the save
  return { sub, afterPaid, question };
}

/** (Batch 35 §136) The developer's live line for a send or an addition (after a Pay: below the cap a stop-once "sent" line, at the cap a quiet one). */
export async function tellSent(tx: Tx, p: { testId: string; contractId: string; subId: string; name: string; poss: string; part: "written answers" | "recording"; added: boolean; paid: boolean; n?: number; /** (§167) the question added to */ question?: string }) {
  const afterPaid = p.paid ? await paidUpdateRoom(tx, p.subId) : null;
  const text = afterPaid ? (afterPaid.atCap ? updatedAtCapLive : updatedAfterPaidLive)(p.name, p.poss, p.part, p.n, p.question) : p.added ? `${p.name} ${addedWhat(p.poss, p.part, p.n, p.question)}` : `${p.name} sent ${p.poss} ${p.part}`;
  await recordEvent(tx, p.testId, afterPaid?.atCap ? "sentpaid" : "sent", text, false, {}, p.contractId, "", `part-${p.subId}`);
  return afterPaid;
}

/** (Batch 35 §136) The bells for a send or an addition: "Work sent" to the tester; to the developer "Ana sent / added to …" (after a Pay, the update row's line). */
export async function tellSentByBell(
  c0: { id: string; testId: string; title: string; test: { title: string; developer: { email: string; name: string; deletedAt: Date | null } } },
  tester: U, sub: { id: string; late: boolean }, part: "written answers" | "recording", added: boolean, afterPaid: { atCap: boolean; paidCents: number; roomCents: number } | null, n = 1,
  /** (§167) the question added to */ question?: string,
) {
  const name = displayName(tester), poss = pronouns(tester.pronoun).poss, dev = displayName(c0.test.developer);
  const anchor = part === "recording" ? "part-recording" : "part-written";
  // (Owner, Nov 6, §295) An addition doesn't read as a second send: "You added to your answer to “…” on “Harbor Run”" (Anything else: "You added to your notes on
  // …"). (Owner, Nov 6, §312d) A first send rings nothing for the tester any more (it was "Work sent: your written answers for …"); the addition's line is asked
  // about: removing it is this one line.
  if (added) await notify(tester.email, youAddedLine(c0.test.title, part, n, question), [`What you added ${part === "recording" ? `to your ${part}` : addedToWhat("your", question)} was sent to ${dev}.`], `/app/sessions/${c0.id}#${anchor}`);
  if (afterPaid) return notifyPaidUpdate(c0, tester, sub.id, part, afterPaid, n, question);
  const title = added ? `${name} ${addedWhat(poss, part, n, question)} for “${c0.test.title}”` : `${name} sent ${part === "recording" ? "a recording" : part} for “${c0.test.title}”`;
  const what = added ? addedWhat(poss, part, n, question) : `sent ${poss} ${part === "recording" ? "screen recording" : part}`;
  await notify(c0.test.developer.email, title, [`${name} ${what}${sub.late ? " (late)" : ""}. ${part === "recording" ? "Watch it" : "Review them"} and choose what to pay.`], `/app/tests/${c0.testId}#piece-${sub.id}`, { about: tester.id });
}

export const eventLine = (e: { text: string; createdAt: Date }) => `${e.text} · ${fmtDateTime(e.createdAt)}`;

/** (Batch 15 section 32) The developer's time zone for counting Open until's days: the one the press sent, else the account's. */
export function tzOf(body: Record<string, unknown>, dev: { timeZone?: string | null }) {
  const sent = typeof body.timeZone === "string" ? body.timeZone : "";
  return sent && safeZone(sent) === sent ? sent : dev.timeZone ?? "";
}

/**
 * (Owner, Oct 30, batch 15 section 18) Open until passed: the test is closed to everyone who hasn't joined. Pending applications and open invites close (as when it
 * fills up), and each person is told once. Working testers carry on until their own deadlines. Run by the daily job (and safe to run again).
 */
export async function closeJoiningAfterOpenUntil(now = new Date()) {
  const tests = await db.test.findMany({
    // (Owner, Nov 9, §366) Not on a paused test: its Open until moves on by the pause when it lifts, and what waits keeps waiting.
    where: { status: "open", openUntil: { lt: now }, adminPausedAt: null, developer: { holdStartedAt: null, devSuspendedAt: null }, OR: [{ invites: { some: { status: "sent" } } }, { id: { in: (await db.application.findMany({ where: { status: "pending" }, select: { testId: true }, distinct: ["testId"] })).map((a) => a.testId) } }] },
    include: { developer: true },
  });
  let n = 0;
  for (const t of tests) {
    const apps = await db.application.findMany({ where: { testId: t.id, status: "pending" } });
    const invs = await db.invite.findMany({ where: { testId: t.id, status: "sent" } });
    await db.application.updateMany({ where: { id: { in: apps.map((a) => a.id) } }, data: { status: "closed", closedReason: "joining_closed", decidedAt: now } });
    await db.invite.updateMany({ where: { id: { in: invs.map((i) => i.id) } }, data: { status: "cancelled" } });
    const people = await db.user.findMany({ where: { id: { in: [...apps.map((a) => a.testerId), ...invs.map((i) => i.testerId)] } }, select: { id: true, email: true } });
    // (Batch 30 §6) It stacks across tests in "Applications and invites": the line names its test.
    const line = testClosedToNewLine(t.title, t.openUntil!, (d) => T(d, "date"));
    for (const p of people) await notify(p.email, line, [line], `/app/find/${t.id}`, { ...APPS_GROUP, testId: t.id });
    n += apps.length + invs.length;
  }
  return n;
}
