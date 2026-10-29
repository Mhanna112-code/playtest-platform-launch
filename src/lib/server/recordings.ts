import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { displayName, pronouns } from "@/lib/format";
import { PAUSED_SEND, isLate, payByFrom, testerPaused } from "@/lib/rules";
import { HttpError } from "./http";
import { NOTHING_CHANGED_LINE } from "@/lib/rules";
import { notify } from "./notify";
import { ATTACHMENT_TYPES, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_RECORDING_BYTES, MAX_RECORDINGS, deleteObject, deleteStored, headObject, isVideo, listStored, r2On, uploadTarget } from "./storage";
import { ownContract, recordEvent, sessionRefusal } from "./tests";
import { answerTermsFirst, testerSendGate } from "./terms";

type U = { id: string; email: string; name: string; pronoun: string };

/**
 * Start an upload: checks the session can still send, the size (500 MB) and the count (5 recordings per session). (Owner, Oct 29, batch 11) `part: "written"` attaches it
 * to the written part instead: a screen recording (the same limits) or a file (at most 5, 25 MB each: images, PDF, plain text, zip).
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
  if (!video && size > MAX_ATTACHMENT_BYTES) throw new HttpError(413, "too_large", "Files can be at most 25 MB.");
  const paid = await db.submission.findUnique({ where: { contractId_kind: { contractId, kind: part } }, include: { review: true } });
  if (paid?.review) throw new HttpError(409, "paid", part === "written" ? "Your written answers were already paid for, so they can't be changed. Send anything new in the chat." : "Your recording was already paid for, so it can't be changed. Send anything new in the chat.");
  // (Owner, Oct 29, batch 13 section 7) The Recording part takes up to 5 recordings (a removed one frees its slot); videos attached to the written part count separately
  // (batch 11's limits: 5 videos and 5 files there).
  const mine = await db.recording.findMany({ where: { contractId, part: { in: ["recording", "written"] } }, select: { contentType: true, part: true } });
  if (video && part === "recording" && mine.filter((r) => r.part === "recording").length >= MAX_RECORDINGS) throw new HttpError(409, "too_many", TOO_MANY_RECORDINGS);
  if (video && part === "written" && mine.filter((r) => r.part === "written" && isVideo(r.contentType)).length >= MAX_RECORDINGS) throw new HttpError(409, "too_many", `You can attach at most ${MAX_RECORDINGS} recordings to your written answers.`);
  // (Batch 15 section 41, M6) At most 3 GB of uploads per account a day.
  const today = (await db.recording.aggregate({ where: { contract: { testerId: tester.id }, createdAt: { gt: new Date(Date.now() - 86_400_000) } }, _sum: { sizeBytes: true } }))._sum.sizeBytes ?? 0;
  if (today + size > DAILY_UPLOAD_BYTES) throw new HttpError(429, "quota", UPLOAD_QUOTA_LINE);
  if (!video && mine.filter((r) => r.part === "written" && !isVideo(r.contentType)).length >= MAX_ATTACHMENTS) throw new HttpError(409, "too_many", `You can attach at most ${MAX_ATTACHMENTS} files to your written answers.`);
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")).toLowerCase() : ".mp4";
  const storageKey = `recordings/${contractId}/${randomBytes(12).toString("hex")}${ext}`;
  const rec = await db.recording.create({ data: { contractId, storageKey, filename, sizeBytes: size, contentType: type, part } });
  return { recordingId: rec.id, uploadUrl: uploadTarget(rec.id, storageKey, size, type) };
}

export async function finishRecording(tester: U, contractId: string, body: Record<string, unknown>) {
  await ownContract(tester.id, contractId);
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
export const STILL_UPLOADING = "A recording is still uploading. Send once it's done.";
/** An upload started this recently and not finished counts as still uploading (an abandoned one stops blocking Send after this). */
const UPLOADING_MS = 3 * 3_600_000;

/**
 * (Owner, Oct 29, batch 13 section 7) Remove a recording from the Recording part (with a confirm), until the part is paid or rejected. One not sent yet is deleted; one
 * already sent stays with the sent piece (the developer still sees it) until the next Send, which leaves it out. Either way its slot is free at once.
 */
export async function removeRecording(tester: U, contractId: string, body: Record<string, unknown>) {
  await ownContract(tester.id, contractId);
  const rec = await db.recording.findUnique({ where: { id: String(body.recordingId ?? "") } });
  if (!rec || rec.contractId !== contractId || rec.part !== "recording") throw new HttpError(404, "not_found", "That recording was already removed.");
  const sub = await db.submission.findUnique({ where: { contractId_kind: { contractId, kind: "recording" } }, include: { review: true } });
  if (sub?.review) throw new HttpError(409, "paid", sub.review.rejected ? "Your recording was already reviewed, so it can't be changed." : "Your recording was already paid for, so it can't be changed. Send anything new in the chat.");
  if (rec.submissionId) await db.recording.update({ where: { id: rec.id }, data: { part: "removed" } });
  else {
    await db.recording.delete({ where: { id: rec.id } });
    await deleteStored(rec.storageKey); // (batch 15 section 41, M6) the file goes too
  }
  return { removed: true };
}

/** Send the uploaded recordings (or send them again with new ones, until paid). */
export async function sendRecording(tester: U, contractId: string, body: Record<string, unknown> = {}) {
  const c0 = await ownContract(tester.id, contractId);
  // (Owner, Oct 28 afternoon) No sending while the test is paused (uploads, the drafts, still work).
  if (!sessionRefusal(c0, c0.test, displayName(c0.test.developer)) && testerPaused(c0.test.developer, c0.test)) throw new HttpError(409, "paused", PAUSED_SEND);
  // (Batch 27 section 1) An open new-terms offer blocks Send until it's answered (Switch or Keep).
  await answerTermsFirst(contractId);
  await testerSendGate(contractId, body);

  const name = displayName(tester), poss = pronouns(tester.pronoun).poss;
  const { updated, late, subId, gone: goneFiles } = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c0.testId} FOR UPDATE`;
    const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    const t = await tx.test.findUniqueOrThrow({ where: { id: c.testId } });
    const refusal = sessionRefusal(c, t, displayName(c0.test.developer));
    if (refusal) throw new HttpError(409, "closed", refusal);
    const recs = await tx.recording.findMany({ where: { contractId, part: "recording", uploadedAt: { not: null } } });
    // (Batch 13 section 7) All of them go together as ONE piece; a Send from another tab while one is still uploading waits for it.
    if (await tx.recording.count({ where: { contractId, part: "recording", uploadedAt: null, createdAt: { gt: new Date(Date.now() - UPLOADING_MS) } } })) throw new HttpError(409, "uploading", STILL_UPLOADING);
    if (recs.length === 0) throw new HttpError(400, "none", "Upload a recording first.");
    const existing = await tx.submission.findUnique({ where: { contractId_kind: { contractId, kind: "recording" } }, include: { review: true } });
    if (existing?.review) throw new HttpError(409, "paid", "Your recording was already paid for, so it can't be changed. Send anything new in the chat.");
    // (Owner, Oct 28, batch 20 section 26) Nothing added or removed since the last send: refused (no new piece, no bell).
    if (existing && recs.every((r) => r.submissionId === existing.id) && !(await tx.recording.count({ where: { contractId, part: "removed" } }))) throw new HttpError(409, "unchanged", NOTHING_CHANGED_LINE);
    const now = new Date();
    const data = { late: isLate(c.dueAt, now), updatedAt: now, payBy: payByFrom(now) };
    const sub = existing
      ? await tx.submission.update({ where: { id: existing.id }, data })
      : await tx.submission.create({ data: { contractId, kind: "recording", agreedCents: c.recordingCents, ...data } });
    await tx.recording.updateMany({ where: { contractId, part: "recording", uploadedAt: { not: null } }, data: { submissionId: sub.id } });
    // Recordings removed since the last Send leave the piece now (and storage: batch 15 section 41, M6).
    const gone = await tx.recording.findMany({ where: { contractId, part: "removed" }, select: { storageKey: true } });
    await tx.recording.deleteMany({ where: { contractId, part: "removed" } });
    await recordEvent(tx, c.testId, "sent", `${name} ${existing ? "updated" : "sent"} ${poss} recording`, false, {}, c.id);
    return { updated: !!existing, late: data.late, subId: sub.id, gone };
  });
  for (const g of goneFiles) await deleteStored(g.storageKey);
  await notify(tester.email, `Work sent: your recording for “${c0.title}”`, [`Your recording was ${updated ? "updated" : "sent"} to ${displayName(c0.test.developer)}.`], `/app/sessions/${c0.id}#part-recording`);
  await notify(c0.test.developer.email, `${name} ${updated ? "updated" : "sent"} a recording for “${c0.title}”`, [`${name} ${updated ? "updated" : "sent"} ${poss} screen recording${late ? " (late)" : ""}. Watch it and choose what to pay.`], `/app/tests/${c0.testId}#piece-${subId}`, { about: tester.id });
  return { sent: true };
}

/** Who may watch: the tester who made it, or the test's developer. */
export async function canView(userId: string, recordingId: string, admin = false) {
  const r = await db.recording.findUnique({ where: { id: recordingId }, include: { contract: { include: { test: true } } } });
  // (Batch 15 section 8) Admins (ADMIN_EMAILS, confirmed) can open the work in a dispute row's "See the work".
  if (!r || (!admin && r.contract.testerId !== userId && r.contract.test.developerId !== userId)) return null;
  return r;
}
