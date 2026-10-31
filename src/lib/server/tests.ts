import { devPauseSince, devStopSince, loadedOf } from "./stopMoment";
import { replaceLine, takesTheirs } from "@/lib/editMerge";
import { FIELD_NAMES, INFO_FIELDS, saveText } from "@/lib/listingSave";
import { CALL_ACTS, PAY_ACTS, devChanges, logEvent, ownChanges, seenOf, tabOf, withRenamed, type Press } from "./live";
import { NOT_REQUIRED, answerMin, answersMissing } from "@/lib/questions";
import { itemsFor, itemsOf, prevSetsOf, pushPrev, sameQuestions } from "@/lib/answerSets";
import { countersOf, countingSince, countsAfter, countsOf, criticalLine, lockedFields, storedCounts } from "@/lib/limits";
import { alertOf } from "@/lib/alerts";
import { KEY_GIVEN, applyKeyChange, assignKeyAtJoin, checkTypedKeys, giveKeysToWorking, planKeyChange } from "./accessKeys";
import { givenDeletedLine, keyGivenEventLine, keyGivenToYouLine, keyNeedLine, keysAddedLine, keysRemovedLine, parseKeys } from "@/lib/keys";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { LIMITS } from "@/lib/limits";
import { displayName, fmtDate, fmtDateTime, fmtDateTimeIn, pronouns, stopTimeIn, toCents } from "@/lib/format";
import { CATEGORIES, DEVICES, LANGUAGES } from "@/lib/options";
import { T, safeZone } from "@/lib/tz";
import { LISTING_INFO_FIELDS, LISTING_VALUES, valuesText } from "@/lib/listingInfo";
import { LISTING_SAVED, savedText } from "@/lib/listingPanel";
import {
  andList, testClosedToNewLine, daysBetween, openUntilDay, testerDaysOf, testPaused, testerPaused, PAUSED_SEND, checkWrittenLength, PAUSED_RIGHT_NOW, openUntilShortened, changedTerms, checkListing, checkOpenUntilChange, contractSnapshot, editCheck, isLate, joinCheck, payByFrom, PAY_WAITS, testerRefusal, LISTING_FIELDS, mergeEdit, termsLine, type Listing, type TestEventLike,
} from "@/lib/rules";
import { gapsOf, gapsUnseen, missingNeedText, noGaps, readGaps } from "@/lib/gaps";
import { HttpError, readText } from "./http";
import { notify } from "./notify";
import { answerTermsFirst, offerNewTerms, testerSendGate } from "./terms";
import { blockPartners } from "./blocks";
import { notifyPaidUpdate, paidUpdateRoom, resendRefusal } from "./paidUpdates";
import { updatedAfterPaidLive, updatedAtCapLive } from "@/lib/moneyLines";
import { callCancelledLine, STOP_NOTE_KIND, stopEventText, stopNoteText, PAY_RULES_TICK_MISSING, payRulesTicked, PART_PRICE_MISSING, NOTHING_CHANGED_LINE, WHY_MIN_CHARS, WHY_TOO_SHORT, MAX_SPOTS } from "@/lib/rules";

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
 * (Owner, Oct 29, batch 14 section 2) The 3-change count starts once anyone is affected: the first tester joins, the first application arrives or the first invite is
 * sent. Stored as "since" in criticalCounts (kept when the only applicant withdraws). Called where each of those happens; a test from before this keeps counting from
 * its first such row (startedCounting reads them).
 */
export async function stampCounting(testId: string, tx: Prisma.TransactionClient | typeof db = db, at = new Date()) {
  await tx.$executeRaw`UPDATE "Test" SET "criticalCounts" = COALESCE("criticalCounts", '{}'::jsonb) || jsonb_build_object('since', ${at.toISOString()}::text) WHERE id = ${testId} AND NOT jsonb_exists(COALESCE("criticalCounts", '{}'::jsonb), 'since')`;
}
/** When the count started (null: nobody affected yet, edits are free and nobody is told). */
export async function startedCounting(t: { id: string; criticalCounts: unknown }, tx: Prisma.TransactionClient | typeof db = db): Promise<Date | null> {
  const since = countingSince(t.criticalCounts);
  if (since) return since;
  const [c, a, i] = await Promise.all([
    tx.contract.findFirst({ where: { testId: t.id }, orderBy: { joinedAt: "asc" }, select: { joinedAt: true } }),
    tx.application.findFirst({ where: { testId: t.id }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    tx.invite.findFirst({ where: { testId: t.id }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  const first = [c?.joinedAt, a?.createdAt, i?.createdAt].filter((d): d is Date => !!d).sort((x, y) => x.getTime() - y.getTime())[0] ?? null;
  if (first) await stampCounting(t.id, tx, first);
  return first;
}

export const writtenQuestions = (c: { questions: unknown }) => {
  const qs = (c.questions as string[]) ?? [];
  return qs.length ? qs : ["Your feedback"];
};

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
export function parseListing(body: Record<string, unknown>, partial = false): Partial<Listing> {
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
    out.buildUrl = str(body.buildUrl, 500);
    // (Batch 15 section 35) https:// only, as the message says.
    if (out.buildUrl && !/^https:\/\//i.test(out.buildUrl)) throw new HttpError(400, "bad_url", "The build link must start with https://");
  }
  if (has("categories")) out.categories = list(body.categories, CATEGORIES);
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
    out.openUntil = v ? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.000Z` : v) : null;
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
export async function recordEvent(tx: Tx, testId: string, kind: string, text: string, bump: boolean, extra: Prisma.TestUpdateInput = {}, contractId: string | null = null, /** (Batch 34 §9) the tab that saved the listing */ tab = "") {
  let version: number | null = null;
  if (bump || Object.keys(extra).length) {
    const t = await tx.test.update({ where: { id: testId }, data: { ...(bump ? { version: { increment: 1 } } : {}), ...extra } });
    if (bump) version = t.version;
  }
  await tx.testEvent.create({ data: { testId, kind, text, version, contractId, ...(tab ? { tab } : {}) } });
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
export async function spotOpened(testId: string) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true } });
  const last = await db.testEvent.findFirst({ where: { testId, kind: { in: ["full", "spot_open"] } }, orderBy: { createdAt: "desc" } });
  if (last?.kind !== "full") return;
  if ((await db.contract.count({ where: working(testId) })) >= t.spots) return;
  await db.testEvent.create({ data: { testId, kind: "spot_open", text: spotOpenLine(t.title, displayName(t.developer)) } });
  // Once per invite: only those never told a spot opened.
  const invs = await db.invite.findMany({ where: { testId, status: "sent", openNotifiedAt: null } });
  await db.invite.updateMany({ where: { id: { in: invs.map((i) => i.id) } }, data: { openNotifiedAt: new Date() } });
  const people = await db.user.findMany({ where: { id: { in: invs.map((i) => i.testerId) } } });
  for (const p of people) await notify(p.email, spotOpenLine(t.title, displayName(t.developer)), [spotOpenLine(t.title, displayName(t.developer))], `/app/find/${testId}`, { ...APPS_GROUP, testId });
}

/** (NEWEST+4) Rejoining keeps exactly the time they had left when they left (hours count; if it had passed, it stays passed). */
export const rejoinDue = (oldDue: Date, leftAt: Date | null, now: Date) => new Date(now.getTime() + (oldDue.getTime() - (leftAt ?? now).getTime()));

/** The developer's own test, or a refusal. Other people's tests look like they don't exist. */
export async function ownTest(devId: string, testId: string) {
  const t = await db.test.findUnique({ where: { id: testId } });
  if (!t || t.developerId !== devId) throw new HttpError(404, "not_found", "That test doesn't exist or isn't yours.");
  return t;
}

/** " Refresh to see the latest." when something happened on the test since the page loaded. */
export async function staleNote(testId: string, seenAt: unknown) {
  const d = typeof seenAt === "string" ? new Date(seenAt) : null;
  if (!d || isNaN(d.getTime())) return "";
  const n = await db.testEvent.count({ where: { testId, createdAt: { gt: d } } });
  return n ? " Refresh to see the latest." : "";
}

export const seenDate = (v: unknown) => {
  const d = typeof v === "string" ? new Date(v) : null;
  if (!d || isNaN(d.getTime())) throw new HttpError(400, "bad_request", "This page is out of date. Refresh to see the latest.");
  return d;
};

// ---------- developer: post, edit ----------

/** The parts whose "I confirm this part pays more than $200." tick was ticked. */
const confirmedHighOf = (body: Record<string, unknown>) => (Array.isArray(body.confirmHigh) ? body.confirmHigh.map(String) : []);

/** Post a test's checks (Post a test, and posting a draft): the listing (at most 10 spots) and the access keys. */
async function checkPost(dev: U, body: Record<string, unknown>) {
  if (!dev.isDeveloper) throw new HttpError(403, "not_developer", "Turn on “post tests” in your profile to post a test.");
  if (await devOnHold(dev.id)) throw new HttpError(409, "on_hold", `${PAY_WAITS} New tests can't be posted while payments are on hold.`);
  const l = parseListing(body) as Listing;
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
  if (t0.status !== "draft") throw new HttpError(409, "not_draft", t0.status === "stopped" ? "This test was stopped." : "This test is already open.");
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
  const t = await ownTest(dev.id, testId);
  if (t.status !== "draft") throw new HttpError(409, "not_draft", "Only a draft can be deleted.");
  await db.test.delete({ where: { id: testId } });
  await db.keptForm.deleteMany({ where: { userId: dev.id, key: `test:draft:${testId}` } }).catch(() => null);
  return { deleted: true };
}

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
  await ownTest(dev.id, testId);
  const loaded = Number(body.version);
  const confirmed = body.confirmed === true;
  const touched = parseListing((body.fields ?? {}) as Record<string, unknown>, true);
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
  const result = await db.$transaction(async (tx) => {
    const t = await lockTest(tx, testId);
    if (t.status === "stopped") throw new HttpError(409, "stopped", "This test was stopped.");
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
    // (Owner, Oct 29, batch 29 section 12) The developer's own changes in another tab stop Save once like every test-page press (a Pay, a call change, Next round,
    // an invite…); another tab's Save becomes the per-field lines below.
    const dc = seen ? withRenamed(await devChanges(dev.id, testId, seen, tabOf(body), tx, { press: { acts: ["edit"], keys: ["*"] } }), body) : [];
    // The "fields you didn't touch keep the newer values" tail only when the listing itself was saved elsewhere.
    const listingEdited = events.some((e) => e.kind === "edited" || e.kind === "edited_spots");
    const current = asListing(t);
    const next = mergeEdit(current, touched);
    if (!next.mature) next.matureWhy = "";
    const ou = checkOpenUntilChange(t.openUntil, next.openUntil ? new Date(next.openUntil) : null, new Date(), fmtDate);
    if (!ou.ok) throw new HttpError(409, "open_until_passed", ou.message);
    if (next.liveRateCents == null) next.liveMinutes = null;
    const testersIn = await tx.contract.count({ where: working(testId) });
    const fields = LISTING_FIELDS.filter((k) => JSON.stringify(current[k]) !== JSON.stringify(next[k]));
    // (Design doc 4/5) The Post rules, then the critical-change limit and the access keys: every red mistake is found FIRST
    // (a stop-once reason never hides one), and nothing saves while any remains.
    const errs = checkListing(next, testersIn, new Date(), { changed: new Set(fields), openedAt: t.createdAt, edit: true, confirmedHigh: confirmedHighOf(body), saved: { writtenCents: t.writtenCents, recordingCents: t.recordingCents }, savedSpots: t.spots, tz: tzOf(body, dev) });
    if (fields.includes("openUntil")) { const short = openUntilShortened(current.openUntil, next.openUntil, fmtDate); if (short) errs.push(short); }
    // (Batch 14) Each limited field's counter (the parts and prices share one); the count runs once anyone is affected.
    const critical = countersOf(fields);
    const since = await startedCounting(t, tx);
    const everJoined = !!since;
    // (Owner, Oct 28 afternoon) Each limited field has its OWN 3 changes: only a field that used all of them is refused (the others still save).
    const counts = countsOf(t.criticalCounts);
    const lockedNow = everJoined ? critical.filter((f) => lockedFields(counts).includes(f)) : [];
    errs.push(...lockedNow.map(criticalLine));
    const plan = await planKeyChange(tx, testId, keysAdd, keysRemove, next.spots);
    const keyErrs = [...plan.errors, ...(plan.need ? [plan.need] : [])];
    errs.push(...keyErrs);
    // (Batch 19 section 7) Every Save needs the tick about Charge (the page shows it while Save is enabled), red at the tick.
    if (!payRulesTicked(body)) errs.push(PAY_RULES_TICK_MISSING);
    const keysChanged = plan.toAdd.length > 0 || plan.removable.length > 0 || plan.toReuse.length > 0;
    // (Owner, Oct 28, batch 16 sections 17 and 18) Another tab's (or device's) save is a reason to stop only for the fields where what this press holds
    // differs from what's saved now. Its lines are replaced by one line naming just those fields ("You changed the description in another tab", carrying
    // the fields for the box's Before / What you typed) and, ALWAYS (keys decide what can still be added), the keys' "Added: …" / "Removed: …" lines since
    // the page loaded (or its last stop box). A page that doesn't send what it loaded and holds (an older page) keeps every line.
    let dcN: (TestEventLike & { fields?: string[] })[] = dc;
    let gateChanges = gate.go ? [] : gate.changes;
    const news = seen && !onlyOwnSaves ? await editNews(tx, testId, body, current) : null;
    // (Batch 16 section 20) A key this press deletes that a joining tester was given meanwhile (the page hadn't shown it): not a mistake, a stop with the
    // warning; the second press saves the rest of the key edits.
    if (seen) {
      const given = await tx.accessKey.findMany({ where: { testId, value: { in: keysRemove }, status: { in: ["inuse", "broken"] } }, include: { contract: { include: { tester: true } } } });
      if (given.length) dcN = [...dcN, { kind: "own", text: givenDeletedLine(given.map((k) => ({ name: k.contract ? displayName(k.contract.tester) : "A tester", value: k.value }))), createdAt: given.reduce((a, k) => ((k.assignedAt ?? k.createdAt) > a ? k.assignedAt ?? k.createdAt : a), given[0].assignedAt ?? given[0].createdAt) }];
    }
    if (news) {
      const isEdit = (e: TestEventLike) => (e.kind === "own" && OTHER_TAB_EDIT.test(e.text)) || e.kind === "edited" || e.kind === "edited_spots";
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
    dcN = [...dcN].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const stop = dcN.length ? dcN.map((c) => ({ ...devLine(c, false), ...(c.fields ? { fields: c.fields } : {}), ...(c.kind === "yours" ? { kind: "yours" } : {}) })) : gateChanges.length ? gateChanges.map((c) => ({ text: c.text, at: c.createdAt })) : null;
    if (stop) {
      // Both together: the blue stop and any red mistakes (red wins: the next press still saves nothing while red remains).
      throw new HttpError(409, "changed", dcN.length ? "Press Save again to save." : "This test changed since you opened Edit. Press Save again to save your changes on top.", {
        changes: stop, version: t.version, criticalCounts: counts, current, listingEdited, errors: errs, keys: await keysState(tx, testId), critical: critical.length ? critical : undefined,
      });
    }
    if (errs.length) throw new HttpError(400, "bad_listing", errs[0], { errors: errs, critical: lockedNow.length ? lockedNow : undefined, criticalCounts: counts });
    if (!fields.length && !keysChanged) {
      keysGiven = await giveKeysToWorking(tx, testId); // (Batch 30 §17)
      return t;
    }
    const terms = changedTerms(current, next);
    const what = [...fields.map((f) => FIELD_NAMES[f]), ...(keysChanged ? ["access keys"] : [])].join(", ");
    termsChanged = terms.some((f) => ["writtenCents", "recordingCents", "liveRateCents", "liveMinutes", "writtenRequired", "recordingRequired", "liveRequired", "deadlineDays", "questions", "ndaText"].includes(f));
    // (NEWEST+12) Testers are alerted to EVERY change except the number of spots and Open until: those two never make an "edited" line / bump the listing version.
    const listingFields = fields.filter((f) => f !== "spots" && f !== "openUntil");
    switchedToAnyone = fields.includes("joinMode") && next.joinMode === "anyone";
    await recordEvent(tx, testId, listingFields.length ? "edited" : "edited_spots", `The listing was edited: ${listingFields.length ? listingFields.map((f) => FIELD_NAMES[f]).join(", ") : what}`, true, {
      ...listingData(next), ...(fields.includes("openUntil") ? { notified3d: false, notified1d: false } : {}), ...(listingFields.length ? { listingVersion: { increment: 1 } } : {}),
      // (5; owner, Oct 28 afternoon) A save that changed limited fields after the first tester joined uses one change of EACH of them.
      ...(critical.length && everJoined ? { criticalCounts: storedCounts(countsAfter(counts, critical), since) } : {}),
    }, null, tab);
    if (keysChanged) {
      await applyKeyChange(tx, testId, plan.toAdd, plan.removable, plan.toReuse);
    }
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
    if (fields.includes("openUntil") && next.openUntil && current.openUntil) {
      const d = daysBetween(openUntilDay(current.openUntil), openUntilDay(next.openUntil));
      if (d > 0) {
        await tx.test.update({ where: { id: testId }, data: { testerDays: (t.testerDays ?? testerDaysOf(t.createdAt, current.openUntil, dev.timeZone)) + d } });
        await tx.$executeRaw`UPDATE "Contract" SET "dueAt" = "dueAt" + ${d} * interval '1 day' WHERE "testId" = ${testId} AND status = 'working'`;
      }
    }
    // (F) Listing info (description, devices, languages): shown to working testers and on the join page; stops once.
    const info = fields.filter((f) => INFO_FIELDS.includes(f));
    if (info.length) await tx.testEvent.create({ data: { testId, kind: "info", text: `${displayName(dev)} changed ${andList(info.map((f) => (f === "joinMode" ? FIELD_NAMES[f] : `the ${FIELD_NAMES[f]}`)))}` } });
    // A title change is info only everywhere (never stops; a press notes it).
    if (fields.includes("title")) await tx.testEvent.create({ data: { testId, kind: "renamed", text: `${displayName(dev)} renamed the test to ${next.title}` } });
    // (Batch 30 §10) Testers read ONE line per save, everywhere (join page, session page, stop boxes, top boxes): what this save changed, for each page to word.
    if (listingFields.length) await tx.testEvent.create({ data: { testId, kind: "listing_save", text: saveText({ by: displayName(dev), fields: listingFields, title: next.title, nda: !!next.ndaText }) } });
    changedNames = [...fields.map((f) => FIELD_NAMES[f]), ...(keysChanged ? ["access keys"] : [])];
    reinvite = fields.some((f) => CLOSING_FIELDS.includes(f));
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
  if (switchedToAnyone) await (await import("./joining")).onSwitchToAnyone(testId);
  // (NEWEST+4) Any listing change except spots / who can join re-sends open invites on the new listing.
  const { skipped: notReinvited, resent } = reinvite ? await (await import("./invites")).reinviteAfterEdit(testId) : { skipped: [], resent: [] };
  // (Batch 15 section 43) The Save's effects on others, on its Contract changes entry.
  const effects = [closedApps.length ? `${closedApps.length} application${closedApps.length === 1 ? "" : "s"} closed` : "", resent.length ? `${resent.length} invite${resent.length === 1 ? "" : "s"} re-sent` : ""].filter(Boolean).join(" · ");
  if (changeId && effects) await db.testChange.update({ where: { id: changeId }, data: { effects } });
  // (Batch 30 §17) Each tester given a key: a line in their session page's top box and a bell line (the key itself only on their page, never in the bell or email).
  for (const g of keysGiven) {
    await logEvent(testId, KEY_GIVEN, keyGivenEventLine(displayName(dev), g.name), g.contractId);
    const line = keyGivenToYouLine(displayName(dev), result.title);
    await notify(g.email, line, [`${line}.`, "Your key is on your session page."], `/app/sessions/${g.contractId}`, { testId });
  }
  return Object.assign(result, { offered, changed: changedNames, notReinvited, resent, closedApps, keysGiven: keysGiven.length });
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
  if (t.status !== "draft") throw new HttpError(409, "not_draft", t.status === "stopped" ? "This test was stopped." : "This test is already open.");
  await postPerks(dev.id, t.joinMode, testId);
  return db.$transaction((tx) => recordEvent(tx, testId, "opened", "The test opened for testers", true, { status: "open", testerDays: testerDaysFor(t.openUntil, dev) }));
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
const OTHER_TAB_EDIT = /^You saved the listing in another tab: /;
/** Fields the form never sends as typed (kept from an older page, or set by the server). */
const NOT_COMPARED = new Set<keyof Listing>(["deadlineDays", "liveMinutes"]);
/** Two values of one field are the same (Open until by its day: a pause shift moves it by the minute). */
const sameValue = (k: keyof Listing, a: unknown, b: unknown) =>
  k === "openUntil" ? (a ? String(a).slice(0, 10) : null) === (b ? String(b).slice(0, 10) : null) : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/**
 * (Owner, Oct 28, batch 16 sections 17 and 18) What another tab or device saved that THIS tab doesn't have: the fields it loaded (`base`) that differ from
 * what's saved now and where what it holds (`has`, typed or not) differs too. Keys are always news (the owner's exception): every free key added and
 * removed since the keys it loaded (`keysLoaded`), even one this tab also added or removed (a key given to a joining tester is a join, not a removal).
 * null when the page didn't send them (nothing is dropped then).
 */
export async function editNews(tx: Tx, testId: string, body: Record<string, unknown>, current: Listing) {
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const b = obj(body.base), h = obj(body.has);
  if (!b || !h) return null;
  let base: Partial<Listing>, has: Partial<Listing>;
  try {
    base = parseListing(b, true);
    has = parseListing(h, true);
  } catch {
    return null; // a box this press can't read (its own mistake is said elsewhere): every line stays
  }
  // (Owner, Oct 29, batch 23 section 5) Edit keeps what you typed: a field this press doesn't send took the other tab's value (it is never undone), so only the fields it
  // sends count, except spots and Open until (they take the other tab's value even when typed: today's rule, with the press holding what it had typed).
  const sent = new Set(Object.keys(obj(body.fields) ?? {}));
  const fields = LISTING_FIELDS.filter((k) => !NOT_COMPARED.has(k) && k in base && k in has && (takesTheirs(k) || sent.has(k)) && !sameValue(k, base[k], current[k]) && !sameValue(k, has[k], current[k]));
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
  text: c.text, at: c.createdAt, ...(c.kind === "terms" && c.contractId ? { kind: "terms", contract: c.contractId } : {}), ...(withAlert && alertOf(c.kind) ? { alert: alertOf(c.kind) } : {}),
  // (Batch 26 section 4) A stop line says its own time: the box doesn't add it again.
  ...(c.kind === "stop" ? { kind: "stop" } : {}),
  // (Batch 20 section 4) A line that stands for one thing (a ticked tester's needs): a later stop's line with the same key replaces it in the box.
  ...(c.key ? { key: c.key } : {}),
  // (Batch 34 §14) A listing change: See it jumps to the test page's Listing panel.
  ...(c.listing ? { listing: true } : {}),
  // (Batch 35 §3) ... and names its Save, so See it marks that Save's fields only.
  ...(c.saveAt ? { saveAt: c.saveAt } : {}),
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
    const stop = (await devStopSince(testId, press.stopCheck || null, loadedOf(body))) ?? (await devPauseSince(testId, loadedOf(body)));
    if (stop) moments.push(stop);
  }
  // (Owner, Oct 29, batch 29 section 11; replaces batch 16 section 25's "goes through on the first press") On a stopped, closed or paused test (any cause), and while the
  // developer is held or suspended, every press still allowed follows the SAME stop-once rules as on a running test. The stop, close or pause itself is a change like any
  // other: a page opened before it stops once naming it ("You stopped this test at 3:10 PM.", "The team paused this test at 3:10 PM.").
  if (press.stopCheck === undefined && !press.inState) {
    const stop = await devStopSince(testId, null, loadedOf(body));
    if (stop) moments.push(stop);
    const pause = await devPauseSince(testId, loadedOf(body));
    if (pause) moments.push(pause);
  }
  if (body.confirmed === true) extraChanges = extraChanges.filter((c) => c.createdAt > seenAt);
  const t = await tx.test.findUniqueOrThrow({ where: { id: testId }, select: { developerId: true } });
  const found = await devChanges(t.developerId, testId, seenAt, tabOf(body), tx, { press });
  // The developer's own Stop in another tab already reads "You stopped the test in another tab": the stop moment isn't said twice.
  const own = found.some((e) => e.kind === "own" && e.text === OWN_STOP_LINE);
  const raw = [...found, ...extraChanges, ...moments.filter((m) => !(own && m.text.startsWith("You stopped this test")))].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  // (Owner, Oct 28) `keep`: a button that stops for only some kinds (Rate after the test closed).
  const changes = withRenamed(keep ? raw.filter((e) => e.kind === "renamed" || e.kind === "stop" || keep(e)) : raw, body);
  if (changes.length) {
    throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes: changes.map((c) => devLine(c)), ...extra });
  }
}
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
export async function cancelCallsAhead(tx: Tx, contractIds: string[], note: string) {
  const ahead = await tx.call.findMany({ where: { contractId: { in: contractIds }, status: "booked", startsAt: { gt: new Date() } }, include: { contract: { include: { tester: true } } } });
  for (const c of ahead) {
    await tx.call.update({ where: { id: c.id }, data: { status: "cancelled", cancelledBy: "system", cancelledAt: new Date(), cancelNote: note } });
    await tx.callSlot.update({ where: { id: c.slotId }, data: { status: "removed" } });
  }
  return ahead.map((c) => ({ email: c.contract.tester.email, startsAt: c.startsAt, contractId: c.contractId, title: c.contract.title, callId: c.id }));
}

/** Tell each tester their booked call was cancelled (never any fault). */
export async function tellCancelled(list: { email: string; startsAt: Date; contractId: string; title: string; callId?: string }[], why: Parameters<typeof callCancelledLine>[1]) {
  for (const c of list) await notify(c.email, callCancelledLine(c.startsAt, why), [callCancelledLine(c.startsAt, why)], `/app/sessions/${c.contractId}${c.callId ? `#call-${c.callId}` : ""}`);
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
    // (Batch 16 section 21) Stopped in another tab: this Stop stops once naming it ("You stopped the test in another tab"), then it's already done.
    if (t.status === "stopped") {
      await topPanelGate(tx, testId, body, {}, [], undefined, { acts: ["stop"], keys: ["test"], inState: true });
      throw new HttpError(409, "stopped", "This test was stopped." + (await staleNote(testId, body.seenAt)));
    }
    // (Owner, Oct 29, batch 29 section 11; replaces batch 15 sections 23, 29 and 37) While the test is paused (any cause) Stop follows the same stop-once rules.
    await topPanelGate(tx, testId, body, {}, [], undefined, { acts: ["stop"], keys: ["test"] });
    const cs = await tx.contract.findMany({ where: working(testId), include: { tester: true } });
    // (Batch 17 §15) The reason is each ended contract's endReason, and an entry in each tester's contract changes (the marker that it's the developer's own reason).
    await tx.contract.updateMany({ where: working(testId), data: { status: "ended", endKind: "stopped", endedAt: new Date(), endReason: reason } });
    if (cs.length) await tx.contractNote.createMany({ data: cs.map((c) => ({ contractId: c.id, kind: STOP_NOTE_KIND, text: stopNoteText(reason) })) });
    cancelled = await cancelCallsAhead(tx, cs.map((c) => c.id), "The test was stopped.");
    await tx.callRequest.updateMany({ where: { contractId: { in: cs.map((c) => c.id) }, status: "pending" }, data: { status: "closed", closedReason: "the test was stopped", decidedAt: new Date() } });
    await tx.callSlot.updateMany({ where: { testId, status: "open" }, data: { status: "removed" } });
    invitesClosed = await (await import("./invites")).openInviteIds({ testId }, tx);
    await tx.invite.updateMany({ where: { testId, status: "sent" }, data: { status: "cancelled" } }); // (batch 16 section 32) a stop closes open invites
    await recordEvent(tx, testId, "stopped", stopEventText(reason), true, { status: "stopped", stoppedAt: new Date() });
    return cs;
  });
  await tellCancelled(cancelled, "stopped");
  await (await import("./invites")).tellInvitesClosed(invitesClosed); // (batch 30 §6)
  // (Batch 17 §15) The reason in full in the email, never in the bell line.
  for (const c of contracts)
    await notify(c.tester.email, `“${c.title}” was stopped`, [`${displayName(dev)} stopped “${c.title}”: “${reason}”`, "Your work on it has ended. Work you already sent is still reviewed and paid. Calls ahead are cancelled."], `/app/sessions/${c.id}`, { group: "tstopped" });
  return { stopped: true, testers: contracts.length };
}

/**
 * End the ticked testers' work now. Work they sent is still reviewed; calls ahead are cancelled; later presses are refused.
 * (`contractIds`: the ticks; `contractId` still works for one.) If any ticked tester is already out, nothing is ended and
 * the refusal names them.
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
  const ended = await db.$transaction(async (tx) => {
    const lockedTest = await lockTest(tx, testId);
    // (Owner) After a stop, a stale press fails and names the stop.
    if (lockedTest.status === "stopped") throw new HttpError(409, "stopped", "This test was stopped." + (await staleNote(testId, body.seenAt)));
    const list = [];
    // (Owner, Oct 28, batch 16 section 21) Testers this developer already ended early in another tab: this press stops once ("You ended Ana Silva's work early
    // in another tab"); on the second press they're dropped and the rest go through.
    const endedElsewhere: { id: string; name: string }[] = [];
    for (const id of ids) {
      const c = await tx.contract.findUnique({ where: { id }, include: { tester: true } });
      if (!c || c.testId !== testId) throw new HttpError(404, "not_found", "Choose a tester.");
      const name = displayName(c.tester);
      if (c.status === "left") throw new HttpError(409, "gone", `${name} already left the test.` + (await staleNote(testId, body.seenAt)));
      if (c.status === "ended" && c.endKind === "early" && seenOf(body.seenAt) && c.endedAt && c.endedAt > seenOf(body.seenAt)!) { endedElsewhere.push({ id, name }); continue; }
      if (c.status !== "working") throw new HttpError(409, "gone", `${name}'s work already ended.` + (await staleNote(testId, body.seenAt)));
      list.push(c);
    }
    // (Batch 29 sections 11-12) Paused or not, it stops once for what changed since the page loaded, the developer's own changes in another tab included (batch 16
    // section 21: ended the ticked testers early, paid their work, or requested, booked or cancelled a call with them; batch 29: any of BIG_OWN_ACTS).
    await topPanelGate(tx, testId, body, {}, [], undefined, { acts: ["end-early", ...PAY_ACTS, ...CALL_ACTS], keys: ids.map((id) => `c:${id}`) });
    if (!list.length && endedElsewhere.length) throw new HttpError(409, "gone", `${andList(endedElsewhere.map((x) => x.name))}'s work already ended.`);
    for (const c of list) {
      await tx.contract.update({ where: { id: c.id }, data: { status: "ended", endKind: "early", endedAt: new Date(), endReason: reason } });
      cancelled = cancelled.concat(await cancelCallsAhead(tx, [c.id], "The developer ended the work early."));
      await tx.callRequest.updateMany({ where: { contractId: c.id, status: "pending" }, data: { status: "closed", closedReason: "the session ended", decidedAt: new Date() } });
      await recordEvent(tx, testId, "ended", `You ended ${displayName(c.tester)}'s work early`, false, {}, c.id);
    }
    return list;
  });
  await tellCancelled(cancelled, "ended");
  for (const c of ended)
    await notify(c.tester.email, `Your work on “${c.title}” was ended early`, [`${displayName(dev)} ended your work on “${c.title}”: “${reason}”`, "Work you already sent is still reviewed and paid. Calls ahead are cancelled."], `/app/sessions/${c.id}`, { about: dev.id, group: "tstopped" });
  await spotOpened(testId);
  return { ended: true, count: ended.length, endedIds: ended.map((c) => c.id) };
}

/** Next round: a draft copy of the test for the next build. Optionally stops new testers joining this one. */
export async function nextRound(dev: U, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  // (Batch 8) Next round is a subscriber perk.
  await (await import("./subscription")).requirePerk(dev.id, "nextRound");
  const res = await db.$transaction(async (tx) => {
    const t = await lockTest(tx, testId);
    // (Owner, Oct 28 evening) Next round stays on a stopped test: it starts a new draft from it.
    const existing = await tx.test.findFirst({ where: { previousId: testId } });
    if (existing) {
      // (Owner, Oct 28, batch 16 section 21) Another tab already made the draft: this press stops once, and the box links to the draft; then it's refused.
      const boxAt = seenOf(body.boxAt);
      const since = body.confirmed === true && boxAt ? boxAt : seenOf(body.seenAt);
      const made = since ? (await ownChanges(dev.id, testId, since, tabOf(body), tx)).filter((o) => o.about?.a === "next-round") : [];
      if (made.length && !(body.confirmed === true && !boxAt)) {
        const m = made[made.length - 1];
        throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes: [{ text: m.live ?? m.text, at: m.createdAt, link: `/app/tests/new?draft=${existing.id}` }] });
      }
      throw new HttpError(409, "exists", "This test already has a next round." + (await staleNote(testId, body.seenAt)), { id: existing.id });
    }
    if (await devOnHold(dev.id)) throw new HttpError(409, "on_hold", `${PAY_WAITS} Your tests are paused until then.`);
    await topPanelGate(tx, testId, body, {}, [], undefined, { acts: ["next-round"], keys: ["test"] });
    const round = t.round + 1;
    const copy = await tx.test.create({
      data: {
        // (Batch 31) The next round takes at most 10 testers, like any test posted now.
        ...listingData(asListing(t)), spots: Math.min(t.spots, MAX_SPOTS), title: `${t.title.replace(/ \(round \d+\)$/, "")} (round ${round})`, developerId: dev.id, status: "draft", round, previousId: t.id,
        questions: t.questions as Prisma.InputJsonValue,
      },
    });
    // (Owner) Starting a next round never changes this round: it keeps taking testers and everyone carries on.
    await recordEvent(tx, testId, "next_round", `Round ${round} was started`, true, {});
    return { id: copy.id };
  });
  return res;
}

/**
 * (Owner, Oct 29, batch 27 section 2) "Go to the next round" (the test already has its next-round draft) is a press, not a plain link: it runs the developer's stop-once
 * gate first, with the same changes and Alerts types as Next round (a tester sent or updated work, left, a call change, a payment…): the first press stops once in
 * the box under the button, the second opens the draft. (Batch 29 section 11) On a stopped, closed or paused test it follows the same stop-once rules.
 */
export async function goNextRound(dev: U, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  const next = await db.test.findFirst({ where: { previousId: testId }, select: { id: true } });
  if (!next) throw new HttpError(409, "gone", NO_NEXT_ROUND);
  // (Batch 30 §6, per batch 29 §11: stop-once everywhere) Also after Open until passed: no skip.
  await db.$transaction((tx) => topPanelGate(tx, testId, body, {}, [], undefined, { acts: ["next-round"], keys: ["test"] }));
  return { id: next.id };
}
/** (Batch 27 section 2) The next round's draft was deleted meanwhile. */
export const NO_NEXT_ROUND = "This test has no next round any more: its draft was deleted.";

// ---------- tester: find and join ----------

/** Open tests the tester can join (not their own, not full, not already joined). (Batch 17 section 8) `q`: the search box (test, product or developer name). */
export async function findTests(tester: U, q?: unknown) {
  const tests = await db.test.findMany({
    where: {
      ...(await import("./findSearch")).testSearchWhere(q),
      status: "open", adminPausedAt: null, developerId: { notIn: [tester.id, ...(await blockPartners(tester.id))] }, developer: { devSuspendedAt: null, holdStartedAt: null },
      // Not joined, or LEFT (they can come back: not after rating, not if the developer ended them).
      contracts: { none: { testerId: tester.id, OR: [{ status: { not: "left" } }, { endKind: "rated" }] } },
      // (Owner, Oct 30, batch 15 section 38) Invite-only tests are never in Find, not even for invited testers (they reach them from their invites, the bell or the email).
      joinMode: { not: "invite" },
      // (Batch 15 section 18) After Open until the test is closed to everyone who hasn't joined: out of Find.
      OR: [{ openUntil: null }, { openUntil: { gt: new Date() } }],
    },
    include: { _count: { select: { contracts: { where: { status: "working" } } } }, developer: { select: { name: true, email: true } }, contracts: { where: { testerId: tester.id }, select: { status: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  // Most relevant first (owner): tests needing a device the tester has, then tests open to any device, then tests
  // needing a device they don't list; newest first within each group.
  const p = await db.testerProfile.findUnique({ where: { userId: tester.id } });
  const rank = (t: { devices: string[]; languages: string[] }) =>
    t.devices.length ? (t.devices.some((d) => p?.devices.includes(d)) ? 0 : 2) : 1;
  return tests.filter((t) => t._count.contracts < t.spots).map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t);
}

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
  if (body.anyway !== true) throw new HttpError(409, "needs", message, { gaps });
  const shown = readGaps(body.gapsShown);
  if (shown && gapsUnseen(gaps, shown)) throw new HttpError(409, "needs", message, { gaps, changed: true });
}
/** Why this tester's profile doesn't fit the test's needs, or "" when it does (every unmet need). */
export const needsGap = (t: { devices: string[]; languages: string[] }, p: { devices: string[]; languages: string[] } | null) => needsLines(t, p).join(" ");

/**
 * Join: the tester sends the listing version they saw. A changed listing stops once and returns the new terms;
 * the second press joins on them. Closed, stopped or full tests refuse for good. The contract is a snapshot.
 */
export async function joinTest(tester: U, testId: string, body: Record<string, unknown>, options: { applicationId?: string; quietJoinEvent?: boolean } = {}) {
  if (!tester.isTester) throw new HttpError(403, "not_tester", "Turn on “test apps, games and more” in your profile to join tests.");
  const profile = await db.testerProfile.findUnique({ where: { userId: tester.id } });
  const seen = Number(body.listingVersion);
  const { contract, dev, filled } = await db.$transaction(async (tx) => {
    const t = await lockTest(tx, testId);
    if (options.applicationId) {
      const application = await tx.application.findUnique({ where: { id: options.applicationId } });
      if (!application || application.testId !== testId || application.testerId !== tester.id || application.status !== "pending")
        throw new HttpError(409, "application_gone", "This application is no longer waiting.");
      const claimed = await tx.application.updateMany({ where: { id: application.id, status: "pending" }, data: { status: "joined", decidedAt: new Date() } });
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
    if (testPaused(dev, t)) throw new HttpError(409, "paused", PAUSED_RIGHT_NOW);
    const testersIn = await tx.contract.count({ where: working(testId) });
    const r = joinCheck({ status: t.status, listingVersion: t.listingVersion, spots: t.spots, testersIn, openUntil: t.openUntil }, seen, body.confirmed === true);
    if (r.result === "refused") throw new HttpError(409, "refused", r.message);
    if (r.result === "changed") {
      throw new HttpError(409, "listing_changed", "The developer changed this test since you opened it. Check the new terms, then press Join again to join on them.", {
        listingVersion: t.listingVersion, terms: termsLine(asListing(t), true), questions: t.questions,
      });
    }
    if (await tx.block.count({ where: { blockerId: tester.id, blockedId: t.developerId } })) throw new HttpError(409, "blocked", `You blocked ${displayName(dev)}: unblock them in Account → Blocked people to join.`);
    if (await tx.block.count({ where: { blockerId: t.developerId, blockedId: tester.id } })) throw new HttpError(409, "closed", "This test isn't taking new testers right now.");
    gapStop(t, profile, body, "Join");
    // (Design doc 7.3) Joining needs the NDA accepted (the time it was accepted is kept with the terms).
    const ndaAt = typeof body.ndaAcceptedAt === "string" && !isNaN(new Date(body.ndaAcceptedAt).getTime()) ? new Date(body.ndaAcceptedAt) : null;
    if (t.ndaText && body.ndaAccepted !== true && !ndaAt) throw new HttpError(400, "nda", "Accept the NDA to join.");
    // (Batch 15 section 18) The tester's deadline: the day they join + the test's tester days (counted in the developer's time zone, like Open until).
    const snap = contractSnapshot({ ...asListing(t), listingVersion: t.listingVersion, testerDays: t.testerDays, tz: dev.timeZone }, new Date(), body.keepPrivate === true, ndaAt ?? new Date());
    const contract = old
      ? await tx.contract.update({ where: { id: old.id }, data: { ...snap, dueAt: rejoinDue(old.dueAt, old.endedAt, new Date()), status: "working", endKind: "", endedAt: null, endReason: "", termsSwitchedAt: null } })
      : await tx.contract.create({ data: { testId, testerId: tester.id, ...snap } });
    await stampCounting(testId, tx); // (batch 14) the 3-change count starts
    if (old) await tx.termsOffer.updateMany({ where: { contractId: old.id, status: "open" }, data: { status: "superseded", decidedAt: new Date() } });
    // (Design doc 5) Each joining tester gets an access key (the key they had, if it still works, else the oldest free one).
    await assignKeyAtJoin(tx, testId, contract.id, body.keyStillWorks === true);
    await recordEvent(tx, testId, options.quietJoinEvent === true ? "auto_joined" : "joined", old ? `${displayName(tester)} joined again` : `${displayName(tester)} joined`, true, {}, contract.id);
    await tx.invite.updateMany({ where: { testId, testerId: tester.id, status: "sent" }, data: { status: "joined" } });
    // (Correction 4) The last spot taken: every other pending application and open invite closes, in this transaction.
    const filled = (await tx.contract.count({ where: working(testId) })) >= t.spots
      ? await closeOnFull(tx, testId, tester.id)
      : null;
    return { contract, dev, filled };
  });
  if (filled) await tellFull(filled);
  // (Owner, Oct 27) The developer who accepted an application made it happen themselves: no second "joined" line for it (the "applied" line was the notice).
  if (body.acceptedByDeveloper !== true) await notify(dev.email, `${displayName(tester)} joined “${contract.title}”`, [`${displayName(tester)} joined your test “${contract.title}”.`, `Their deal: ${termsLine(contract)}.`], `/app/tests/${testId}#tester-${contract.id}`, { about: tester.id });
  return contract;
}

// ---------- tester: session ----------

/** The tester's own contract, or a refusal. Nobody else's sessions can be read through this. */
export async function ownContract(testerId: string, contractId: string) {
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { test: { include: { developer: true } }, tester: true } });
  if (!c || c.testerId !== testerId) throw new HttpError(404, "not_found", "That session doesn't exist or isn't yours.");
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
  const c = await db.$transaction(async (tx) => {
    await lockTest(tx, c0.testId);
    const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    const refusal = sessionRefusal(c, { openUntil: null }, displayName(c0.test.developer));
    if (refusal) throw new HttpError(409, "gone", refusal === "You left this test." ? "You already left this test." : refusal);
    // (Owner, Oct 30, batch 15 section 25) Leave never stops: no tester gate (its confirm pop-up is built from the current state when opened).
    void body;
    await tx.contract.update({ where: { id: c.id }, data: { status: "left", endedAt: new Date() } });
    await cancelCallsAhead(tx, [c.id], `${displayName(tester)} left the test.`);
    await tx.callRequest.updateMany({ where: { contractId: c.id, status: "pending" }, data: { status: "closed", closedReason: "the tester left", decidedAt: new Date() } });
    await recordEvent(tx, c.testId, "left", `${displayName(tester)} left the test`, true, {}, c.id);
    return c;
  });
  await notify(c0.test.developer.email, `${displayName(tester)} left “${c.title}”`, [`${displayName(tester)} left your test “${c.title}”. Work they already sent still waits for your review.`], `/app/tests/${c.testId}#tester-${c.id}`, { about: tester.id });
  await spotOpened(c.testId);
  return { left: true };
}

/**
 * Send (or update, until it's paid) the written answers: one answer per question in the contract. Allowed even when
 * written answers aren't in the contract and after the deadline (shown as sent late).
 */
export async function sendWritten(tester: U, contractId: string, body: Record<string, unknown>) {
  const c0 = await ownContract(tester.id, contractId);
  // (Batch 27 section 1) An open new-terms offer blocks Send until it's answered (Switch or Keep): nothing is checked or sent before.
  await answerTermsFirst(contractId);
  const qs = writtenQuestions(c0);
  if ((await db.recording.count({ where: { contractId, part: "written", uploadedAt: null, createdAt: { gt: new Date(Date.now() - 3 * 3_600_000) } } })) || JSON.stringify([body.answers, body.notes]).includes("[Uploading ")) throw new HttpError(409, "uploading", "Wait for the upload to finish before sending.");
  const sentAnswers = Array.isArray(body.answers) ? body.answers.map((a) => (typeof a === "string" ? a.trim() : "")) : [];
  // (Batch 20 section 28) One answer per question of the contract, by position (a missing one is blank). (Batch 26 section 14) At least one question answered, plus
  // every Required one (the notes box alone doesn't count). The refusal names which question (`missing`), so the page marks it red there.
  const answers = qs.map((_, i) => sentAnswers[i] ?? "");
  // (Batch 30 §14) Each answer given is at least 50 characters (answerMin): "Each answer needs at least 50 characters." with which question (and how long it is).
  const missing = answersMissing(qs, answers, answerMin());
  if (missing) throw new HttpError(400, "bad_answers", missing.message, { missing: missing.at, ...(missing.chars != null ? { chars: missing.chars } : {}) });
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  // (Owner, Oct 29, batch 11) At most 10,000 characters for the whole written part (all its answers and notes together).
  const long = checkWrittenLength([...answers, notes]);
  if (!long.ok) throw new HttpError(400, "too_long", long.message);
  // (Owner, Oct 28 afternoon) No sending while the test is paused (the typed answers stay kept as a draft).
  if (!sessionRefusal(c0, c0.test, displayName(c0.test.developer)) && testerPaused(c0.test.developer, c0.test)) throw new HttpError(409, "paused", PAUSED_SEND);
  await testerSendGate(contractId, body);
  const name = displayName(tester), poss = pronouns(tester.pronoun).poss;
  const { sub, updated, afterPaid } = await db.$transaction(async (tx) => {
    const t = await lockTest(tx, c0.testId);
    const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    const refusal = sessionRefusal(c, t, displayName(c0.test.developer));
    if (refusal) throw new HttpError(409, "closed", refusal);
    const now = new Date();
    const existing = await tx.submission.findUnique({ where: { contractId_kind: { contractId, kind: "written" } }, include: { review: true } });
    // (Batch 30 §2) A paid part can be sent again (an updated version); only an old rejection or the team's $0 closure stays locked.
    const locked = resendRefusal(existing?.review, "written");
    if (locked) throw new HttpError(409, "paid", locked);
    const paid = !!existing?.review;
    // (Owner, Oct 29, batch 13 section 8) The whole set is stored: each question with its answer. Sending replaces the sent version; an earlier set it replaces (sent
    // for questions the tester has since switched away from) moves to the developer's "Previous questions and answers", and (DEFAULT) the new set is priced at the
    // current contract's written price.
    const items = itemsFor(qs, answers);
    const before = existing ? itemsOf(existing.answers, qs) : [];
    const replacesEarlier = !!existing && (!!existing.setUntil || !sameQuestions(before, items));
    // (Owner, Oct 28, batch 20 section 26) A resend identical to the last send (the same answers and notes, no new attachment) is refused: no new piece, no bell.
    if (existing && !replacesEarlier && items.every((x, i) => x.answer === before[i]?.answer) && notes === existing.notes
      && !(await tx.recording.count({ where: { contractId, part: "written", uploadedAt: { not: null }, submissionId: null } }))) throw new HttpError(409, "unchanged", NOTHING_CHANGED_LINE);
    // (Batch 30 §3) An update of a late piece stays late; one sent after the deadline is late (and Charge, if it had opened, no longer applies).
    const late = !!existing?.late || isLate(c.dueAt, now);
    const data = {
      answers: items as unknown as Prisma.InputJsonValue, notes, late, updatedAt: now,
      // (Batch 30 §2) An update of a paid piece keeps its price and review; it only marks the update (the developer's Pay more answers it).
      ...(paid ? { paidUpdateAt: now } : { payBy: payByFrom(now), ...(late ? { choiceOfferedAt: null, choiceBy: null } : {}) }),
      ...(replacesEarlier ? { setUntil: null, ...(paid ? {} : { agreedCents: c.writtenCents }), prevSets: pushPrev(prevSetsOf(existing!.prevSets), { until: (existing!.setUntil ?? now).toISOString(), items: before }) as unknown as Prisma.InputJsonValue } : {}),
    };
    const sub = existing
      ? await tx.submission.update({ where: { id: existing.id }, data })
      : await tx.submission.create({ data: { contractId, kind: "written", agreedCents: c.writtenCents, ...data } });
    // (Batch 11) Files and recordings attached to the written part go with it.
    await tx.recording.updateMany({ where: { contractId, part: "written", uploadedAt: { not: null } }, data: { submissionId: sub.id } });
    // (Batch 30 §2) An update after it was paid: below the cap it waits in Needs you (a "sent" line); at the cap a quiet line only.
    const afterPaid = paid ? await paidUpdateRoom(tx, sub.id, c.testId) : null;
    if (afterPaid) await recordEvent(tx, c.testId, afterPaid.atCap ? "sentpaid" : "sent", (afterPaid.atCap ? updatedAtCapLive : updatedAfterPaidLive)(name, poss, "written answers"), false, {}, c.id);
    else await recordEvent(tx, c.testId, "sent", `${name} ${existing ? "updated" : "sent"} ${poss} written answers`, false, {}, c.id);
    return { sub, updated: !!existing, afterPaid };
  });
  await notify(tester.email, `Work sent: your written answers for “${c0.title}”`, [`Your written answers were ${updated ? "updated" : "sent"} to ${displayName(c0.test.developer)}.`], `/app/sessions/${c0.id}#part-written`);
  if (afterPaid) await notifyPaidUpdate(c0, tester, sub.id, "written answers", afterPaid);
  else await notify(c0.test.developer.email, `${name} ${updated ? "updated" : "sent"} written answers for “${c0.title}”`, [`${name} ${updated ? "updated" : "sent"} ${poss} written answers${sub.late ? " (late)" : ""}. Review them and choose what to pay.`], `/app/tests/${c0.testId}#piece-${sub.id}`, { about: tester.id });
  return sub;
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
    where: { status: "open", openUntil: { lt: now }, OR: [{ invites: { some: { status: "sent" } } }, { id: { in: (await db.application.findMany({ where: { status: "pending" }, select: { testId: true }, distinct: ["testId"] })).map((a) => a.testId) } }] },
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
