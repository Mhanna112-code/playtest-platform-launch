import { canView } from "@/lib/server/recordings";
import { getUserFromRequest, isAdmin } from "@/lib/server/session";
import { dispositionOf, localSize, parseRange, r2On, readLocal, viewUrl } from "@/lib/server/storage";

// Watch a recording: only the tester who made it, the test's developer and (batch 15 section 8) admins.
// (Owner, Oct 31, batch 35 §42) Recordings can be scrubbed: the local file answers byte ranges ("Range: bytes=…" → 206 Partial Content with Content-Range; a
// range outside the file → 416), and says it does (Accept-Ranges: bytes), so the player can jump anywhere in it. R2's presigned URLs do the same on their own.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getUserFromRequest(req);
  const { id } = await params;
  const r = u ? await canView(u.id, id, isAdmin(u)) : null;
  if (!r) return new Response("Not found", { status: 404 });
  if (r2On()) return Response.redirect(viewUrl(r.id, r.storageKey, r.contentType, r.filename), 302);
  try {
    const size = await localSize(r.storageKey);
    // (Batch 11; batch 15 section 41, M5) Attachments are only the allowed types; never sniffed; only images and videos open in the page, anything else downloads.
    const disposition = dispositionOf(r.contentType, r.filename);
    const headers = { "content-type": r.contentType, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": disposition, "accept-ranges": "bytes" };
    const range = parseRange(req.headers.get("range"), size);
    if (range === "bad") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    if (range === "none") {
      const { stream } = await readLocal(r.storageKey);
      return new Response(stream, { headers: { ...headers, "content-length": String(size) } });
    }
    const { stream } = await readLocal(r.storageKey, range);
    return new Response(stream, { status: 206, headers: { ...headers, "content-length": String(range.end - range.start + 1), "content-range": `bytes ${range.start}-${range.end}/${size}` } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
