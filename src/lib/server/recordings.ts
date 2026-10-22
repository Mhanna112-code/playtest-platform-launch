import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { displayName, pronouns } from "@/lib/format";
import { checkAsk, isLate, payByFrom } from "@/lib/rules";
import { toCents } from "@/lib/format";
import { HttpError } from "./http";
import { notify } from "./notify";
import { MAX_RECORDING_BYTES, MAX_RECORDINGS, uploadTarget } from "./storage";
import { ownContract, recordEvent, sessionRefusal } from "./tests";

type U = { id: string; email: string; name: string; pronoun: string };

/** Start an upload: checks the session can still send, the size (500 MB) and the count (5 per session). */
export async function startRecording(tester: U, contractId: string, body: Record<string, unknown>) {
  const c = await ownContract(tester.id, contractId);
  const refusal = sessionRefusal(c, c.test, displayName(c.test.developer));
  if (refusal) throw new HttpError(409, "closed", refusal);
  const size = Number(body.size);
  const type = typeof body.contentType === "string" ? body.contentType : "";
  const filename = (typeof body.filename === "string" ? body.filename : "recording").replace(/[^\w.\- ]/g, "_").slice(0, 120) || "recording";
  if (!type.startsWith("video/")) throw new HttpError(400, "bad_type", "Choose a video file (for example .mp4 or .webm).");
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, "empty", "That file is empty.");
  if (size > MAX_RECORDING_BYTES) throw new HttpError(413, "too_large", "Recordings can be at most 500 MB.");
  const count = await db.recording.count({ where: { contractId } });
  if (count >= MAX_RECORDINGS) throw new HttpError(409, "too_many", `You can upload at most ${MAX_RECORDINGS} recordings for a test.`);
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")).toLowerCase() : ".mp4";
  const storageKey = `recordings/${contractId}/${randomBytes(12).toString("hex")}${ext}`;
  const rec = await db.recording.create({ data: { contractId, storageKey, filename, sizeBytes: size, contentType: type } });
  return { recordingId: rec.id, uploadUrl: uploadTarget(rec.id, storageKey) };
}

export async function finishRecording(tester: U, contractId: string, body: Record<string, unknown>) {
  await ownContract(tester.id, contractId);
  const rec = await db.recording.findUnique({ where: { id: String(body.recordingId ?? "") } });
  if (!rec || rec.contractId !== contractId) throw new HttpError(404, "not_found", "That upload doesn't exist.");
  await db.recording.update({ where: { id: rec.id }, data: { uploadedAt: new Date() } });
  return { ok: true };
}

/** Send the uploaded recordings (or send them again with new ones, until paid), with an optional asked amount. */
export async function sendRecording(tester: U, contractId: string, body: Record<string, unknown> = {}) {
  const c0 = await ownContract(tester.id, contractId);
  const askedCents = body.ask === undefined || body.ask === null || body.ask === "" ? null : toCents(body.ask);
  if (body.ask && askedCents == null) throw new HttpError(400, "bad_ask", "Enter the amount you ask like 7.50, or leave it empty.");
  const askOk = checkAsk(askedCents);
  if (!askOk.ok) throw new HttpError(400, "bad_ask", askOk.message);

  const name = displayName(tester), poss = pronouns(tester.pronoun).poss;
  const { updated, late } = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${c0.testId} FOR UPDATE`;
    const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    const t = await tx.test.findUniqueOrThrow({ where: { id: c.testId } });
    const refusal = sessionRefusal(c, t, displayName(c0.test.developer));
    if (refusal) throw new HttpError(409, "closed", refusal);
    const recs = await tx.recording.findMany({ where: { contractId, uploadedAt: { not: null } } });
    if (recs.length === 0) throw new HttpError(400, "none", "Upload a recording first.");
    const existing = await tx.submission.findUnique({ where: { contractId_kind: { contractId, kind: "recording" } }, include: { review: true } });
    if (existing?.review) throw new HttpError(409, "paid", "Your recording was already paid for, so it can't be changed. Send anything new in the chat.");
    const now = new Date();
    const data = { late: isLate(c.dueAt, now), updatedAt: now, payBy: payByFrom(now), askedCents };
    const sub = existing
      ? await tx.submission.update({ where: { id: existing.id }, data })
      : await tx.submission.create({ data: { contractId, kind: "recording", agreedCents: c.recordingCents, ...data } });
    await tx.recording.updateMany({ where: { contractId, uploadedAt: { not: null } }, data: { submissionId: sub.id } });
    await recordEvent(tx, c.testId, "sent", `${name} ${existing ? "updated" : "sent"} ${poss} recording`, false, {}, c.id);
    return { updated: !!existing, late: data.late };
  });
  await notify(c0.test.developer.email, `${name} ${updated ? "updated" : "sent"} a recording for “${c0.title}”`, [`${name} ${updated ? "updated" : "sent"} ${poss} screen recording${late ? " (late)" : ""}. Watch it and choose what to pay.`], `/app/tests/${c0.testId}`);
  return { sent: true };
}

/** Who may watch: the tester who made it, or the test's developer. */
export async function canView(userId: string, recordingId: string) {
  const r = await db.recording.findUnique({ where: { id: recordingId }, include: { contract: { include: { test: true } } } });
  if (!r || (r.contract.testerId !== userId && r.contract.test.developerId !== userId)) return null;
  return r;
}
