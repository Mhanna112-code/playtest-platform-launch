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
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.code, e.message, e.data);
    console.error(e);
    return fail(500, "server", "Something went wrong on our side. Try again in a moment.");
  }
}
