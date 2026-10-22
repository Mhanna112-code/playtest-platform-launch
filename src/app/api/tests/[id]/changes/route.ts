import { db } from "@/lib/db";
import { DEV_STOP_KINDS } from "@/lib/rules";
import { handle, HttpError, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { ownTest } from "@/lib/server/tests";

// Live lines for the developer's test page: the stop-once reasons since the page loaded.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireUser(req);
    const { id } = await params;
    await ownTest(u.id, id);
    const since = new Date(new URL(req.url).searchParams.get("since") ?? "");
    if (isNaN(since.getTime())) throw new HttpError(400, "bad_request", "Refresh to see the latest.");
    const ev = await db.testEvent.findMany({ where: { testId: id, createdAt: { gt: since }, kind: { in: [...DEV_STOP_KINDS] } }, orderBy: { createdAt: "asc" }, take: 50 });
    return ok({ changes: ev.map((e) => ({ text: e.text, at: e.createdAt })) });
  });
}
