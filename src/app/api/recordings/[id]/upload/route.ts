import { db } from "@/lib/db";
import { HttpError, handle, ok } from "@/lib/server/http";
import { MAX_ATTACHMENT_BYTES, MAX_RECORDING_BYTES, isVideo, r2On, saveLocal } from "@/lib/server/storage";
import { requireActive } from "@/lib/server/users";

// Local-disk uploads (development). With R2 configured the browser uploads straight to R2 instead.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    if (r2On()) throw new HttpError(404, "not_found", "Not found.");
    const u = await requireActive(req);
    const { id } = await params;
    const rec = await db.recording.findUnique({ where: { id }, include: { contract: true } });
    if (!rec || rec.contract.testerId !== u.id) throw new HttpError(404, "not_found", "That upload doesn't exist.");
    if (rec.uploadedAt) throw new HttpError(409, "done", "This file was already uploaded.");
    // (Batch 11) A file attached to a written part: 25 MB; a recording: 500 MB.
    const size = isVideo(rec.contentType) ? await saveLocal(rec.storageKey, req.body, MAX_RECORDING_BYTES) : await saveLocal(rec.storageKey, req.body, MAX_ATTACHMENT_BYTES, "Files can be at most 25 MB.");
    await db.recording.update({ where: { id }, data: { sizeBytes: size } });
    return ok({ ok: true });
  });
}
