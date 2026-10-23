import { devChanges, seenOf, tabOf, withRenamed } from "./live";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { displayName, fmtDate, fmtDateTime, pronouns, toCents } from "@/lib/format";
import { CATEGORIES, DEVICES, LANGUAGES } from "@/lib/options";
import {
  andList, changedTerms, checkAsk, checkListing, checkOpenUntilChange, contractSnapshot, editCheck, isLate, joinCheck, payByFrom, PAY_WAITS, testerRefusal, LISTING_FIELDS, mergeEdit, termsLine, type Listing, type TestEventLike,
} from "@/lib/rules";
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
  title: t.title as string, description: t.description as string, buildUrl: t.buildUrl as string, category: t.category as string,
  devices: t.devices as string[], languages: t.languages as string[], spots: t.spots as number,
  writtenCents: t.writtenCents as number | null, recordingCents: t.recordingCents as number | null,
  liveRateCents: t.liveRateCents as number | null, liveMinutes: t.liveMinutes as number | null,
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
  if (has("title")) out.title = str(body.title, 200);
  if (has("description")) out.description = str(body.description, 5000);
  if (has("buildUrl")) {
    out.buildUrl = str(body.buildUrl, 500);
    if (out.buildUrl && !/^https?:\/\//i.test(out.buildUrl)) throw new HttpError(400, "bad_url", "The build link must start with https://");
  }
  if (has("category")) out.category = CATEGORIES.includes(body.category as string) ? (body.category as string) : "";
  if (has("devices")) out.devices = list(body.devices, DEVICES);
  if (has("languages")) out.languages = list(body.languages, LANGUAGES);
  if (has("spots")) out.spots = int(body.spots);
  if (has("writtenCents")) out.writtenCents = price(body.writtenCents, "written answers price");
  if (has("recordingCents")) out.recordingCents = price(body.recordingCents, "recording price");
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

export async function createTest(dev: U, body: Record<string, unknown>) {
  if (!dev.isDeveloper) throw new HttpError(403, "not_developer", "Turn on “post tests” in your profile to post a test.");
  if (await devOnHold(dev.id)) throw new HttpError(409, "on_hold", `${PAY_WAITS} New tests can't be posted while payments are on hold.`);
  const l = parseListing(body) as Listing;
  const errs = checkListing(l);
  if (errs.length) throw new HttpError(400, "bad_listing", errs[0], { errors: errs });
  return db.test.create({ data: { ...listingData(l), developerId: dev.id, status: "open" } });
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
  let termsChanged = false;
  let switchedToAnyone = false;
  let changedNames: string[] = [];
  let reinvite = false;
  let spotsChanged = false;
  let switchedToInvite = false;
  const result = await db.$transaction(async (tx) => {
    const t = await lockTest(tx, testId);
    if (t.status === "stopped") throw new HttpError(409, "stopped", "This test was stopped.");
    const events = await tx.testEvent.findMany({ where: { testId, version: { gt: loaded } } });
    const gate = editCheck(loaded, t.version, events, confirmed);
    // (NEWEST+3) Save follows the same rule as the test page's buttons: every developer reason since Edit opened
    // (testers' actions, and anything saved or done in another tab), then any other change to the listing's version.
    const seen = seenOf(body.seenAt);
    const dc = !confirmed && seen ? withRenamed(await devChanges(dev.id, testId, seen, tabOf(body), tx), body) : [];
    if (dc.length) {
      throw new HttpError(409, "changed", "Press Save again to save your changes.", { changes: dc.map((c) => ({ text: c.text, at: c.createdAt })), version: t.version, current: asListing(t) });
    }
    if (!gate.go) {
      throw new HttpError(409, "changed", "This test changed since you opened Edit. Press Save again to save your changes on top.", {
        changes: gate.changes.map((c) => ({ text: c.text, at: c.createdAt })), version: t.version, current: asListing(t),
      });
    }
    const current = asListing(t);
    const next = mergeEdit(current, touched);
    const ou = checkOpenUntilChange(t.openUntil, next.openUntil ? new Date(next.openUntil) : null, new Date(), fmtDate);
    if (!ou.ok) throw new HttpError(409, "open_until_passed", ou.message);
    if (next.liveRateCents == null) next.liveMinutes = null;
    const testersIn = await tx.contract.count({ where: working(testId) });
    const errs = checkListing(next, testersIn);
    if (errs.length) throw new HttpError(400, "bad_listing", errs[0], { errors: errs });
    const terms = changedTerms(current, next);
    const fields = LISTING_FIELDS.filter((k) => JSON.stringify(current[k]) !== JSON.stringify(next[k]));
    if (!fields.length) return t;
    const what = fields.map((f) => FIELD_NAMES[f]).join(", ");
    termsChanged = terms.some((f) => ["writtenCents", "recordingCents", "liveRateCents", "liveMinutes", "deadlineDays", "questions"].includes(f));
    const listingFields = fields.filter((f) => f !== "spots");
    switchedToAnyone = fields.includes("joinMode") && next.joinMode === "anyone";
    await recordEvent(tx, testId, listingFields.length ? "edited" : "edited_spots", `The listing was edited: ${what}`, true, {
      ...listingData(next), ...(fields.includes("openUntil") ? { notified3d: false, notified1d: false } : {}), ...(listingFields.length ? { listingVersion: { increment: 1 } } : {}),
    });
    // (F) Listing info (description, devices, languages): shown to working testers and on the join page; stops once.
    const info = fields.filter((f) => INFO_FIELDS.includes(f));
    if (info.length) await tx.testEvent.create({ data: { testId, kind: "info", text: `${displayName(dev)} changed the ${andList(info.map((f) => FIELD_NAMES[f]))}` } });
    // A title change is info only everywhere (never stops; a press notes it).
    if (fields.includes("title")) await tx.testEvent.create({ data: { testId, kind: "renamed", text: `${displayName(dev)} renamed the test to ${next.title}` } });
    changedNames = fields.map((f) => FIELD_NAMES[f]);
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

/** (F) The listing info a working tester sees change live: title, description, devices, languages. */
export const INFO_FIELDS: (keyof Listing)[] = ["description", "devices", "languages"];
/** (Correction 2) The changes that close applications and re-send invites: prices / parts / questions, deadline, devices, languages, description. */
export const CLOSING_FIELDS: (keyof Listing)[] = ["writtenCents", "recordingCents", "liveRateCents", "liveMinutes", "questions", "deadlineDays", "devices", "languages", "description"];

const FIELD_NAMES: Record<keyof Listing, string> = {
  title: "title", description: "description", buildUrl: "build link", category: "category", devices: "devices", languages: "languages",
  openUntil: "Open until", joinMode: "who can join", spots: "spots", writtenCents: "written answers price", recordingCents: "recording price", liveRateCents: "live call rate",
  liveMinutes: "call length", deadlineDays: "deadline", questions: "questions",
};

export async function openDraft(dev: U, testId: string) {
  const t = await ownTest(dev.id, testId);
  if (t.status !== "draft") throw new HttpError(409, "not_draft", t.status === "stopped" ? "This test was stopped." : "This test is already open.");
  return db.$transaction((tx) => recordEvent(tx, testId, "opened", "The test opened for testers", true, { status: "open" }));
}

// ---------- developer: the top panel's big buttons (stop once) ----------

/**
 * The one stop-once gate for every developer button (top panel, live-call panel, Pay / Reject). If since the page loaded
 * (seenAt) any tester joined, left or sent work, a call was booked/confirmed/cancelled, times were offered/removed, or a
 * payment/rejection was made, the first press stops and returns the list; the second press (confirmed) goes ahead.
 */
export async function devGate(tx: Tx, testId: string, body: Record<string, unknown>, extra: Record<string, unknown> = {}, extraChanges: TestEventLike[] = []) {
  const seenAt = seenDate(body.seenAt);
  if (body.confirmed === true) return;
  const t = await tx.test.findUniqueOrThrow({ where: { id: testId }, select: { developerId: true } });
  const changes = withRenamed([...(await devChanges(t.developerId, testId, seenAt, tabOf(body), tx)), ...extraChanges].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()), body);
  if (changes.length) {
    throw new HttpError(409, "stop_once", "Press again to go ahead.", { changes: changes.map((c) => ({ text: c.text, at: c.createdAt })), ...extra });
  }
}

/** Is this developer on a payment hold? (All their tests are paused.) */
export async function devOnHold(devId: string) {
  const u = await db.user.findUnique({ where: { id: devId }, select: { holdStartedAt: true } });
  return !!u?.holdStartedAt;
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
  return ahead.map((c) => ({ email: c.contract.tester.email, startsAt: c.startsAt, contractId: c.contractId, title: c.contract.title }));
}

/** Tell each tester their booked call was cancelled (never any fault). */
export async function tellCancelled(list: { email: string; startsAt: Date; contractId: string; title: string }[], why: Parameters<typeof callCancelledLine>[1]) {
  for (const c of list) await notify(c.email, callCancelledLine(c.startsAt, why), [callCancelledLine(c.startsAt, why)], `/app/sessions/${c.contractId}`);
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
    await notify(c.tester.email, `“${c.title}” was stopped`, [`${displayName(dev)} stopped “${c.title}”. Your work on it has ended.`, "Work you already sent is still reviewed and paid. Calls ahead are cancelled."], `/app/sessions/${c.id}`);
  return { stopped: true, testers: contracts.length };
}

/** End one tester's work now. Work they sent is still reviewed; calls ahead are cancelled; later presses are refused. */
export async function endEarly(dev: U, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  const reason = str(body.reason, 500);
  if (reason.length < 5) throw new HttpError(400, "bad_reason", "Say why you're ending their work (they read it).");
  const contractId = String(body.contractId ?? "");
  let cancelled: Awaited<ReturnType<typeof cancelCallsAhead>> = [];
  const c = await db.$transaction(async (tx) => {
    await lockTest(tx, testId);
    const c = await tx.contract.findUnique({ where: { id: contractId }, include: { tester: true } });
    if (!c || c.testId !== testId) throw new HttpError(404, "not_found", "Choose a tester.");
    const name = displayName(c.tester);
    if (c.status === "left") throw new HttpError(409, "gone", `${name} already left the test.` + (await staleNote(testId, body.seenAt)));
    if (c.status !== "working") throw new HttpError(409, "gone", `${name}'s work already ended.` + (await staleNote(testId, body.seenAt)));
    await topPanelGate(tx, testId, body);
    await tx.contract.update({ where: { id: c.id }, data: { status: "ended", endKind: "early", endedAt: new Date(), endReason: reason } });
    cancelled = await cancelCallsAhead(tx, [c.id], "The developer ended the work early.");
    await tx.callRequest.updateMany({ where: { contractId: c.id, status: "pending" }, data: { status: "closed", closedReason: "the session ended", decidedAt: new Date() } });
    await recordEvent(tx, testId, "ended", `You ended ${name}'s work early`, false, {}, c.id);
    return c;
  });
  await tellCancelled(cancelled, "ended");
  await notify(c.tester.email, `Your work on “${c.title}” was ended early`, [`${displayName(dev)} ended your work on “${c.title}”: “${reason}”`, "Work you already sent is still reviewed and paid. Calls ahead are cancelled."], `/app/sessions/${c.id}`);
  await spotOpened(c.testId);
  return { ended: true };
}

/** Next round: a draft copy of the test for the next build. Optionally stops new testers joining this one. */
export async function nextRound(dev: U, testId: string, body: Record<string, unknown>) {
  await ownTest(dev.id, testId);
  let closedCalls: Awaited<ReturnType<typeof cancelCallsAhead>> = [];
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
    const close = body.closeThis !== false && t.status === "open";
    if (close) {
      const ids = (await tx.contract.findMany({ where: { testId, status: "working" }, select: { id: true } })).map((x) => x.id);
      closedCalls = await cancelCallsAhead(tx, ids, "The test was closed.");
      await tx.callSlot.updateMany({ where: { testId, status: "open" }, data: { status: "removed" } });
    }
    await recordEvent(tx, testId, "next_round", `Round ${round} was started${close ? "; this round stopped taking new testers" : ""}`, true, close ? { status: "closed" } : {});
    return { id: copy.id };
  });
  await tellCancelled(closedCalls, "closed");
  return res;
}

// ---------- tester: find and join ----------

/** Open tests the tester can join (not their own, not full, not already joined). */
export async function findTests(tester: U) {
  const tests = await db.test.findMany({
    where: { status: "open", developerId: { notIn: [tester.id, ...(await blockPartners(tester.id))] }, developer: { suspendedAt: null }, contracts: { none: { testerId: tester.id } }, OR: [{ joinMode: { not: "invite" } }, { invites: { some: { testerId: tester.id, status: "sent" } } }] },
    include: { _count: { select: { contracts: { where: { status: "working" } } } }, developer: { select: { name: true, email: true } } },
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

/** Why this tester's profile doesn't fit the test's needs, or "" when it does. */
export function needsGap(t: { devices: string[]; languages: string[] }, p: { devices: string[]; languages: string[] } | null) {
  if (t.devices.length && !t.devices.some((d) => p?.devices.includes(d))) return `This test needs one of: ${t.devices.join(", ")}. Add your device in your profile.`;
  if (t.languages.length && !t.languages.some((l) => p?.languages.includes(l))) return `This test needs one of: ${t.languages.join(", ")}. Add the language in your profile.`;
  return "";
}

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
    if (old && old.status === "ended" && !(await tx.invite.findFirst({ where: { testId, testerId: tester.id, status: "sent" } }))) throw new HttpError(409, "not_again", "You can't join this test again.");
    const dev = await tx.user.findUniqueOrThrow({ where: { id: t.developerId } });
    if (dev.suspendedAt) throw new HttpError(409, "closed", "This test isn't taking new testers any more.");
    if (dev.holdStartedAt) throw new HttpError(409, "paused", "This test is paused, so it isn't taking new testers right now.");
    const testersIn = await tx.contract.count({ where: working(testId) });
    const r = joinCheck({ status: t.status, listingVersion: t.listingVersion, spots: t.spots, testersIn, openUntil: t.openUntil }, seen, body.confirmed === true);
    if (r.result === "refused") throw new HttpError(409, "refused", r.message);
    if (r.result === "changed") {
      throw new HttpError(409, "listing_changed", "The developer changed this test since you opened it. Check the new terms, then press Join again to join on them.", {
        listingVersion: t.listingVersion, terms: termsLine(asListing(t), true), questions: t.questions,
      });
    }
    if (await tx.block.count({ where: { blockerId: tester.id, blockedId: t.developerId } })) throw new HttpError(409, "blocked", `You blocked ${displayName(dev)}: unblock them in Settings → Blocked people to join.`);
    if (await tx.block.count({ where: { blockerId: t.developerId, blockedId: tester.id } })) throw new HttpError(409, "closed", "This test isn't taking new testers right now.");
    const gap = needsGap(t, profile);
    if (gap && body.anyway !== true) throw new HttpError(409, "needs", `${gap.replace(/ Add .*$/, "")} You don't list it in your profile. Join anyway?`);
    const snap = contractSnapshot({ ...asListing(t), listingVersion: t.listingVersion }, new Date(), body.keepPrivate === true);
    const contract = old
      ? await tx.contract.update({ where: { id: old.id }, data: { ...snap, dueAt: rejoinDue(old.dueAt, old.endedAt, new Date()), status: "working", endKind: "", endedAt: null, endReason: "", termsSwitchedAt: null } })
      : await tx.contract.create({ data: { testId, testerId: tester.id, ...snap } });
    if (old) await tx.termsOffer.updateMany({ where: { contractId: old.id, status: "open" }, data: { status: "superseded", decidedAt: new Date() } });
    await recordEvent(tx, testId, "joined", old ? `${displayName(tester)} joined again` : `${displayName(tester)} joined`, true, {}, contract.id);
    await tx.invite.updateMany({ where: { testId, testerId: tester.id, status: "sent" }, data: { status: "joined" } });
    // (Correction 4) The last spot taken: every other pending application and open invite closes, in this transaction.
    const filled = (await tx.contract.count({ where: working(testId) })) >= t.spots ? await closeOnFull(tx, testId, tester.id) : null;
    return { contract, dev, filled };
  });
  if (filled) await tellFull(filled);
  await notify(dev.email, `${displayName(tester)} joined “${contract.title}”`, [`${displayName(tester)} joined your test “${contract.title}”.`, `Their deal: ${termsLine(contract)}.`], `/app/tests/${testId}`);
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
  await notify(c0.test.developer.email, `${displayName(tester)} left “${c.title}”`, [`${displayName(tester)} left your test “${c.title}”. Work they already sent still waits for your review.`], `/app/tests/${c.testId}`);
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
  if (answers.length !== qs.length || answers.some((a) => !a)) throw new HttpError(400, "bad_answers", "Answer every question before sending.");
  const notes = str(body.notes, 10_000);
  await testerTermsGate(contractId, displayName(c0.test.developer), body);
  const askedCents = body.ask === undefined || body.ask === null || body.ask === "" ? null : toCents(body.ask);
  if (body.ask && askedCents == null) throw new HttpError(400, "bad_ask", "Enter the amount you ask like 7.50, or leave it empty.");
  const askOk = checkAsk(askedCents);
  if (!askOk.ok) throw new HttpError(400, "bad_ask", askOk.message);
  const name = displayName(tester), poss = pronouns(tester.pronoun).poss;
  const { sub, updated } = await db.$transaction(async (tx) => {
    const t = await lockTest(tx, c0.testId);
    const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    const refusal = sessionRefusal(c, t, displayName(c0.test.developer));
    if (refusal) throw new HttpError(409, "closed", refusal);
    const now = new Date();
    const existing = await tx.submission.findUnique({ where: { contractId_kind: { contractId, kind: "written" } }, include: { review: true } });
    if (existing?.review) throw new HttpError(409, "paid", "Your written answers were already paid for, so they can't be changed. Send anything new in the chat.");
    const data = { answers, notes, late: isLate(c.dueAt, now), updatedAt: now, payBy: payByFrom(now), askedCents };
    const sub = existing
      ? await tx.submission.update({ where: { id: existing.id }, data })
      : await tx.submission.create({ data: { contractId, kind: "written", agreedCents: c.writtenCents, ...data } });
    await recordEvent(tx, c.testId, "sent", `${name} ${existing ? "updated" : "sent"} ${poss} written answers`, false, {}, c.id);
    return { sub, updated: !!existing };
  });
  await notify(tester.email, `Work sent: your written answers for “${c0.title}”`, [`Your written answers were ${updated ? "updated" : "sent"} to ${displayName(c0.test.developer)}.`], `/app/sessions/${c0.id}`);
  await notify(c0.test.developer.email, `${name} ${updated ? "updated" : "sent"} written answers for “${c0.title}”`, [`${name} ${updated ? "updated" : "sent"} ${poss} written answers${sub.late ? " (late)" : ""}. Review them and choose what to pay.`], `/app/tests/${c0.testId}`);
  return sub;
}

export const eventLine = (e: { text: string; createdAt: Date }) => `${e.text} · ${fmtDateTime(e.createdAt)}`;
