// Small helpers for the JSON API: plain-word errors, size-limited bodies, same-origin checks.

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public data?: Record<string, unknown>) {
    super(message);
  }
}

export const ok = (data: unknown, init?: ResponseInit) => Response.json(data, init);

export const fail = (status: number, code: string, message: string, data?: Record<string, unknown>) =>
  Response.json({ error: { code, message, ...(data ?? {}) } }, { status });

/** Read a JSON body (max `limit` bytes). Mutating requests must be JSON, which browsers won't send cross-site without CORS. */
export async function readJson(req: Request, limit = 100_000): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new HttpError(415, "bad_request", "Something went wrong sending that. Reload the page and try again.");
  const origin = req.headers.get("origin");
  if (origin && !sameOrigin(req, origin)) throw new HttpError(403, "bad_origin", "That request came from another site, so it was blocked.");
  const len = Number(req.headers.get("content-length") || 0);
  if (len > limit) throw new HttpError(413, "too_large", "That's too much to send at once. Try sending less at once.");
  const text = await req.text();
  if (text.length > limit) throw new HttpError(413, "too_large", "That's too much to send at once. Try sending less at once.");
  try {
    const v = text ? JSON.parse(text) : {};
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    // The browser tab that sent it (reason E: "You also did this in another tab").
    const tab = req.headers.get("x-tab");
    if (tab && typeof v.tab !== "string") v.tab = tab.slice(0, 64);
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "bad_request", "Something went wrong sending that. Reload the page and try again.");
  }
}

function sameOrigin(req: Request, origin: string) {
  try {
    const o = new URL(origin);
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || new URL(req.url).host;
    return o.host === host;
  } catch {
    return false;
  }
}

/** Run a route handler body; HttpErrors become plain-word JSON errors, anything else a generic one. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  // (Batch 28 §1) Every API call is a heartbeat (at most one check a minute; only with OUTAGE_CHECKS=1). Never in the way of the call.
  void import("./outages").then((m) => m.touchHeartbeat()).catch(() => null);
  try {
    return await fn();
  } catch (e) {
    // (Owner) A stop says when the box was made: the next press sends it back as "boxAt" and goes ahead only if nothing
    // new happened since (else it stops again with the new lines).
    if (e instanceof HttpError) return fail(e.status, e.code, e.message, e.code === "stop_once" || e.code === "changed" || e.code === "needs_confirm" ? { ...(e.data ?? {}), now: new Date().toISOString() } : e.data);
    console.error(e);
    return fail(500, "server", "Something went wrong on our side. Try again in a moment.");
  }
}

/**
 * (Owner, Oct 30, batch 15 section 20) A typed reason, note or message: trimmed, and REFUSED (red at the field) when over its limit, never cut silently.
 */
export function readText(v: unknown, max: number, code = "too_long") {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length > max) throw new HttpError(400, code, `Keep it to ${max.toLocaleString("en-US")} characters.`);
  return s;
}

/** (Batch 15 section 41, L5) A plain form POST from this site's own page (its Origin, when the browser sends one, is this site). */
export function sameOriginForm(req: Request, base: string) {
  const origin = req.headers.get("origin");
  if (!origin) return true; // older browsers; the SameSite=Lax cookie still keeps other sites' POSTs signed out
  try {
    return new URL(origin).host === new URL(base).host || sameOrigin(req, origin);
  } catch {
    return false;
  }
}
