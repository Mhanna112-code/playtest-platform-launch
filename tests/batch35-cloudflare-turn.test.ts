import fs from "node:fs";
import path from "node:path";
import React, { type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { CALL_NOT_AVAILABLE, measureDeadline } from "@/lib/callMeasure";
import { configProblems, turnRelaySetUp } from "@/lib/server/config";
import { roomSend } from "@/lib/server/calls";
import { TURN_TIMEOUT_MS, callIceServers, clearTurnCache, type IceServer } from "@/lib/server/turn";
import { POST as roomPOST } from "@/app/api/calls/[id]/room/route";
import { json, makeUser, req } from "./helpers";
import { bookCall, joined, setup } from "./fixtures";

// Batch 35 §135 (owner, Nov 3): the call relay is Cloudflare Realtime TURN. The server asks Cloudflare for short-lived credentials (from the TURN key's ID and
// API token) when one of the call's two people opens the call page and when their room (re)joins; only those credentials reach the browser.
(globalThis as unknown as { React: typeof React }).React = React;
const who = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => who.user, requireOpenPage: async () => who.user, leaveIfClosed: () => {}, adminAway: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-path": "/app/calls/x" }), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), redirect: () => { throw new Error("redirect"); } }));
import CallPage from "@/app/app/calls/[id]/page";
import { CallRoom } from "@/app/app/calls/[id]/CallRoom";

const MIN = 60_000;
const KEY_ID = "cfkey0123456789abcdef";
const TOKEN = "cf-api-token-very-secret-9876";
const GOOGLE = { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] };
const NO_RELAY =
  "No TURN relay is set up: calls can't connect on some strict networks (some offices, mobile carriers, VPNs). Set CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN (a Cloudflare Realtime TURN key), or TURN_URL, TURN_USERNAME and TURN_CREDENTIAL from another TURN provider.";
const RELAY_WORKS = "Relay-only check: this call goes only through the TURN relay, as it would on a strict network. If it connects, the relay works.";
const RELAY_MISSING = "Relay-only check: no TURN relay is set up (CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN, or TURN_URL), so this call can't connect this way.";

/** Cloudflare's answer (the docs' shape, with the port 53 URLs it may list): each one makes new credentials. */
let made = 0;
const cloudflareAnswer = (stun = true) => {
  made++;
  return {
    iceServers: [
      ...(stun ? [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] }] : []),
      {
        urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp", "turn:turn.cloudflare.com:3478?transport=tcp", "turn:turn.cloudflare.com:80?transport=tcp", "turns:turn.cloudflare.com:5349?transport=tcp", "turns:turn.cloudflare.com:443?transport=tcp"],
        username: `short-lived-user-${made}`,
        credential: `short-lived-credential-${made}`,
      },
    ],
  };
};
const CLOUDFLARE_TURN = (n: number) => ({
  urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:3478?transport=tcp", "turn:turn.cloudflare.com:80?transport=tcp", "turns:turn.cloudflare.com:5349?transport=tcp", "turns:turn.cloudflare.com:443?transport=tcp"],
  username: `short-lived-user-${n}`,
  credential: `short-lived-credential-${n}`,
});

/** A mocked fetch: only Cloudflare's endpoint answers (`reply`), and every request to it is kept. */
function cloudflare(reply: (init: RequestInit) => Response | Promise<Response> = () => Response.json(cloudflareAnswer(), { status: 201 })) {
  const sent: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      if (!String(url).startsWith("https://rtc.live.cloudflare.com/")) throw new Error(`unexpected request to ${String(url)}`);
      sent.push({ url: String(url), init });
      return reply(init);
    }),
  );
  return sent;
}
const ttlOf = (x: { init: RequestInit }) => JSON.parse(String(x.init.body)).ttl as number;

function find(node: React.ReactNode, predicate: (el: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) for (const x of node) { const found = find(x, predicate); if (found) return found; }
  if (React.isValidElement<Record<string, unknown>>(node)) {
    if (predicate(node)) return node;
    return find(node.props.children as React.ReactNode, predicate);
  }
}
/** Everything a page hands on (the props of each element), as text: what could reach the browser. */
const pageText = (tree: unknown) => JSON.stringify(tree, (k, v) => (k.startsWith("_") || typeof v === "function" || typeof v === "symbol" ? undefined : v));
async function openPage(user: unknown, callId: string, relay = false) {
  who.user = user;
  return (await CallPage({ params: Promise.resolve({ id: callId }), searchParams: Promise.resolve(relay ? { relay: "1" } : {}) })) as ReactElement;
}
const room = (tree: ReactElement) => find(tree, (e) => e.type === CallRoom)?.props as { iceServers: IceServer[]; initialLine: string; relayOnly: boolean } | undefined;
const join = async (user: { id: string }, callId: string, now?: Date) => (await roomSend(user, callId, "join", null, now)) as { iceServers: IceServer[] };

/** A booked 30-minute call that started a minute ago (its room is open). */
async function liveCall() {
  const s = await setup();
  const j = await joined(s.testId);
  const booked = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie);
  const call = await db.call.update({ where: { id: booked.id }, data: { startsAt: new Date(Date.now() - MIN) } });
  return { ...s, ...j, call };
}

beforeEach(() => {
  made = 0;
  clearTurnCache();
  vi.stubEnv("CLOUDFLARE_TURN_KEY_ID", KEY_ID);
  vi.stubEnv("CLOUDFLARE_TURN_API_TOKEN", TOKEN);
  vi.stubEnv("TURN_URL", "");
  vi.stubEnv("TURN_USERNAME", "");
  vi.stubEnv("TURN_CREDENTIAL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("batch 35 §135: short-lived Cloudflare TURN credentials for each call", () => {
  it("opening the call page asks Cloudflare for the TURN key's credentials (the token, ttl = the call's remaining measurable time + 1 hour) and the room gets them", async () => {
    const l = await liveCall();
    const sent = cloudflare();
    const before = Date.now();
    const tree = await openPage(l.tester.user, l.call.id);
    const after = Date.now();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`https://rtc.live.cloudflare.com/v1/turn/keys/${KEY_ID}/credentials/generate-ice-servers`);
    expect(sent[0].init.method).toBe("POST");
    expect(sent[0].init.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" });
    expect(sent[0].init.signal).toBeInstanceOf(AbortSignal); // it gives up after 2.5 seconds
    expect(Object.keys(JSON.parse(String(sent[0].init.body)))).toEqual(["ttl"]);
    // The room can be used until 30 minutes after the latest allowed end (the start + 45 minutes for a 30-minute call); the credentials last an hour more.
    const deadline = measureDeadline(l.call.startsAt, l.call.minutes).getTime();
    expect(deadline - l.call.startsAt.getTime()).toBe(75 * MIN);
    expect(ttlOf(sent[0])).toBeGreaterThanOrEqual(Math.ceil((deadline - after) / 1000) + 3600);
    expect(ttlOf(sent[0])).toBeLessThanOrEqual(Math.ceil((deadline - before) / 1000) + 3600);
    expect(Math.abs(ttlOf(sent[0]) - (74 * 60 + 3600))).toBeLessThan(10);
    // The room connects with Cloudflare's own STUN and TURN (no Google STUN: Cloudflare's answer has STUN), without the port 53 URLs browsers block.
    expect(room(tree)!.iceServers).toEqual([{ urls: ["stun:stun.cloudflare.com:3478"] }, CLOUDFLARE_TURN(1)]);
  });

  it("Google's STUN only when Cloudflare's answer has no STUN; credentials last at most 24 hours (a page opened two days ahead)", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie); // two days ahead
    const sent = cloudflare(() => Response.json(cloudflareAnswer(false), { status: 201 }));
    const props = room(await openPage(j.tester.user, call.id))!;
    expect(props.initialLine).toBe("");
    expect(ttlOf(sent[0])).toBe(24 * 3600);
    expect(props.iceServers).toEqual([GOOGLE, CLOUDFLARE_TURN(1)]);
  });

  it("cached per call and person for a few minutes: a reload and the room's join reuse them; the other person gets their own; a later rejoin gets new ones", async () => {
    const l = await liveCall();
    const sent = cloudflare();
    const first = room(await openPage(l.tester.user, l.call.id))!.iceServers;
    expect(room(await openPage(l.tester.user, l.call.id))!.iceServers).toEqual(first); // a reload
    expect((await join(l.tester.user, l.call.id)).iceServers).toEqual(first); // the room coming in right after
    expect(sent).toHaveLength(1);
    // The developer: their own credentials.
    const dev = room(await openPage(l.dev.user, l.call.id))!.iceServers;
    expect(sent).toHaveLength(2);
    expect(dev[1]).toEqual(CLOUDFLARE_TURN(2));
    // A rejoin 6 minutes later: new credentials, lasting what's left then (6 minutes less).
    const rejoin = await join(l.tester.user, l.call.id, new Date(Date.now() + 6 * MIN));
    expect(sent).toHaveLength(3);
    expect(rejoin.iceServers[1]).toEqual(CLOUDFLARE_TURN(3));
    expect(Math.abs(ttlOf(sent[0]) - ttlOf(sent[2]) - 6 * 60)).toBeLessThan(10);
    // The room uses the join's answer (its Rejoin mounts the room again, which joins again).
    const src = fs.readFileSync(path.resolve(__dirname, "../src/app/app/calls/[id]/CallRoom.tsx"), "utf8");
    expect(src).toContain('const joined = await post(callId, { kind: "join" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);');
    expect(src).toContain("if (Array.isArray(joined?.iceServers) && joined.iceServers.length) ice = joined.iceServers;");
    expect(src).toContain('new RTCPeerConnection({ iceServers: ice, ...(relayOnly ? { iceTransportPolicy: "relay" as const } : {}) })');
  });

  it("Cloudflare failing or slow: the fixed TURN_URL relay when set, else STUN only; a short log line with no key or token; failures aren't cached", async () => {
    const l = await liveCall();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // An error answer, no TURN_URL: Google's STUN only.
    cloudflare(() => new Response('{"success":false,"errors":["Authentication error"]}', { status: 401 }));
    expect(room(await openPage(l.tester.user, l.call.id))!.iceServers).toEqual([GOOGLE]);
    expect(err.mock.calls).toEqual([["[turn] Cloudflare TURN credentials failed (HTTP 401): this call uses STUN only."]]);
    // Not cached: the next load asks again. A network error, with TURN_URL set: its fixed relay.
    vi.stubEnv("TURN_URL", "turn:turn.example:3478");
    vi.stubEnv("TURN_USERNAME", "u");
    vi.stubEnv("TURN_CREDENTIAL", "c");
    const FIXED = [GOOGLE, { urls: ["turn:turn.example:3478"], username: "u", credential: "c" }];
    let sent = cloudflare(() => {
      throw new TypeError("fetch failed");
    });
    expect(room(await openPage(l.tester.user, l.call.id))!.iceServers).toEqual(FIXED);
    expect(sent).toHaveLength(1);
    expect(err.mock.calls[1]).toEqual(["[turn] Cloudflare TURN credentials failed (the request failed): this call uses the TURN_URL relay."]);
    // An answer without TURN credentials, and one that isn't JSON.
    cloudflare(() => Response.json({ iceServers: [{ urls: ["stun:stun.cloudflare.com:3478"] }, { urls: ["turn:turn.cloudflare.com:3478"] }] }, { status: 201 }));
    expect(await callIceServers(l.call, l.tester.user.id)).toEqual(FIXED);
    expect(err.mock.calls[2]).toEqual(["[turn] Cloudflare TURN credentials failed (no TURN credentials in the answer): this call uses the TURN_URL relay."]);
    cloudflare(() => new Response("<html>Bad gateway</html>", { status: 200 }));
    expect(await callIceServers(l.call, l.tester.user.id)).toEqual(FIXED);
    expect(err.mock.calls[3]).toEqual(["[turn] Cloudflare TURN credentials failed (an answer that isn't JSON): this call uses the TURN_URL relay."]);
    // No answer: given up after 2.5 seconds.
    sent = cloudflare((init) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
    const t0 = Date.now();
    expect((await join(l.tester.user, l.call.id)).iceServers).toEqual(FIXED);
    const waited = Date.now() - t0;
    expect(waited).toBeGreaterThanOrEqual(TURN_TIMEOUT_MS - 50);
    expect(waited).toBeLessThan(TURN_TIMEOUT_MS + 2000);
    expect(sent).toHaveLength(1);
    expect(err.mock.calls[4]).toEqual(["[turn] Cloudflare TURN credentials failed (no answer within 2.5 seconds): this call uses the TURN_URL relay."]);
    for (const c of err.mock.calls) expect(c.join(" ")).not.toMatch(new RegExp(`${KEY_ID}|${TOKEN}|Authentication`));
    // Cloudflare answering again: its credentials (nothing failed was kept).
    cloudflare();
    expect((await callIceServers(l.call, l.tester.user.id))[1]).toEqual(CLOUDFLARE_TURN(1));
  });

  it("the API token never reaches the browser; only the call's two people get credentials, and only while the room can be used", async () => {
    const l = await liveCall();
    const sent = cloudflare();
    // The page hands the room the short-lived credential, never the token (or the key's ID).
    const page = pageText(await openPage(l.tester.user, l.call.id));
    expect(page).toContain("short-lived-credential-1");
    expect(page).not.toContain(TOKEN);
    expect(page).not.toContain(KEY_ID);
    // The room's join answer (through the route) carries the same, never the token.
    const r = await json(await roomPOST(req(`/api/calls/${l.call.id}/room`, { cookie: l.tester.cookie, body: { kind: "join" } }), { params: Promise.resolve({ id: l.call.id }) }));
    expect(r.status).toBe(200);
    expect(r.body.iceServers[1]).toEqual(CLOUDFLARE_TURN(1));
    expect(JSON.stringify(r.body)).not.toContain(TOKEN);
    // Anyone else: "This call isn't available." and nothing asked of Cloudflare, on the page or through the room.
    const stranger = await makeUser({ tester: true, name: "Ben Okafor" });
    const n = sent.length;
    const other = await openPage(stranger.user, l.call.id);
    expect(room(other)).toBeUndefined();
    expect(find(other, (e) => "data-call-line" in e.props)!.props.children).toBe(CALL_NOT_AVAILABLE);
    await expect(roomSend(stranger.user, l.call.id, "join", null)).rejects.toMatchObject({ status: 403, message: CALL_NOT_AVAILABLE });
    const r2 = await json(await roomPOST(req(`/api/calls/${l.call.id}/room`, { cookie: stranger.cookie, body: { kind: "join" } }), { params: Promise.resolve({ id: l.call.id }) }));
    expect(r2.status).toBe(403);
    expect(JSON.stringify(r2.body)).not.toContain("short-lived");
    expect(sent).toHaveLength(n);
    // A cancelled call (the page shows its line instead of the room): no credentials made.
    clearTurnCache();
    await db.call.update({ where: { id: l.call.id }, data: { status: "cancelled", cancelledBy: "developer", cancelledAt: new Date() } });
    const cancelled = room(await openPage(l.dev.user, l.call.id))!;
    expect(cancelled.initialLine).toBe("This call was cancelled.");
    expect(cancelled.iceServers).toEqual([GOOGLE]);
    expect(sent).toHaveLength(n);
    // Only one of the two settings: Cloudflare isn't asked (Google's STUN, plus TURN_URL when set).
    await db.call.update({ where: { id: l.call.id }, data: { status: "booked", cancelledBy: null, cancelledAt: null } });
    vi.stubEnv("CLOUDFLARE_TURN_API_TOKEN", "");
    expect(room(await openPage(l.tester.user, l.call.id))!.iceServers).toEqual([GOOGLE]);
    expect(sent).toHaveLength(n);
  });
});

describe("batch 35 §135: the settings box and the ?relay=1 note", () => {
  const NOW = new Date("2026-11-03T12:00:00Z");
  const msgs = (env: Record<string, string>) => configProblems(env, NOW).map((p) => p.message);
  const halfKey = "CLOUDFLARE_TURN_KEY_ID is set without CLOUDFLARE_TURN_API_TOKEN: set both (from the same Cloudflare TURN key), or calls don't use the Cloudflare relay.";
  const halfToken = "CLOUDFLARE_TURN_API_TOKEN is set without CLOUDFLARE_TURN_KEY_ID: set both (from the same Cloudflare TURN key), or calls don't use the Cloudflare relay.";

  it("the relay is set up with the Cloudflare pair or TURN_URL; only one of the pair warns (never stopping the build)", () => {
    expect(msgs({ NODE_ENV: "production" })).toContain(NO_RELAY);
    expect(msgs({ NODE_ENV: "production", CLOUDFLARE_TURN_KEY_ID: "k", CLOUDFLARE_TURN_API_TOKEN: "t" }).filter((m) => /TURN/.test(m))).toEqual([]);
    expect(msgs({ NODE_ENV: "production", TURN_URL: "turn:turn.example:3478" }).filter((m) => /TURN/.test(m))).toEqual([]);
    expect(msgs({ CLOUDFLARE_TURN_KEY_ID: "k" })).toEqual([halfKey]);
    expect(msgs({ CLOUDFLARE_TURN_API_TOKEN: "t" })).toEqual([halfToken]);
    expect(msgs({ CLOUDFLARE_TURN_KEY_ID: "k", CLOUDFLARE_TURN_API_TOKEN: " " })).toEqual([halfKey]); // blank counts as missing
    expect(configProblems({ NODE_ENV: "production", CLOUDFLARE_TURN_KEY_ID: "k" }, NOW).filter((p) => /TURN/.test(p.message))).toEqual([
      { message: halfKey, stopsBuild: false },
      { message: NO_RELAY, stopsBuild: false },
    ]);
    expect(msgs({ NODE_ENV: "production", CLOUDFLARE_TURN_KEY_ID: "k", TURN_URL: "turn:turn.example:3478" }).filter((m) => /TURN/.test(m))).toEqual([halfKey]);
    expect(turnRelaySetUp({})).toBe(false);
    expect(turnRelaySetUp({ CLOUDFLARE_TURN_KEY_ID: "k" })).toBe(false);
    expect(turnRelaySetUp({ CLOUDFLARE_TURN_KEY_ID: "k", CLOUDFLARE_TURN_API_TOKEN: "t" })).toBe(true);
    expect(turnRelaySetUp({ TURN_URL: "turn:turn.example:3478" })).toBe(true);
  });

  it("?relay=1 says no TURN relay is set up only when neither the Cloudflare pair nor TURN_URL is set", async () => {
    const l = await liveCall();
    cloudflare();
    const note = async () => {
      const tree = await openPage(l.tester.user, l.call.id, true);
      expect(room(tree)!.relayOnly).toBe(true);
      return find(tree, (e) => "data-relay-only" in e.props)!.props.children;
    };
    expect(await note()).toBe(RELAY_WORKS);
    vi.stubEnv("CLOUDFLARE_TURN_API_TOKEN", "");
    expect(await note()).toBe(RELAY_MISSING);
    vi.stubEnv("TURN_URL", "turn:turn.example:3478");
    expect(await note()).toBe(RELAY_WORKS);
  });
});
