import { db } from "@/lib/db";
import { healthKeyOk, heartbeat, outageChecksOn } from "@/lib/server/outages";

// (NEWEST+6, GATED; batch 15 section 10) The outside uptime checker calls GET /api/health?key=<HEALTH_KEY> every 5 minutes. With
// OUTAGE_CHECKS=1 and the right key, a heartbeat is written for information only (missing pings never create an outage: outages
// come from the alerts, /api/health/alert). Without the key it only reports the status. Page loads, polls and the daily job never write heartbeats.
export async function GET(req: Request) {
  try {
    await db.$queryRaw`SELECT 1`;
    if (outageChecksOn() && healthKeyOk(new URL(req.url).searchParams.get("key"))) await heartbeat(new Date(), true);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
