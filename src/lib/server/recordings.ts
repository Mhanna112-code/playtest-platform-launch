import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { displayName, pronouns } from "@/lib/format";
import { PAUSED_SEND, isLate, payByFrom, testerPaused } from "@/lib/rules";
import { HttpError } from "./http";
import { NO_RECORDING_TO_ADD, SENT_RECORDING_LOCKED } from "@/lib/rules";
import { ATTACHMENT_TYPES, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_RECORDING_BYTES, MAX_RECORDINGS, deleteObject, deleteStored, headObject, isVideo, listStored, r2On, uploadTarget } from "./storage";
import { ownContract, sessionRefusal, tellSent, tellSentByBell } from "./tests";
import type { Prisma } from "@prisma/client";
import { additionsOf } from "@/lib/additions";
import { answerTermsFirst, testerSendGate } from "./terms";
import { resendRefusal } from "./paidUpdates";
import { attachmentTag, hasMarkerFor } from "@/lib/answerAttachments";

type U = Parameters<typeof tellSentByBell>[1];

/**
 * Start an upload: checks the session can still send, the size (500 MB) and the count (5 recordings per session). (Owner, Oct 29, batch 11) `part: "written"` attaches it
 * to the written part instead: a screen recording (the same limits) or a file (at most 5, 500 MB each: images, PDF, plain text, zip; batch 31 section 2, was 25 MB).
 */
export async function startRecording(tester: U, contractId: string, body: Record<string, unknown>) {
  const c = await ownContract(tester.id, contractId);
  const refusal = sessionRefusal(c, c.test, displayName(c.test.developer));
  if (refusal) throw new HttpError(409, "closed", refusal);
  const part = body.part === "written" ? "written" : "recording";
  const size = Number(body.size);
  const type = typeof body.contentType === "string" ? body.contentType.split(";")[0].trim().toLowerCase() : "";
  const filename = (typeof body.filename === "string" ? body.filename : "recording").replace(/[^\w.\- ]/g, "_").slice(0, 120) || "recording";
  const video = isVideo(type);
  if (!video && (part !== "written" || !ATTACHMENT_TYPES.includes(type)))
    throw new HttpError(400, "bad_type", part === "written" ? "Attach an image, a PDF, a text file, a zip or a video." : "Choose a video file (for example .mp4 or .webm).");
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
  const rec = await db.recording.create({ data: { contractId, storageKey, filename, sizeBytes: size, contentType: type, part } });
  // (Batch 35 §4) The short tag its marker carries ("[📎 map.png #k3f9]"): the end of its id, unique among the contract's uploads.
  const ids = (await db.recording.findMany({ where: { contractId }, select: { id: true } })).map((r) => r.id);
  return { recordingId: rec.id, tag: attachmentTag(rec.id, ids), uploadUrl: uploadTarget(rec.id, storageKey, size, type) };
}

export async function finishRecording(tester: U, contractId: string, body: Record<string, unknown>) {
  const c = await ownContract(tester.id, contractId);
  await (await import("./workWindow")).assertWorkOpen(db, c.testId);
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
/** An upload started this recently and not finished counts as still uploading (an abandoned one stops blocking Send after this). */
const UPLOADING_MS = 3 * 3_600_000;

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

/** Send the uploaded recordings (or send them again with new ones, until paid). */
export async function sendRecording(tester: U, contractId: string, body: Record<string, unknown> = {}) {
  const c0 = await ownContract(tester.id, contractId);
  const ended = sessionRefusal(c0, c0.test, displayName(c0.test.developer));
  if (ended) throw new HttpError(409, "closed", ended);
  // (Owner, Oct 28 afternoon) No sending while the test is paused (uploads, the drafts, still work).
  if (!sessionRefusal(c0, c0.test, displayName(c0.test.developer)) && testerPaused(c0.test.developer, c0.test)) throw new HttpError(409, "paused", PAUSED_SEND);
  // (Batch 27 section 1) An open new-terms offer blocks Send until it's answered (Switch or Keep).
  await answerTermsFirst(contractId);
  await testerSendGate(contractId, body);

  const name = displayName(tester), poss = pronouns(tester.pronoun).poss;
  const { updated, late, subId, afterPaid, n } = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c0.testId} FOR UPDATE`;
    const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    const t = await tx.test.findUniqueOrThrow({ where: { id: c.testId } });
    await (await import("./workWindow")).assertWorkOpen(tx, t.id);
    const refusal = sessionRefusal(c, t, displayName(c0.test.developer));
    if (refusal) throw new HttpError(409, "closed", refusal);
    // (Batch 13 section 7) All of them go together as ONE piece; a Send from another tab while one is still uploading waits for it.
    if (await tx.recording.count({ where: { contractId, part: "recording", uploadedAt: null, createdAt: { gt: new Date(Date.now() - UPLOADING_MS) } } })) throw new HttpError(409, "uploading", STILL_UPLOADING);
    const existing = await tx.submission.findUnique({ where: { contractId_kind: { contractId, kind: "recording" } }, include: { review: true } });
    const locked = resendRefusal(existing?.review, "recording"); // (batch 30 §2) an old rejection or the team's closure only
    if (locked) throw new HttpError(409, "paid", locked);
    // (Owner, Nov 3, batch 35 §136; replaces batch 13 §7's "send again" and batch 20 §26) Sent recordings are locked: a later Send ADDS the ones not sent yet
    // under them ("Added"); nothing new to add is refused.
    const fresh = await tx.recording.findMany({ where: { contractId, part: "recording", uploadedAt: { not: null }, submissionId: null }, select: { id: true } });
    if (!fresh.length) throw new HttpError(400, "none", existing ? NO_RECORDING_TO_ADD : "Upload a recording first.");
    const paid = !!existing?.review;
    const now = new Date();
    // (Batch 30 §3) Added to a late piece, it stays late; sent or added after the deadline, it's late (Charge, if it had opened, no longer applies).
    const lateNow = !!existing?.late || isLate(c.dueAt, now);
    const data = { late: lateNow, updatedAt: now, ...(paid ? { paidUpdateAt: now } : { payBy: payByFrom(now), ...(lateNow ? { choiceOfferedAt: null, choiceBy: null } : {}) }) };
    const sub = existing
      ? await tx.submission.update({ where: { id: existing.id }, data: { ...data, additions: [...additionsOf(existing.additions), { at: now.toISOString(), files: fresh.map((r) => r.id) }] as unknown as Prisma.InputJsonValue } })
      : await tx.submission.create({ data: { contractId, kind: "recording", agreedCents: c.recordingCents, ...data } });
    await tx.recording.updateMany({ where: { id: { in: fresh.map((r) => r.id) } }, data: { submissionId: sub.id } });
    const afterPaid = await tellSent(tx, { testId: c.testId, contractId: c.id, subId: sub.id, name, poss, part: "recording", added: !!existing, paid, n: fresh.length });
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
