import { alertRefusal, healthKeyOf, healthKeyOk, outageChecksOn, parseAlert, recordAlert } from "@/lib/server/outages";

// (Owner, Oct 30, batch 15 section 10) UptimeRobot's alert contact: a webhook, POST, to APP_URL/api/health/alert?key=<HEALTH_KEY>. Its body (JSON, or form
// fields) carries alertType (1 = down, 2 = up) and alertDateTime (Unix seconds); the same names in the URL's query work too. (Batch 15 section 41, M4) The key may come
// in the x-health-key header instead; the outage runs on the SERVER's clock (when the down and up alerts arrived); an alert more than 10 minutes off is refused.
// (Batch 26 section 1) The up alert's alertDuration (seconds, UptimeRobot's *alertDuration*) records the outage when the down alert never arrived (the site was down).
export async function POST(req: Request) {
  const url = new URL(req.url);
  if (!healthKeyOk(healthKeyOf(req))) return Response.json({ ok: false }, { status: 403 });
  if (!outageChecksOn()) return Response.json({ ok: true, ignored: "OUTAGE_CHECKS is off" });
  const raw = await req.text();
  let body: Record<string, unknown> = {};
  try {
    body = raw.trim().startsWith("{") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
  } catch {
    return Response.json({ ok: false, error: "Send the alert as JSON or form fields." }, { status: 400 });
  }
  const alert = parseAlert({ ...Object.fromEntries(url.searchParams), ...body });
  if (!alert.type) return Response.json({ ok: false, error: "alertType must be 1 (down) or 2 (up)." }, { status: 400 });
  const now = new Date();
  const refused = alertRefusal(alert, now);
  if (refused) return Response.json({ ok: false, error: refused }, { status: 400 });
  const outage = await recordAlert(alert.type, now, alert.durationMs);
  return Response.json({ ok: true, type: alert.type, outage: outage ? { startAt: outage.startAt, endAt: outage.endAt, ms: outage.ms, needsApproval: outage.needsApproval } : null });
}
