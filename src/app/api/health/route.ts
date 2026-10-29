import { after } from "next/server";
import { db } from "@/lib/db";
import { healthKeyOf, healthKeyOk, heartbeat, outageChecksOn } from "@/lib/server/outages";
import { SWEEP_BUDGET_MS, healthSweep } from "@/lib/server/timers";

// (NEWEST+6, GATED; batch 15 section 10) The outside uptime checker calls GET /api/health?key=<HEALTH_KEY> every 5 minutes. With
// OUTAGE_CHECKS=1 and the right key, a heartbeat is written for information only (missing pings never create an outage: outages
// come from the alerts, /api/health/alert). Without the key it only reports the status. Page loads, polls and the daily job never write heartbeats.
// (Owner, Oct 28, batch 19 section 4) With the right key it also runs the time-sensitive sweep (lib/server/timers.ts), after answering: never twice at once (a
// lock), and a sweep error never changes the answer or records an outage. Without the key nothing runs.
export async function GET(req: Request) {
  let ok = true;
  try {
    await db.$queryRaw`SELECT 1`;
    if (outageChecksOn() && healthKeyOk(healthKeyOf(req))) await heartbeat(new Date(), true);
  } catch {
    ok = false;
  }
  if (ok && healthKeyOk(healthKeyOf(req))) await sweepAfterAnswer();
  return ok ? Response.json({ ok: true }) : Response.json({ ok: false }, { status: 503 });
}

/** After the answer is sent when the platform allows it (Vercel's waitUntil); otherwise here, waiting at most SWEEP_BUDGET_MS (the sweep then finishes on its own). */
async function sweepAfterAnswer() {
  try {
    after(() => healthSweep().then(() => undefined));
    return;
  } catch {
    // No request scope (a test, or a plain call): run it now, within the budget.
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([healthSweep(), new Promise((r) => { timer = setTimeout(r, SWEEP_BUDGET_MS); })]);
  clearTimeout(timer);
}
