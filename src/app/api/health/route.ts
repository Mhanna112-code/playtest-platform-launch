import { db } from "@/lib/db";
import { heartbeat } from "@/lib/server/outages";

// (NEWEST+6) The uptime checker calls this every 5 minutes: when the app AND the database work, a heartbeat is written
// (and a gap over 15 minutes since the last one is recorded as an outage).
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    await heartbeat(new Date(), true);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
