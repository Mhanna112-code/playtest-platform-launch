import { boxSeenAt, pageLoadedAt, seenNow } from "./live";
import { pressLabelOf } from "./pressLabels";
import { publishTesterAlertsOff, setTesterAlertsOff } from "./testerAlerts";
import { ANSWER_TERMS_CODE, ANSWER_TERMS_EVENT, ANSWER_TERMS_FIRST, termsBlockedPath } from "./answerTerms";

/** (Batch 15 section 36) The label of the last press that was stopped or refused: the box under it names it ("Your Pay didn't go through."). */
let LAST_PRESS = "";
export const lastPressLabel = () => LAST_PRESS;

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

/** The account this page belongs to (set by the signed-in layout): every press names it, so a press racing a switch of accounts is refused. */
let PAGE_USER = "";
export const setPageUser = (id: string) => {
  PAGE_USER = id;
};

/** This page load's id: the server never stops a press for what this same tab did ("another tab" only). */
export const TAB = typeof window === "undefined" ? "" : Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

/**
 * (Owner, Oct 29, batch 27 section 1) While the page shows an open new-terms offer (the Switch / Keep box), Send and every call press don't go out: the page goes up
 * to the box (highlighted for a few seconds) and the press gets the line "Answer the new terms first: Switch or Keep." under its button, on every press until the
 * tester answers. True when `path` is such a press and it was stopped here.
 */
export function blockedByTerms(path: string) {
  if (!termsBlockedPath(path) || !offerShown()) return false;
  LAST_PRESS = pressLabelOf(path);
  window.dispatchEvent(new Event(ANSWER_TERMS_EVENT));
  return true;
}

/** (Batch 27 section 1) Does this page show an open new-terms offer (the Switch / Keep box)? A blocked press then skips its own form checks: the offer comes first. */
export const offerShown = () => typeof document !== "undefined" && !!document.getElementById("terms-offer");

/** (Batch 28 §9) Sent when the server refuses a press because the state changed: the page redraws at once (AutoRefresh). */
export const PRESS_REFUSED_EVENT = "press-refused";
export async function api<T = unknown>(path: string, body?: unknown, method?: string): Promise<T> {
  if (body !== undefined && blockedByTerms(path)) throw new ApiError(409, ANSWER_TERMS_CODE, ANSWER_TERMS_FIRST);
  // Every press sends the later of the page's render time and what the live top notice has shown (NEWEST+3).
  // (Owner) New terms (reason A) are measured from the page itself: `pageSeenAt` is when the page was rendered, whatever the top box showed.
  if (body && typeof body === "object" && typeof (body as { seenAt?: unknown }).seenAt === "string") body = { ...body, pageSeenAt: (body as { seenAt: string }).seenAt, seenAt: seenNow((body as { seenAt: string }).seenAt), ...(pageLoadedAt() ? { loadedAt: pageLoadedAt() } : {}), ...(boxSeenAt() ? { boxSeenAt: boxSeenAt() } : {}) };
  let res: Response;
  try {
    res = await fetch(path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), "x-tab": TAB, ...(PAGE_USER ? { "x-uid": PAGE_USER } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    LAST_PRESS = pressLabelOf(path);
    throw new ApiError(0, "offline", "You seem to be offline. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // A press from a page that belongs to the previous account was refused: the tab switches to the new account (on the page the new sign-in landed on).
    if (data?.error?.code === "account_changed" && typeof window !== "undefined") {
      try {
        const n = JSON.parse(window.localStorage.getItem("pt-auth") ?? "null") as { event?: string; at?: number; to?: string } | null;
        window.location.href = n && n.event === "in" && n.to && n.to.startsWith("/") && Date.now() - (n.at ?? 0) < 10 * 60_000 ? n.to : "/app";
      } catch {
        window.location.href = "/app";
      }
    }
    if (res.status === 401 && typeof window !== "undefined") window.location.href = data?.error?.code === "deleted" ? "/login?gone=1" : "/login";
    // (Design doc 2; owner, Oct 27) A press refused because the account is suspended or on a payment / chargeback hold (or one that started the hold, a declined payment): on to the
    // TOP of the dashboard, where a blue box names the press that didn't go through and says how to resume.
    // The team stopped (or paused) the test: back to the test, where its banner names the press that failed.
    if ((data?.error?.code === "admin_stopped" || data?.error?.code === "admin_paused") && typeof window !== "undefined" && typeof data.error.failed === "string") {
      const m = /\/api\/tests\/([^/]+)\//.exec(path);
      if (m) window.location.href = `/app/tests/${m[1]}?failed=${encodeURIComponent(data.error.failed)}`;
    }
    // (Owner, Oct 28, batch 16 section 24) The test stopped, closed or the tester's work was ended while this page was open: a press of what's gone (Send,
    // Switch / Keep, a call action, an upload, "This key doesn't work") reloads the session page at its TOP, where the stopped line names the press.
    if (data?.error?.code === "work_over" && typeof window !== "undefined" && typeof data.error.failed === "string") {
      const m = /\/api\/sessions\/([^/]+)\//.exec(path);
      if (m) window.location.href = `/app/sessions/${m[1]}?failed=${encodeURIComponent(data.error.failed)}`;
    }
    if ((data?.error?.code === "suspended" || data?.error?.code === "held" || data?.error?.held === true) && typeof window !== "undefined" && typeof data.error.failed === "string") {
      window.location.href = `/app?failed=${encodeURIComponent(data.error.failed)}`;
    }
    const e = data?.error;
    LAST_PRESS = typeof e?.press === "string" ? e.press : pressLabelOf(path);
    // (Batch 27 section 1) The server refused for an open offer (an old page that hasn't shown it too): up to the Switch / Keep box (it loads if the page lacks it).
    if (e?.code === ANSWER_TERMS_CODE && typeof window !== "undefined") window.dispatchEvent(new Event(ANSWER_TERMS_EVENT));
    // (Batch 17 section 13) A tester's stop box says whether their Alerts is Off (the box then drops "Turn off alerts").
    if (e?.code === "stop_once" && typeof e.alertsOff === "boolean") setTesterAlertsOff(e.alertsOff);
    // (Batch 20 section 8) ... and the Alerts button and the other boxes on the page follow what the server says.
    if (e?.code === "stop_once" && typeof e.alertsOff === "boolean") publishTesterAlertsOff(e.alertsOff, false);
    // (Owner, Oct 29, batch 28 §9) A press refused because the state changed (a block, a stop, a pause, an ended call, a closed request, already paid…): the page
    // redraws at once, as its poll would (AutoRefresh; typed text kept), so the dead buttons go and the new state shows.
    if (res.status === 409 && e?.code !== "stop_once" && e?.code !== ANSWER_TERMS_CODE && body !== undefined && typeof window !== "undefined") window.dispatchEvent(new Event(PRESS_REFUSED_EVENT));
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

/** (Batch 15 section 41, C1) A press id: a v4 UUID (the server accepts nothing else). Works where crypto.randomUUID doesn't (plain http on a LAN). */
export function newPressId(): string {
  const c = globalThis.crypto as Crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
