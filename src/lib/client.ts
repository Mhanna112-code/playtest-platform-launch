import { seenNow } from "./live";

// Browser helper for the JSON API: returns data, or throws an Error whose message is already in plain words.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
}

/** Marks a form mistake (red) as opposed to a refusal (blue). */
export const FIELD = "\u0001";
export const isFieldError = (e: unknown) => e instanceof ApiError && (e.status === 400 || e.status === 413);
/** The text to show for an error: form mistakes carry the FIELD mark so they render red; refusals render blue. */
export const errOf = (e: unknown) => (isFieldError(e) ? FIELD : "") + (e as Error).message;

/** This page load's id: the server never stops a press for what this same tab did ("another tab" only). */
export const TAB = typeof window === "undefined" ? "" : Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

export async function api<T = unknown>(path: string, body?: unknown, method?: string): Promise<T> {
  // Every press sends the later of the page's render time and what the live top notice has shown (NEWEST+3).
  // (Owner) New terms (reason A) are measured from the page itself: `pageSeenAt` is when the page was rendered, whatever the top box showed.
  if (body && typeof body === "object" && typeof (body as { seenAt?: unknown }).seenAt === "string") body = { ...body, pageSeenAt: (body as { seenAt: string }).seenAt, seenAt: seenNow((body as { seenAt: string }).seenAt) };
  let res: Response;
  try {
    res = await fetch(path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: body === undefined ? { "x-tab": TAB } : { "content-type": "application/json", "x-tab": TAB },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "offline", "You seem to be offline. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? "server", e?.message ?? (res.status === 413 ? "That's too much to send at once. Try a smaller amount." : "Something went wrong. Try again in a moment."), e ?? {});
  }
  // A press that went ahead with a note (e.g. "Done. Also: the test was renamed to ..."): kept for the page's top box
  // in case the page reloads right away.
  if (data && typeof data === "object" && typeof (data as { note?: unknown }).note === "string" && typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem("press-note", JSON.stringify({ text: (data as { note: string }).note, at: new Date().toISOString(), path: window.location.pathname }));
    } catch {
      // storage blocked: the note still shows under the button
    }
  }
  return data as T;
}
