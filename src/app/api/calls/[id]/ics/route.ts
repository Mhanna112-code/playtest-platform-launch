// (The full app's Add to calendar) A calendar invite (.ics) for a booked call. Only its developer and tester can download
// it; it links to the call page on the site.
import { db } from "@/lib/db";
import { requireUser } from "@/lib/server/session";
import { callIcs } from "@/lib/ics";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser(req).catch(() => null);
  if (!u) return new Response("Not allowed", { status: 403 });
  const { id } = await params;
  const call = await db.call.findUnique({ where: { id }, include: { contract: { include: { test: true } } } });
  if (!call || call.status !== "booked" || (call.contract.testerId !== u.id && call.contract.test.developerId !== u.id)) return new Response("Not found", { status: 404 });
  const url = `${(process.env.APP_URL ?? "http://localhost:3400").replace(/\/$/, "")}/app/calls/${call.id}`;
  return new Response(callIcs({ id: call.id, startsAt: call.startsAt, minutes: call.minutes, title: call.contract.title, url }), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'attachment; filename="live-call.ics"' },
  });
}
