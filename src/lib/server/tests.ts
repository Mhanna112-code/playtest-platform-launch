import { devChanges, seenOf, tabOf, withRenamed } from "./live";
import { qOptional } from "@/lib/questions";
import { overLimitText } from "@/lib/capacity";
import { LIMITS, criticalLine, isCritical } from "@/lib/limits";
import { alertOf } from "@/lib/alerts";
import { applyKeyChange, assignKeyAtJoin, checkTypedKeys, planKeyChange } from "./accessKeys";
import { keyNeedLine, parseKeys } from "@/lib/keys";
import { testerCapacity } from "./capacity";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, pronouns, toCents } from "@/lib/format";
import { CATEGORIES, DEVICES, LANGUAGES } from "@/lib/options";
import {
  andList, testPaused, openUntilShortened, changedTerms, checkListing, checkOpenUntilChange, contractSnapshot, editCheck, isLate, joinCheck, payByFrom, PAY_WAITS, testerRefusal, LISTING_FIELDS, mergeEdit, termsLine, type Listing, type TestEventLike,
} from "@/lib/rules";
import { gapsOf, gapsUnseen, noGaps, readGaps } from "@/lib/gaps";
import { HttpError } from "./http";
import { notify } from "./notify";
import { offerNewTerms, testerTermsGate } from "./terms";
import { testerGate } from "./testerGate";
import { blockPartners } from "./blocks";
import { callCancelledLine } from "@/lib/rules";

type Tx = Prisma.TransactionClient;
type U = { id: string; email: string; name: string; pronoun: string; isDeveloper: boolean; isTester: boolean };

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
export const writtenQuestions = (c: { questions: unknown }) => {
  const qs = (c.questions as string[]) ?? [];
  return qs.length ? qs : ["Your feedback"];
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown, allowed: string[]) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && allowed.includes(x)))] : []);
const int = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN);
/** A price field: null/"" = not offered; "0" = free; "7.50" = $7.50. */
function price(v: unknown, label: string): number | null {
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
  if (has("description")) out.description = str(body.description, 5000);
  if (has("mature")) out.mature = body.mature === true;
  if (has("matureWhy")) out.matureWhy = str(body.matureWhy, 1000);
  if (has("ndaText")) out.ndaText = typeof body.ndaText === "string" ? body.ndaText.replace(/\r\n/g, "\n").trim().slice(0, 30_000) : "";
  if (has("buildUrl")) {
    out.buildUrl = str(body.buildUrl, 500);
    if (out.buildUrl && !/^https?:\/\//i.test(out.buildUrl)) throw new HttpError(400, "bad_url", "The build link must start with https://");
  }
  if (has("categories")) out.categories = list(body.categories, CATEGORIES);
  if (has("devices")) out.devices = list(body.devices, DEVICES);
  if (has("languages")) out.languages = list(body.languages, LANGUAGES);
  if (has("spots")) out.spots = int(body.spots);
  if (has("writtenCents")) out.writtenCents = price(body.writtenCents, "written answers price");
  if (has("recordingCents")) out.recordingCents = price(body.recordingCents, "recording price");
  if (has("writtenRequired")) out.writtenRequired = body.writtenRequired === true;
  if (has("recordingRequired")) out.recordingRequired = body.recordingRequired === true;
  if (has("liveRequired")) out.liveRequired = body.liveRequired === true;
  if (has("liveRateCents")) out.liveRateCents = price(body.liveRateCents, "live call rate");
  if (has("liveMinutes")) out.liveMinutes = body.liveMinutes === null || body.liveMinutes === "" ? null : int(body.liveMinutes);
  if (has("deadlineDays")) out.deadlineDays = int(body.deadlineDays);
  if (has("joinMode")) out.joinMode = ["anyone", "apply", "invite"].includes(body.joinMode as string) ? (body.joinMode as string) : "anyone";
  if (has("openUntil")) {
    const v = str(body.openUntil, 40);
    out.openUntil = v ? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.000Z` : v) : null;
  }
  if (has("questions")) out.questions = Array.isArray(body.questions) ? body.questions.filter((q): q is string => typeof q === "string").map((q) => q.trim().slice(0, 500)).filter(Boolean) : [];
  return out;
}

export async function lockTest(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${id} FOR UPDATE`;
  const t = await tx.test.findUnique({ where: { id } });
  if (!t) throw new HttpError(404, "not_found", "This test was deleted.");
  return t;
}

/** Record what happened. bump=true moves the test's version on (Edit's Save will notice). */
export async function recordEvent(tx: Tx, testId: string, kind: string, text: string, bump: boolean, extra: Prisma.TestUpdateInput = {}, contractId: string | null = null) {
  let version: number | null = null;
  if (bump || Object.keys(extra).length) {
    const t = await tx.test.update({ where: { id: testId }, data: { ...(bump ? { version: { increment: 1 } } : {}), ...extra } });
    if (bump) version = t.version;
  }
  await tx.testEvent.create({ data: { testId, kind, text, version, contractId } });
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

export async function tellFull(f: { title: string; testId: string; dev: string; apps: string[]; invites: string[] }) {
  for (const e of f.apps) if (e) await notify(e, `${f.title} is full, so your application was closed.`, [`${f.title} is full, so your application was closed.`], `/app/find/${f.testId}`);
  for (const e of f.invites) if (e) await notify(e, fullInviteLine(f.title), [fullInviteLine(f.title)], `/app/find/${f.testId}`);
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
  for (const p of people) await notify(p.email, spotOpenLine(t.title, displayName(t.developer)), [spotOpenLine(t.title, displayName(t.developer))], `/app/find/${testId}`);
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

export async function createTest(dev: U, body: Record<string, unknown>) {
  if (!dev.isDeveloper) throw new HttpError(403, "not_developer", "Turn on “post tests” in your profile to post a test.");
  if (await devOnHold(dev.id)) throw new HttpError(409, "on_hold", `${PAY_WAITS} New tests can't be posted while payments are on hold.`);
  const l = parseListing(body) as Listing;
  if (!l.mature) l.matureWhy = "";
  const now = new Date();
  const errs = checkListing(l, 0, now, { openedAt: now, confirmedHigh: confirmedHighOf(body) });
  // (NEWEST+9) Spots up to the developer's tester capacity.
  const cap = await testerCapacity(dev.id);
  if (Number.isInteger(l.spots) && l.spots > cap.limit && !errs.some((e) => e.startsWith("Spots"))) errs.push(overLimitText(cap.limit));
  // (Design doc 4) With access keys, there must be at least as many keys as open spots.
  const keys = checkTypedKeys(body.accessKeys);
  if (keys.length && Number.isInteger(l.spots) && keys.length < l.spots) errs.push(keyNeedLine(l.spots, keys.length));
  if (errs.length) throw new HttpError(400, "bad_listing", errs[0], { errors: errs });
  return db.$transaction(async (tx) => {
    const t = await tx.test.create({ data: { ...listingData(l), developerId: dev.id, status: "open" } });
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
  // (Design doc 5) Access keys: the keys added and the free keys removed in this tab (applied on top of the newest keys).
  const keysAdd = checkTypedKeys(body.keysAdd);
  const keysRemove = parseKeys(body.keysRemove);
  let termsChanged = false;
  let switchedToAnyone = false;
  let changedNames: string[] = [];
  let reinvite = false;
  let spotsChanged = false;
  let switchedToInvite = false;
  const cap = await testerCapacity(dev.id);
  const result = await db.$transaction(async (tx) => {
    const t = await lockTest(tx, testId);
    if (t.status === "stopped") throw new HttpError(409, "stopped", "This test was stopped.");
    const events = await tx.testEvent.findMany({ where: { testId, version: { gt: loaded } } });
    // (Owner) A second Save goes ahead only if nothing new happened since its box last updated (boxAt).
    const boxAt = confirmed ? seenOf(body.boxAt) : null;
    const newSinceBox = boxAt ? events.filter((e) => e.createdAt > boxAt) : [];
    const gate = boxAt ? (newSinceBox.length ? { go: false as const, changes: newSinceBox } : { go: true as const }) : editCheck(loaded, t.version, events, confirmed);
    // (NEWEST+3) Save follows the same rule as the test page's buttons: every developer reason since Edit opened
    // (testers' actions, and anything saved or done in another tab), then any other change to the listing's version.
    const seen = boxAt ?? (confirmed ? null : seenOf(body.seenAt));
    const dc = seen ? withRenamed(await devChanges(dev.id, testId, seen, tabOf(body), tx), body) : [];
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
    const errs = checkListing(next, testersIn, new Date(), { changed: new Set(fields), openedAt: t.createdAt, edit: true, confirmedHigh: confirmedHighOf(body), saved: { writtenCents: t.writtenCents, recordingCents: t.recordingCents } });
    if (fields.includes("openUntil")) { const short = openUntilShortened(current.openUntil, next.openUntil, fmtDate); if (short) errs.push(short); }
    // (NEWEST+9) Raising spots above the capacity is refused; a test already above it keeps its spots.
    if (Number.isInteger(next.spots) && next.spots > current.spots && next.spots > cap.limit && !errs.some((e) => e.startsWith("Spots"))) errs.push(overLimitText(cap.limit));
    const critical = fields.filter(isCritical);
    const everJoined = (await tx.contract.count({ where: { testId } })) > 0;
    if (critical.length && everJoined && t.criticalChanges >= LIMITS.criticalChanges) errs.push(criticalLine(t.criticalChanges));
    const plan = await planKeyChange(tx, testId, keysAdd, keysRemove, next.spots);
    const keyErrs = [...plan.errors, ...(plan.need ? [plan.need] : [])];
    errs.push(...keyErrs);
    const keysChanged = plan.toAdd.length > 0 || plan.removable.length > 0;
    const stop = dc.length ? dc.map((c) => devLine(c, false)) : !gate.go ? gate.changes.map((c) => ({ text: c.text, at: c.createdAt })) : null;
    if (stop) {
      // Both together: the blue stop and any red mistakes (red wins: the next press still saves nothing while red remains).
      throw new HttpError(409, "changed", dc.length ? "Press Save again to save." : "This test changed since you opened Edit. Press Save again to save your changes on top.", {
        changes: stop, version: t.version, criticalChanges: t.criticalChanges, current, listingEdited, errors: errs, keys: await keysState(tx, testId), critical: critical.length ? critical : undefined,
      });
    }
    if (errs.length) throw new HttpError(400, "bad_listing", errs[0], { errors: errs, critical: critical.length && everJoined && t.criticalChanges >= LIMITS.criticalChanges ? critical : undefined });
    if (!fields.length && !keysChanged) return t;
    const terms = changedTerms(current, next);
    const what = [...fields.map((f) => FIELD_NAMES[f]), ...(keysChanged ? ["access keys"] : [])].join(", ");
    termsChanged = terms.some((f) => ["writtenCents", "recordingCents", "liveRateCents", "liveMinutes", "writtenRequired", "recordingRequired", "liveRequired", "deadlineDays", "questions", "ndaText"].includes(f));
    // (NEWEST+12) Testers are alerted to EVERY change except the number of spots and Open until: those two never make an "edited" line / bump the listing version.
    const listingFields = fields.filter((f) => f !== "spots" && f !== "openUntil");
    switchedToAnyone = fields.includes("joinMode") && next.joinMode === "anyone";
    await recordEvent(tx, testId, listingFields.length ? "edited" : "edited_spots", `The listing was edited: ${listingFields.length ? listingFields.map((f) => FIELD_NAMES[f]).join(", ") : what}`, true, {
      ...listingData(next), ...(fields.includes("openUntil") ? { notified3d: false, notified1d: false } : {}), ...(listingFields.length ? { listingVersion: { increment: 1 } } : {}),
      // (5) A save that changed a critical field after the first tester joined counts as one of the three.
      ...(critical.length && everJoined ? { criticalChanges: { increment: 1 } } : {}),
    });
    if (keysChanged) {
      await applyKeyChange(tx, testId, plan.toAdd, plan.removable);
    }
    // (F) Listing info (description, devices, languages): shown to working testers and on the join page; stops once.
    const info = fields.filter((f) => INFO_FIELDS.includes(f));
    if (info.length) await tx.testEvent.create({ data: { testId, kind: "info", text: `${displayName(dev)} changed ${andList(info.map((f) => (f === "joinMode" ? FIELD_NAMES[f] : `the ${FIELD_NAMES[f]}`)))}` } });
    // A title change is info only everywhere (never stops; a press notes it).
    if (fields.includes("title")) await tx.testEvent.create({ data: { testId, kind: "renamed", text: `${displayName(dev)} renamed the test to ${next.title}` } });
    changedNames = [...fields.map((f) => FIELD_NAMES[f]), ...(keysChanged ? ["access keys"] : [])];
    reinvite = fields.some((f) => CLOSING_FIELDS.includes(f));
    spotsChanged = fields.includes("spots");
    switchedToInvite = fields.includes("joinMode") && next.joinMode === "invite";
    return tx.test.findUniqueOrThrow({ where: { id: testId } });
  });
  // Working testers are OFFERED the new contract terms (Switch / Keep); their contract changes only if they switch.
  const offered = termsChanged ? await offerNewTerms(testId) : 0;
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
  return Object.assign(result, { offered, changed: changedNames, notReinvited, resent, closedApps });
}

/** The access keys as an Edit tab needs them to tell what changed elsewhere (the free keys and how many are in use). */
async function keysState(tx: Tx, testId: string) {
  const keys = await tx.accessKey.findMany({ where: { testId }, orderBy: { createdAt: "asc" } });
  return { free: keys.filter((k) => k.status === "free").map((k) => k.value), inUse: keys.filter((k) => k.status === "inuse" || k.status === "broken").length };
}

/** (F) The listing info a working tester sees change live: title, description, devices, languages. */
export const INFO_FIELDS: (keyof Listing)[] = ["description", "devices", "languages", "buildUrl", "categories", "joinMode", "productName", "mature", "matureWhy"];
/** (Correction 2) The changes that close applications and re-send invites: prices / parts / questions, deadline, devices, languages, description. */
export const CLOSING_FIELDS: (keyof Listing)[] = ["ndaText", "writtenCents", "recordingCents", "liveRateCents", "liveMinutes", "writtenRequired", "recordingRequired", "liveRequired", "questions", "deadlineDays", "devices", "languages", "description"];

const FIELD_NAMES: Record<keyof Listing, string> = {
  productName: "product name", mature: "Mature (18+) box", matureWhy: "Mature (18+) note", ndaText: "NDA",
  title: "title", description: "description", buildUrl: "build link", categories: "categories", devices: "devices", languages: "languages",
  openUntil: "Open until", joinMode: "who can join", spots: "spots", writtenCents: "written answers price", writtenRequired: "written answers required", recordingRequired: "recording required", liveRequired: "live call required", recordingCents: "recording price", liveRateCents: "live call rate",
  liveMinutes: "call length", deadlineDays: "deadline", questions: "questions",
};

export async function openDraft(dev: U, testId: string, body: Record<string, unknown> = {}) {
  const t = await ownTest(dev.id, testId);
  await devGateIfSeen(testId, body);
  if (t.status !== "draft") throw new HttpError(409, "not_draft", t.status === "stopped" ? "This test was stopped." : "This test is already open.");
  return db.$transaction((tx) => recordEvent(tx, testId, "opened", "The test opened for testers", true, { status: "open" }));
}

// ---------- developer: the top panel's big buttons (stop once) ----------

/**
 * The one stop-once gate for every developer button (top panel, live-call panel, Pay / Reject). If since the page loaded
 * (seenAt) any tester joined, left or sent work, a call was booked/confirmed/cancelled, times were offered/removed, or a
 * payment/rejection was made, the first press stops and returns the list; the second press (confirmed) goes ahead.
 */
/**
 * One line of a developer's stop-once box. (Owner, Oct 28) A tester's Switch / Keep line carries its contract, so the box under the button shows "See their contract" like the top box.
 */
export const devLine = (c: TestEventLike & { contractId?: string | null }, withAlert = true) => ({
  text: c.text, at: c.createdAt, ...(c.kind === "terms" && c.contractId ? { kind: "terms", contract: c.contractId } : {}), ...(withAlert && alertOf(c.kind) ? { alert: alertOf(c.kind) } : {}),
});

export async function devGate(tx: Tx, testId: string, body: Record<string, unknown>, extra: Record<string, unknown> = {}, extraChanges: TestEventLike[] = [], keep?: (e: TestEventLike) => boolean) {
  // (Owner) The second press goes ahead only if nothing new happened since the box last updated (boxAt).
  const boxAt = seenOf(body.boxAt);
  if (body.confirmed === true && !boxAt) return;
  const seenAt = body.confirmed === true && boxAt ? boxAt : seenDate(body.seenAt);
  if (body.confirmed === true) extraChanges = extraChanges.filter((c) => c.createdAt > seenAt);
  const t = await tx.test.findUniqueOrThrow({ where: { id: testId }, select: { developerId: true } });
  const raw = [...(await devChanges(t.developerId, testId, seenAt, tabOf(body), tx)), ...extraChanges].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  // (Owner, Oct 28) `keep`: a button that stops for only some kinds (Rate after the test closed).
  const changes = withRenamed(keep ? raw.filter((e) => e.kind === "renamed" || keep(e)) : raw, body);
  if (changes.length) {
    throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes: changes.map((c) => devLine(c)), ...extra });
  }
}

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
export async function devGateIfSeen(testId: string, body: Record<string, unknown>) {
  if (seenOf(body.seenAt)) await db.$transaction((tx) => devGate(tx, testId, body));
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
  let cancelled: Awaited<ReturnType<typeof cancelCallsAhead>> = [];
  const contracts = await db.$transaction(async (tx) => {
    const t = await lockTest(tx, testId);
    if (t.status === "stopped") throw new HttpError(409, "stopped", "This test was stopped." + (await staleNote(testId, body.seenAt)));
    await topPanelGate(tx, testId, body);
    const cs = await tx.contract.findMany({ where: working(testId), include: { tester: true } });
    await tx.contract.updateMany({ where: working(testId), data: { status: "ended", endKind: "stopped", endedAt: new Date(), endReason: "The developer stopped the test." } });
    cancelled = await cancelCallsAhead(tx, cs.map((c) => c.id), "The test was stopped.");
    await tx.callRequest.updateMany({ where: { contractId: { in: cs.map((c) => c.id) }, status: "pending" }, data: { status: "closed", closedReason: "the test was stopped", decidedAt: new Date() } });
    await tx.callSlot.updateMany({ where: { testId, status: "open" }, data: { status: "removed" } });
    await recordEvent(tx, testId, "stopped", "The test was stopped", true, { status: "stopped", stoppedAt: new Date() });
    return cs;
  });
  await tellCancelled(cancelled, "stopped");
  for (const c of contracts)
    await notify(c.tester.email, `“${c.title}” was stopped`, [`${displayName(dev)} stopped “${c.title}”. Your work on it has ended.`, "Work you already sent is still reviewed and paid. Calls ahead are cancelled."], `/app/sessions/${c.id}`, { group: "tstopped" });
  return { stopped: true, testers: contracts.length };
}

/**
 * End the ticked testers' work now. Work they sent is still reviewed; calls ahead are cancelled; later presses are refused.
 * (`contractIds`: the ticks; `contractId` still works for one.) If any ticked tester is already out, nothing is ended and
 * the refusal names them.
 */
export async function endEarly(dev: U, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  const reason = str(body.reason, 500);
  if (reason.length < 5) throw new HttpError(400, "bad_reason", "Say why you're ending their work (they read it).");
  const ids = [...new Set((Array.isArray(body.contractIds) ? body.contractIds : [body.contractId]).map((x) => String(x ?? "")).filter(Boolean))];
  if (!ids.length) throw new HttpError(400, "none", "Tick at least one tester.");
  let cancelled: Awaited<ReturnType<typeof cancelCallsAhead>> = [];
  const ended = await db.$transaction(async (tx) => {
    const lockedTest = await lockTest(tx, testId);
    // (Owner) After a stop, a stale press fails and names the stop.
    if (lockedTest.status === "stopped") throw new HttpError(409, "stopped", "This test was stopped." + (await staleNote(testId, body.seenAt)));
    const list = [];
    for (const id of ids) {
      const c = await tx.contract.findUnique({ where: { id }, include: { tester: true } });
      if (!c || c.testId !== testId) throw new HttpError(404, "not_found", "Choose a tester.");
      const name = displayName(c.tester);
      if (c.status === "left") throw new HttpError(409, "gone", `${name} already left the test.` + (await staleNote(testId, body.seenAt)));
      if (c.status !== "working") throw new HttpError(409, "gone", `${name}'s work already ended.` + (await staleNote(testId, body.seenAt)));
      list.push(c);
    }
    await topPanelGate(tx, testId, body);
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
  return { ended: true, count: ended.length };
}

/** Next round: a draft copy of the test for the next build. Optionally stops new testers joining this one. */
export async function nextRound(dev: U, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  const res = await db.$transaction(async (tx) => {
    const t = await lockTest(tx, testId);
    if (t.status === "stopped") throw new HttpError(409, "stopped", "This test was stopped." + (await staleNote(testId, body.seenAt)));
    const existing = await tx.test.findFirst({ where: { previousId: testId } });
    if (existing) throw new HttpError(409, "exists", "This test already has a next round." + (await staleNote(testId, body.seenAt)), { id: existing.id });
    if (await devOnHold(dev.id)) throw new HttpError(409, "on_hold", `${PAY_WAITS} Your tests are paused until then.`);
    await topPanelGate(tx, testId, body);
    const round = t.round + 1;
    const copy = await tx.test.create({
      data: {
        ...listingData(asListing(t)), title: `${t.title.replace(/ \(round \d+\)$/, "")} (round ${round})`, developerId: dev.id, status: "draft", round, previousId: t.id,
        questions: t.questions as Prisma.InputJsonValue,
      },
    });
    // (Owner) Starting a next round never changes this round: it keeps taking testers and everyone carries on.
    await recordEvent(tx, testId, "next_round", `Round ${round} was started`, true, {});
    return { id: copy.id };
  });
  return res;
}

// ---------- tester: find and join ----------

/** Open tests the tester can join (not their own, not full, not already joined). */
export async function findTests(tester: U) {
  const tests = await db.test.findMany({
    where: {
      status: "open", adminPausedAt: null, developerId: { notIn: [tester.id, ...(await blockPartners(tester.id))] }, developer: { suspendedAt: null, holdStartedAt: null },
      // Not joined, or LEFT (they can come back: not after rating, not if the developer ended them).
      contracts: { none: { testerId: tester.id, OR: [{ status: { not: "left" } }, { endKind: "rated" }] } },
      OR: [{ joinMode: { not: "invite" } }, { invites: { some: { testerId: tester.id, status: "sent" } } }],
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
  const message = `${needsLines(t, profile).join("\n")}\n${verb === "Ask" ? "Ask to rejoin" : verb} anyway?`;
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
export async function joinTest(tester: U, testId: string, body: Record<string, unknown>) {
  if (!tester.isTester) throw new HttpError(403, "not_tester", "Turn on “test apps, games and more” in your profile to join tests.");
  const profile = await db.testerProfile.findUnique({ where: { userId: tester.id } });
  const seen = Number(body.listingVersion);
  const { contract, dev, filled } = await db.$transaction(async (tx) => {
    const t = await lockTest(tx, testId);
    if (t.developerId === tester.id) throw new HttpError(409, "own", "You can't join your own test.");
    // (NEWEST+4) Rejoining: a tester who LEFT comes back on the current listing; one the developer ENDED only through
    // a new invite. Their old session is restored (work, reviews, payments, chat, disputes, call history).
    const old = await tx.contract.findUnique({ where: { testId_testerId: { testId, testerId: tester.id } } });
    if (old && old.status === "working") throw new HttpError(409, "already", "You've already joined this test.");
    // (NEWEST+5) A rating finishes the part for good: no rejoin ever.
    if (old && (await tx.rating.count({ where: { contractId: old.id } }))) throw new HttpError(409, "not_again", old.endKind === "rated" && old.status === "left" ? "You rated this test, so you can't join it again." : "You can't join this test again.");
    if (old && old.status === "ended" && body.rejoinAccepted !== true && !(await tx.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } }))) throw new HttpError(409, "not_again", "You can't join this test again.");
    const dev = await tx.user.findUniqueOrThrow({ where: { id: t.developerId } });
    if (testPaused(dev, t)) throw new HttpError(409, "paused", "This test is paused, so it isn't taking new testers right now.");
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
    const snap = contractSnapshot({ ...asListing(t), listingVersion: t.listingVersion }, new Date(), body.keepPrivate === true, ndaAt ?? new Date());
    const contract = old
      ? await tx.contract.update({ where: { id: old.id }, data: { ...snap, dueAt: rejoinDue(old.dueAt, old.endedAt, new Date()), status: "working", endKind: "", endedAt: null, endReason: "", termsSwitchedAt: null } })
      : await tx.contract.create({ data: { testId, testerId: tester.id, ...snap } });
    if (old) await tx.termsOffer.updateMany({ where: { contractId: old.id, status: "open" }, data: { status: "superseded", decidedAt: new Date() } });
    // (Design doc 5) Each joining tester gets an access key (the key they had, if it still works, else the oldest free one).
    await assignKeyAtJoin(tx, testId, contract.id, body.keyStillWorks === true);
    await recordEvent(tx, testId, "joined", old ? `${displayName(tester)} joined again` : `${displayName(tester)} joined`, true, {}, contract.id);
    await tx.invite.updateMany({ where: { testId, testerId: tester.id, status: "sent" }, data: { status: "joined" } });
    // (Correction 4) The last spot taken: every other pending application and open invite closes, in this transaction.
    const filled = (await tx.contract.count({ where: working(testId) })) >= t.spots ? await closeOnFull(tx, testId, tester.id) : null;
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

/** Why a tester's press can't happen any more (with the one line their page shows), or "". Late work is allowed. */
export function sessionRefusal(c: { status: string; endKind: string; endedAt: Date | null }, test: { openUntil: Date | null }, devName: string, now = new Date()) {
  return testerRefusal(c, test, devName, fmtDate, now);
}

export async function leaveTest(tester: U, contractId: string, body: Record<string, unknown> = {}) {
  const c0 = await ownContract(tester.id, contractId);
  const c = await db.$transaction(async (tx) => {
    await lockTest(tx, c0.testId);
    const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    const refusal = sessionRefusal(c, { openUntil: null }, displayName(c0.test.developer));
    if (refusal) throw new HttpError(409, "gone", refusal === "You left this test." ? "You already left this test." : refusal);
    await testerGate(tester.id, contractId, c.testId, body);
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
  const qs = writtenQuestions(c0);
  const answers = Array.isArray(body.answers) ? body.answers.map((a) => (typeof a === "string" ? a.trim().slice(0, 10_000) : "")) : [];
  // Only the required questions need an answer ("not required" ones may stay empty).
  if (answers.length !== qs.length || qs.some((q, i) => !qOptional(q) && !answers[i])) throw new HttpError(400, "bad_answers", "Answer every required question before sending.");
  const notes = str(body.notes, 10_000);
  await testerTermsGate(contractId, displayName(c0.test.developer), body);
  const name = displayName(tester), poss = pronouns(tester.pronoun).poss;
  const { sub, updated } = await db.$transaction(async (tx) => {
    const t = await lockTest(tx, c0.testId);
    const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    const refusal = sessionRefusal(c, t, displayName(c0.test.developer));
    if (refusal) throw new HttpError(409, "closed", refusal);
    const now = new Date();
    const existing = await tx.submission.findUnique({ where: { contractId_kind: { contractId, kind: "written" } }, include: { review: true } });
    if (existing?.review) throw new HttpError(409, "paid", "Your written answers were already paid for, so they can't be changed. Send anything new in the chat.");
    const data = { answers, notes, late: isLate(c.dueAt, now), updatedAt: now, payBy: payByFrom(now) };
    const sub = existing
      ? await tx.submission.update({ where: { id: existing.id }, data })
      : await tx.submission.create({ data: { contractId, kind: "written", agreedCents: c.writtenCents, ...data } });
    await recordEvent(tx, c.testId, "sent", `${name} ${existing ? "updated" : "sent"} ${poss} written answers`, false, {}, c.id);
    return { sub, updated: !!existing };
  });
  await notify(tester.email, `Work sent: your written answers for “${c0.title}”`, [`Your written answers were ${updated ? "updated" : "sent"} to ${displayName(c0.test.developer)}.`], `/app/sessions/${c0.id}#part-written`);
  await notify(c0.test.developer.email, `${name} ${updated ? "updated" : "sent"} written answers for “${c0.title}”`, [`${name} ${updated ? "updated" : "sent"} ${poss} written answers${sub.late ? " (late)" : ""}. Review them and choose what to pay.`], `/app/tests/${c0.testId}#piece-${sub.id}`, { about: tester.id });
  return sub;
}

export const eventLine = (e: { text: string; createdAt: Date }) => `${e.text} · ${fmtDateTime(e.createdAt)}`;
