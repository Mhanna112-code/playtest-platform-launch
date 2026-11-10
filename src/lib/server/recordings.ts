import { Moved, beforeLock } from "./pressRace";
import { recordingOwnText } from "./actionText";
import { additionTerms } from "./submissionAdditions";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { displayName, pronouns } from "@/lib/format";
import { HttpError } from "./http";
import { NO_RECORDING_TO_ADD, SENT_RECORDING_LOCKED } from "@/lib/rules";
import { overPressLine } from "@/lib/rules";
import { ATTACHMENT_TYPES, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_RECORDING_BYTES, MAX_RECORDINGS, deleteObject, deleteStored, headObject, isVideo, listStored, r2On, uploadTarget } from "./storage";
import { movedCheck, ownContract, partOver, pressRefusals, sawOf, sentPart, sessionRefusal, tellSent, tellSentByBell } from "./tests";
import type { Prisma } from "@prisma/client";
import { additionsOf } from "@/lib/additions";
import { testerSendGate } from "./terms";
import { resendRefusal } from "./paidUpdates";
import { attachmentTag, hasMarkerFor } from "@/lib/answerAttachments";
import { ATTACH_FORMATS_LINE, VIDEO_FORMATS_LINE, videoTypeOf } from "@/lib/videoFormats";

type U = Parameters<typeof tellSentByBell>[1];

/**
 * Start an upload: checks the session can still send, the size (500 MB) and the count (5 recordings per session). (Owner, Oct 29, batch 11) `part: "written"` attaches it
 * to the written part instead: a screen recording (the same limits) or a file (at most 5, 500 MB each: images, PDF, plain text, zip; batch 31 section 2, was 25 MB).
 */
export async function startRecording(tester: U, contractId: string, body: Record<string, unknown>) {
  const c = await ownContract(tester.id, contractId);
  const refusal = sessionRefusal(c, c.test, displayName(c.test.developer));
  if (refusal) throw new HttpError(409, "closed", overPressLine(c, "upload")); // (§363 / §364)
  const part = body.part === "written" ? "written" : "recording";
  const size = Number(body.size);
  const filename = (typeof body.filename === "string" ? body.filename : "recording").replace(/[^\w.\- ]/g, "_").slice(0, 120) || "recording";
  // (Owner, Nov 3) A video is one of the formats that play in the browser (MP4, WebM, MOV, M4V), by its name; any other video is refused with all of them named.
  const given = typeof body.contentType === "string" ? body.contentType.split(";")[0].trim().toLowerCase() : "";
  const videoType = videoTypeOf(filename, given);
  const type = videoType ?? given;
  const video = !!videoType;
  if (!video && (part !== "written" || isVideo(type) || !ATTACHMENT_TYPES.includes(type)))
    throw new HttpError(400, "bad_type", part === "written" && !isVideo(type) ? ATTACH_FORMATS_LINE : VIDEO_FORMATS_LINE);
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, "empty", "That file is empty.");
  if (video && size > MAX_RECORDING_BYTES) throw new HttpError(413, "too_large", "Recordings can be at most 500 MB.");
  if (!video && size > MAX_ATTACHMENT_BYTES) throw new HttpError(413, "too_large", "Files can be at most 500 MB.");
  const paid = await db.submission.findUnique({ where: { contractId_kind: { contractId, kind: part } }, include: { review: true } });
  // (Batch 30 §2; batch 35 §136) A paid part can still be added to (attachments included); only an old rejection or the team's $0 closure stays locked.
  const locked = resendRefusal(paid?.review, part);
  if (locked) throw new HttpError(409, "paid", locked);
  // (Owner, Oct 29, batch 13 section 7) The Recording part takes up to 5 recordings (a removed one frees its slot); videos attached to the written part count separately
  // (batch 11's limits: 5 videos and 5 files there).
  const mine = await db.recording.findMany({ where: { contractId, part: { in: ["recording", "written"] } }, select: { contentType: true, part: true, submissionId: true } });
  // (Batch 35 §136) Sent recordings count and can't be removed: with all 5 sent, the line doesn't offer Remove.
  if (video && part === "recording" && mine.filter((r) => r.part === "recording").length >= MAX_RECORDINGS) throw new HttpError(409, "too_many", mine.some((r) => r.part === "recording" && !r.submissionId) ? TOO_MANY_RECORDINGS : ALL_RECORDINGS_SENT);
  if (video && part === "written" && mine.filter((r) => r.part === "written" && isVideo(r.contentType)).length >= MAX_RECORDINGS) throw new HttpError(409, "too_many", `You can attach at most ${MAX_RECORDINGS} recordings to your written answers.`);
  // (Batch 15 section 41, M6) At most 3 GB of uploads per account a day.
  const today = (await db.recording.aggregate({ where: { contract: { testerId: tester.id }, createdAt: { gt: new Date(Date.now() - 86_400_000) } }, _sum: { sizeBytes: true } }))._sum.sizeBytes ?? 0;
  if (today + size > DAILY_UPLOAD_BYTES) throw new HttpError(429, "quota", UPLOAD_QUOTA_LINE);
  if (!video && mine.filter((r) => r.part === "written" && !isVideo(r.contentType)).length >= MAX_ATTACHMENTS) throw new HttpError(409, "too_many", `You can attach at most ${MAX_ATTACHMENTS} files to your written answers.`);
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")).toLowerCase() : ".mp4";
  const storageKey = `recordings/${contractId}/${randomBytes(12).toString("hex")}${ext}`;
  const rec = await db.recording.create({ data: { contractId, storageKey, filename, sizeBytes: size, contentType: type, part, aliveAt: new Date() } });
  // (Batch 35 §4) The short tag its marker carries ("[📎 map.png #k3f9]"): the end of its id, unique among the contract's uploads.
  const ids = (await db.recording.findMany({ where: { contractId }, select: { id: true } })).map((r) => r.id);
  return { recordingId: rec.id, tag: attachmentTag(rec.id, ids), uploadUrl: uploadTarget(rec.id, storageKey, size, type) };
}

export async function finishRecording(tester: U, contractId: string, body: Record<string, unknown>) {
  const c = await ownContract(tester.id, contractId);
  await (await import("./workWindow")).assertWorkOpen(db, c.testId, new Date(), "upload");
  const rec = await db.recording.findUnique({ where: { id: String(body.recordingId ?? "") } });
  if (!rec || rec.contractId !== contractId) throw new HttpError(404, "not_found", "That upload doesn't exist.");
  // (Batch 15 section 6) On R2 the browser uploaded straight to storage: check the real object. Missing, a different size from what was claimed, or over the limit:
  // the object and the row are deleted. (Local uploads already count their bytes as they arrive.)
  if (r2On()) {
    const head = await headObject(rec.storageKey);
    const limit = isVideo(rec.contentType) ? MAX_RECORDING_BYTES : MAX_ATTACHMENT_BYTES;
    if (!head || head.size !== rec.sizeBytes || head.size > limit) {
      if (head) await deleteObject(rec.storageKey);
      await db.recording.delete({ where: { id: rec.id } });
      throw new HttpError(409, "upload_unfinished", UPLOAD_UNFINISHED);
    }
  }
  await db.recording.update({ where: { id: rec.id }, data: { uploadedAt: new Date() } });
  return { ok: true };
}

/**
 * (Batch 31 section 2) An upload that failed in the browser (the PUT to storage or Done): its row and any partial file go at once, so a retry starts clean (the slot is
 * free, nothing shows as still uploading). Only this tester's own unfinished uploads; anything else is left alone.
 */
export async function abandonUpload(tester: U, contractId: string, body: Record<string, unknown>) {
  await ownContract(tester.id, contractId);
  const rec = await db.recording.findUnique({ where: { id: String(body.recordingId ?? "") } });
  if (!rec || rec.contractId !== contractId || rec.uploadedAt) return { abandoned: false };
  await db.recording.deleteMany({ where: { id: rec.id, uploadedAt: null } });
  await deleteStored(rec.storageKey);
  return { abandoned: true };
}

/** (Batch 15 section 41, M6) Uploads per account per day. */
export const DAILY_UPLOAD_BYTES = 3 * 1024 * 1024 * 1024;
export const UPLOAD_QUOTA_LINE = "You've uploaded a lot today. Try again tomorrow.";
/**
 * (Batch 15 section 41, M6) The daily job's clean-up: uploads not finished within 3 hours (row and file), then stored files whose row is gone. Returns how many files went.
 */
export async function purgeUploads(now = new Date()) {
  let n = 0;
  const stale = await db.recording.findMany({ where: { uploadedAt: null, createdAt: { lt: new Date(now.getTime() - 3 * 3_600_000) } }, select: { id: true, storageKey: true }, take: 1000 });
  for (const r of stale) {
    await deleteStored(r.storageKey);
    await db.recording.delete({ where: { id: r.id } }).catch(() => null);
    n++;
  }
  const keys = await listStored("recordings/").catch(() => [] as string[]);
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    const known = new Set((await db.recording.findMany({ where: { storageKey: { in: chunk } }, select: { storageKey: true } })).map((r) => r.storageKey));
    for (const k of chunk) if (!known.has(k)) { await deleteStored(k); n++; }
  }
  return n;
}

/** (Batch 15 section 6) An R2 upload whose stored object doesn't match what the browser claimed. */
export const UPLOAD_UNFINISHED = "That upload didn't finish properly. Try again.";
export const TOO_MANY_RECORDINGS = `You can add at most ${MAX_RECORDINGS} recordings. Remove one first.`;
/** (Batch 35 §136) All 5 recordings sent: none can be removed, so no more can be added. */
export const ALL_RECORDINGS_SENT = `You've sent ${MAX_RECORDINGS} recordings, the most this part takes.`;
export const STILL_UPLOADING = "A recording is still uploading. Send once it's done.";
/**
 * (Owner, Nov 5; was: any upload started in the last 3 hours) An unfinished upload counts as still uploading only while its page keeps saying so (every 20 s,
 * `uploadAlive`): one cut off by a reload or a closed tab stops holding Send within 2 minutes. The daily clean-up still removes it after 3 hours.
 */
const ALIVE_MS = 2 * 60_000;
export const stillUploading = (part: "recording" | "written") => ({ part, uploadedAt: null, aliveAt: { gt: new Date(Date.now() - ALIVE_MS) } });

/** (Owner, Nov 5) The uploading page's "still going": only this tester's own unfinished upload. */
export async function uploadAlive(tester: U, contractId: string, body: Record<string, unknown>) {
  await ownContract(tester.id, contractId);
  const n = await db.recording.updateMany({ where: { id: String(body.recordingId ?? ""), contractId, uploadedAt: null }, data: { aliveAt: new Date() } });
  return { alive: n.count === 1 };
}

/**
 * (Owner, Oct 29, batch 13 section 7) Remove a recording from the Recording part (with a confirm): one not sent yet is deleted and its slot is free at once.
 * (Batch 35 §136) One already sent is locked: refused.
 */
export async function removeRecording(tester: U, contractId: string, body: Record<string, unknown>) {
  const owned = await ownContract(tester.id, contractId);
  const rec = await db.recording.findUnique({ where: { id: String(body.recordingId ?? "") } });
  if (body.written === true) {
    if (!rec || rec.contractId !== contractId || rec.part !== "written") throw new HttpError(404, "not_found", "That file was already removed.");
    // A sent set owns its uploads for its full history. An unsubmitted upload can go once no kept draft uses its marker.
    // (Batch 35 §4) A marker (short "[📎 map.png #k3f9]" or the old long form) is resolved against the contract's uploads.
    const uploads = await db.recording.findMany({ where: { contractId }, select: { id: true, filename: true } });
    if (rec.submissionId || hasMarkerFor(JSON.stringify(owned.prevSets ?? null), rec.id, uploads)) return { removed: true, retained: true };
    const draft = await db.keptForm.findUnique({ where: { userId_key: { userId: tester.id, key: `written:${contractId}` } }, select: { data: true } });
    if (hasMarkerFor(JSON.stringify(draft?.data ?? {}), rec.id, uploads)) return { removed: true, retained: true };
    await db.recording.delete({ where: { id: rec.id } });
    await deleteStored(rec.storageKey);
    return { removed: true };
  }
  if (!rec || rec.contractId !== contractId || rec.part !== "recording") throw new HttpError(404, "not_found", "That recording was already removed.");
  // (Owner, Nov 3, batch 35 §136; replaces batch 13 §7's "a sent one stays until the next Send, which leaves it out") A sent recording is locked: never removed.
  if (rec.submissionId) throw new HttpError(409, "locked", SENT_RECORDING_LOCKED);
  await db.recording.delete({ where: { id: rec.id } });
  await deleteStored(rec.storageKey); // (batch 15 section 41, M6) the file goes too
  return { removed: true };
}

/**
 * (Owner, Nov 11, §375) Step 3 for a recording's Send / Add: pressRefusals, then its own: (batch 13 §7) a recording still uploading (all of them go together as
 * ONE piece, so a Send waits for it), then ((Owner, Nov 4, §183) an old rejection or the team's $0 closure, nothing new to add after a Send), so a press that
 * could only be refused is refused at once, never after a stop.
 */
const recordingRefusals = (q: Prisma.TransactionClient | typeof db, contractId: string, press: string) =>
  pressRefusals(q, contractId, press, async () => {
    if (await q.recording.count({ where: { contractId, ...stillUploading("recording") } })) return new HttpError(409, "uploading", STILL_UPLOADING);
    const sent = await sentPart(q, contractId, "recording");
    const shut = resendRefusal(sent?.review, "recording");
    if (shut) return new HttpError(409, "paid", shut);
    if (sent && !(await q.recording.count({ where: { contractId, part: "recording", submissionId: null, uploadedAt: { not: null } } }))) return new HttpError(400, "none", NO_RECORDING_TO_ADD);
    return null;
  });

/** Send the uploaded recordings (or send them again with new ones, until paid). */
export async function sendRecording(tester: U, contractId: string, body: Record<string, unknown> = {}): Promise<Awaited<ReturnType<typeof sendRecordingOnce>>> {
  try {
    return await sendRecordingOnce(tester, contractId, body);
  } catch (e) {
    if (!(e instanceof Moved)) throw e;
    // (Owner, Nov 10, §369) The transaction rolled back: the normal stop-once box for what moved (another tab's Send, a developer payment on the recording), as a
    // later press would get it. (Owner, Nov 11, §375) Every refusal comes first, as for a later press (never a stop whose second press could only be refused).
    const press = body.add === true ? "Add" : "Send";
    await partOver(db, contractId, press);
    await recordingRefusals(db, contractId, press);
    const sent = await sentPart(db, contractId, "recording");
    await testerSendGate(contractId, body, sent?.id, undefined, press);
    if (body.__moved !== true) return sendRecording(tester, contractId, { ...body, __moved: true });
    throw new HttpError(400, "none", NO_RECORDING_TO_ADD);
  }
}

/** (Owner, Nov 11, §375) One Send (or Add) of the recordings, in the owner's order (no typed text and no form: steps 2, 4 and 5 don't apply). */
async function sendRecordingOnce(tester: U, contractId: string, body: Record<string, unknown>) {
  const c0 = await ownContract(tester.id, contractId);
  const press = body.add === true ? "Add" : "Send";
  // 1. Their part is over or the test closed: refused.
  await partOver(db, contractId, press);
  // 3. The refusals: paused → an NDA change → new terms → a recording still uploading → rejected / the team's $0 closure / nothing new to add.
  await recordingRefusals(db, contractId, press);
  // 6. The tester's one gate ((Owner, Nov 4, §183) adding to a sent recording stops once for a developer payment on it since the page loaded, whatever the
  // tester's Alerts). What this press saw is noted first (§369: the sent part, or none, and what was paid on it).
  const sent = await sentPart(db, contractId, "recording");
  const saw = await sawOf(sent);
  await testerSendGate(contractId, body, sent?.id, undefined, press);

  const name = displayName(tester), poss = pronouns(tester.pronoun).poss;
  await beforeLock("recording-send");
  // 7. Under the test's lock: steps 1 and 3 again (a Save, a pause or a Leave while the press waited), then anything that moved since the first look (nothing
  // is written; sendRecording gives the box), then the save.
  const { updated, late, subId, afterPaid, n } = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c0.testId} FOR UPDATE`;
    await partOver(tx, contractId, press);
    await recordingRefusals(tx, contractId, press);
    const existing = await movedCheck(tx, contractId, saw, "recording");
    const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    // (Owner, Nov 3, batch 35 §136; replaces batch 13 §7's "send again" and batch 20 §26) Sent recordings are locked: a later Send ADDS the ones not sent yet
    // under them ("Added"); nothing new to add is refused.
    const fresh = await tx.recording.findMany({ where: { contractId, part: "recording", uploadedAt: { not: null }, submissionId: null }, select: { id: true } });
    if (!fresh.length) throw new HttpError(400, "none", existing ? NO_RECORDING_TO_ADD : "Upload a recording first.");
    const paid = !!existing?.review;
    const now = new Date();
    // Additions follow the shared price-freeze rule and preserve the original piece's status.
    const data = { updatedAt: now, ...additionTerms(existing, c, c.recordingCents, now) };
    const sub = existing
      ? await tx.submission.update({ where: { id: existing.id }, data: { ...data, additions: [...additionsOf(existing.additions), { at: now.toISOString(), files: fresh.map((r) => r.id) }] as unknown as Prisma.InputJsonValue } })
      // (Owner, Nov 5, §239) A recording takes no notes: a `notes` in the body is ignored and nothing is stored (the written part keeps its own).
      : await tx.submission.create({ data: { contractId, kind: "recording", agreedCents: c.recordingCents, ...data } });
    await tx.recording.updateMany({ where: { id: { in: fresh.map((r) => r.id) } }, data: { submissionId: sub.id } });
    const afterPaid = await tellSent(tx, { testId: c.testId, contractId: c.id, subId: sub.id, name, poss, part: "recording", added: !!existing, paid, n: fresh.length });
    await (await import("./live")).logAction(tester.id, c.testId, body, recordingOwnText(existing ? fresh.length : 0), undefined, tx); // (§369) with the save
    return { updated: !!existing, late: data.late, subId: sub.id, afterPaid, n: fresh.length };
  });
  await tellSentByBell(c0, tester, { id: subId, late }, "recording", updated, afterPaid, n);
  return { sent: true, ...(updated ? { added: n } : {}) };
}

/** Who may watch: the tester who made it, or the test's developer. */
export async function canView(userId: string, recordingId: string, admin = false) {
  const r = await db.recording.findUnique({ where: { id: recordingId }, include: { contract: { include: { test: true } } } });
  // (Batch 15 section 8) Admins (ADMIN_EMAILS, confirmed) can open the work in a dispute row's "See the work".
  if (!r || (!admin && r.contract.testerId !== userId && r.contract.test.developerId !== userId)) return null;
  return r;
}
