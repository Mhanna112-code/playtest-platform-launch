// (Batch 35 §135, owner Nov 3) The call room's relay: Cloudflare Realtime TURN. Calls go straight between the two browsers; on a strict network they need a
// TURN relay. Cloudflare has no fixed TURN password: with a TURN key (CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN, server-only settings) the server
// asks Cloudflare for short-lived credentials when one of the call's two people opens the call page and when their room (re)joins, and only those credentials
// reach that person's browser, never the token. Without the key, or when Cloudflare fails or is slow: the fixed TURN_URL relay when it's set, else STUN only.
// Cloudflare's docs: https://developers.cloudflare.com/realtime/turn/generate-credentials/
import { measureDeadline } from "@/lib/callMeasure";

/** One entry of RTCPeerConnection's `iceServers`. */
export type IceServer = { urls: string | string[]; username?: string; credential?: string };

const GOOGLE_STUN = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"];

/** Google's free STUN servers, plus a fixed TURN relay when TURN_URL is set (needed on some strict networks: some offices, some mobile carriers). */
export function iceServers(): IceServer[] {
  const servers: IceServer[] = [{ urls: [...GOOGLE_STUN] }];
  if (process.env.TURN_URL) servers.push({ urls: process.env.TURN_URL.split(",").map((x) => x.trim()).filter(Boolean), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  return servers;
}

/** Cloudflare's endpoint that makes short-lived TURN credentials (and the matching ICE servers) for one TURN key. */
export const cloudflareTurnUrl = (keyId: string) => `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;
/** Cloudflare must answer within this; otherwise the call uses the fallback. */
export const TURN_TIMEOUT_MS = 2_500;
/** A reload or a rejoin this soon reuses the same credentials (per call and person), so reloads don't keep asking Cloudflare. */
export const TURN_CACHE_MS = 5 * 60_000;
/** Credentials never last longer than this (Cloudflare allows up to 48 hours). */
export const TURN_TTL_MAX_S = 24 * 3600;

/**
 * How long a call's credentials last, in seconds: the call's remaining measurable time (until its measuring deadline, the booked start + 150% of its length
 * + 30 minutes, after which the room can't be used) plus an hour, at most 24 hours. Credentials that expire during a call cut the relayed connection.
 */
export function turnTtlSeconds(call: { startsAt: Date; minutes: number }, now = new Date()) {
  const left = Math.max(0, measureDeadline(call.startsAt, call.minutes).getTime() - now.getTime());
  return Math.min(TURN_TTL_MAX_S, Math.ceil(left / 1000) + 3600);
}

const cache = new Map<string, { at: number; servers: IceServer[] }>();
/** Tests: forget every cached credential. */
export const clearTurnCache = () => cache.clear();

const urlsOf = (s: IceServer) => (Array.isArray(s.urls) ? s.urls : [s.urls]);

/**
 * Cloudflare's answer kept to what the browser needs (urls, username, credential), without port 53 URLs (browsers block that port, Cloudflare's docs say).
 * Google's STUN is added only when the answer has no STUN of its own. Null when it has no TURN entry with its username and credential.
 */
function cleanIceServers(body: unknown): IceServer[] | null {
  const list = (body as { iceServers?: unknown } | null)?.iceServers;
  if (!Array.isArray(list)) return null;
  const out: IceServer[] = [];
  for (const s of list as { urls?: unknown; username?: unknown; credential?: unknown }[]) {
    const raw: unknown[] = typeof s?.urls === "string" ? [s.urls] : Array.isArray(s?.urls) ? s.urls : [];
    const urls = raw.filter((u): u is string => typeof u === "string" && /^(stuns?|turns?):/.test(u) && !/:53(\?|$)/.test(u));
    if (!urls.length) continue;
    out.push({ urls, ...(typeof s.username === "string" ? { username: s.username } : {}), ...(typeof s.credential === "string" ? { credential: s.credential } : {}) });
  }
  if (!out.some((s) => s.username && s.credential && urlsOf(s).some((u) => /^turns?:/.test(u)))) return null;
  return out.some((s) => urlsOf(s).some((u) => /^stuns?:/.test(u))) ? out : [{ urls: [...GOOGLE_STUN] }, ...out];
}

/**
 * The ICE servers for one of a call's two people (the caller has checked they're the call's tester or developer). With the Cloudflare TURN key: Cloudflare's
 * own, with short-lived credentials made for this call (`turnTtlSeconds`), kept for TURN_CACHE_MS per call and person. Without the key, or when Cloudflare
 * errs or doesn't answer within TURN_TIMEOUT_MS: `iceServers()` (Google's STUN, plus TURN_URL when set), with one log line (no key, token or answer in it).
 */
export async function callIceServers(call: { id: string; startsAt: Date; minutes: number }, userId: string, now = new Date()): Promise<IceServer[]> {
  const keyId = (process.env.CLOUDFLARE_TURN_KEY_ID ?? "").trim();
  const token = (process.env.CLOUDFLARE_TURN_API_TOKEN ?? "").trim();
  if (!keyId || !token) return iceServers();
  const key = `${call.id}:${userId}`;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < TURN_CACHE_MS) return hit.servers;
  let why: string;
  try {
    const res = await fetch(cloudflareTurnUrl(keyId), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: turnTtlSeconds(call, now) }),
      signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
    });
    const servers = res.ok ? cleanIceServers(await res.json()) : null;
    if (servers) {
      for (const [k, v] of cache) if (now.getTime() - v.at >= TURN_CACHE_MS) cache.delete(k);
      cache.set(key, { at: now.getTime(), servers });
      return servers;
    }
    why = res.ok ? "no TURN credentials in the answer" : `HTTP ${res.status}`;
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    why = name === "TimeoutError" ? `no answer within ${TURN_TIMEOUT_MS / 1000} seconds` : name === "SyntaxError" ? "an answer that isn't JSON" : "the request failed";
  }
  const fallback = iceServers();
  console.error(`[turn] Cloudflare TURN credentials failed (${why}): this call uses ${fallback.length > 1 ? "the TURN_URL relay" : "STUN only"}.`);
  return fallback;
}
