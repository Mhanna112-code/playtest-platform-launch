import { canView } from "@/lib/server/recordings";
import { getUserFromRequest } from "@/lib/server/session";
import { dispositionOf, r2On, readLocal, viewUrl } from "@/lib/server/storage";

// Watch a recording: only the tester who made it and the test's developer.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getUserFromRequest(req);
  const { id } = await params;
  const r = u ? await canView(u.id, id) : null;
  if (!r) return new Response("Not found", { status: 404 });
  if (r2On()) return Response.redirect(viewUrl(r.id, r.storageKey, r.contentType, r.filename), 302);
  try {
    const { stream, size } = await readLocal(r.storageKey);
    // (Batch 11; batch 15 section 41, M5) Attachments are only the allowed types; never sniffed; only images and videos open in the page, anything else downloads.
    const disposition = dispositionOf(r.contentType, r.filename);
    return new Response(stream, { headers: { "content-type": r.contentType, "content-length": String(size), "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": disposition } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
