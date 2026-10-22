// Browser helper for the JSON API: returns data, or throws an Error whose message is already in plain words.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, body?: unknown, method?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: body === undefined ? undefined : { "content-type": "application/json" },
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
  return data as T;
}
