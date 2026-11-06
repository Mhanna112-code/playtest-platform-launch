import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { GET as liveGET } from "@/app/api/live/route";
import { callsTaken, sentToday } from "@/lib/server/requests";
import { joinCall } from "@/lib/server/blocks";
import { HttpError } from "@/lib/server/http";
import { matchesName, noMatchLine } from "@/components/CallRequestsPanel";
import { clashNotes, localFmt } from "@/lib/callClash";
import { bellKeyIn, groupTitle } from "@/lib/bell";
import { json, makeUser, req } from "./helpers";
import { act, atHours, joined, oldChooseOne, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 4, §185) Calls with one person on a test: 3 in total (booked times + waiting requests, both sides), 3 sends a day per side, two request boxes on the
// developer's page (Requests to you / Your requests, each with a name search), the other side's withdrawal never a stop (one refusal when answered, a quiet live
// line), new requests / answers / cancellations still stop per Alerts, and a Join or Cancel on a cancelled call refused once.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, requireOpenPage: async () => auth.user, adminAway: () => {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), redirect: () => { throw Error("redirect"); }, notFound: () => { throw Error("not found"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

async function serverTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(React.Children.toArray(node).map(serverTree));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === "function" && element.type.constructor.name === "AsyncFunction") {
    const resolved = await (element.type as (props: unknown) => Promise<ReactNode>)(element.props);
    return serverTree(isValidElement(resolved) && element.key !== null ? cloneElement(resolved, { key: element.key }) : resolved);
  }
  return element.props.children === undefined ? element : cloneElement(element, {}, await serverTree(element.props.children));
}
const testPage = async (testId: string) => {
  const { default: Page } = await import("@/app/app/tests/[id]/page");
  return renderToStaticMarkup(await serverTree(await Page({ params: Promise.resolve({ id: testId }), searchParams: Promise.resolve({}) })));
};
const sessionPage = async (sessionId: string) => {
  const { default: Page } = await import("@/app/app/sessions/[id]/page");
  return renderToStaticMarkup(await serverTree(await Page({ params: Promise.resolve({ id: sessionId }), searchParams: Promise.resolve({}) })));
};

const later = () => new Promise((r) => setTimeout(r, 30));
const devReq = (testId: string, cookie: string, contractId: string, extra: Record<string, unknown>) =>
  act(testId, "request-time", cookie, { seenAt: seen(), confirmed: true, contractIds: [contractId], minutes: 30, ...extra });
const testerReq = (sessionId: string, cookie: string, extra: Record<string, unknown>) => sact(sessionId, "request-time", cookie, { seenAt: seen(), confirmed: true, minutes: 30, ...extra });
const newest = (contractId: string, fromSide: string) => db.callRequest.findFirstOrThrow({ where: { contractId, fromSide, status: "pending" }, orderBy: { createdAt: "desc" } });
const devAnswer = (testId: string, cookie: string, contractId: string, requestId: string, action: string, extra: Record<string, unknown> = {}) =>
  act(testId, "answer-request", cookie, { contractId, requestId, action, seenAt: seen(), confirmed: true, ...extra });
const testerAnswer = (sessionId: string, cookie: string, requestId: string, action: string, extra: Record<string, unknown> = {}) =>
  sact(sessionId, "answer-request", cookie, { requestId, action, seenAt: seen(), confirmed: true, ...extra });
type Line = { text: string; quiet?: boolean };
const live = async (scope: string, cookie: string, since: string) =>
  (await json(await liveGET(req(`/api/live?scope=${scope}&since=${encodeURIComponent(since)}`, { cookie, method: "GET" })))).body.changes as Line[];
const ANA_FULL = "You already have 3 calls booked or requested with Ana Silva. Wait until one is answered, over or cancelled, or withdraw a request.";
const NORA_FULL = "You already have 3 calls booked or requested with Nora Lane. Wait until one is answered, over or cancelled, or withdraw a request.";

/** Two calls booked between them, each from a request the OTHER side sent (so the requester's sends today stay low). */
async function twoBooked(by: "tester" | "developer") {
  const f = await setup();
  const a = await joined(f.testId);
  for (const h of [40, 44]) {
    if (by === "tester") {
      expect((await testerReq(a.sessionId, a.tester.cookie, { times: [atHours(h)] })).status).toBe(200);
      expect((await devAnswer(f.testId, f.dev.cookie, a.sessionId, (await newest(a.sessionId, "tester")).id, "accept")).status).toBe(200);
    } else {
      expect((await devReq(f.testId, f.dev.cookie, a.sessionId, { times: [atHours(h)] })).status).toBe(200);
      expect((await testerAnswer(a.sessionId, a.tester.cookie, (await newest(a.sessionId, "developer")).id, "accept")).status).toBe(200);
    }
  }
  expect(await callsTaken(a.sessionId)).toBe(2);
  return { ...f, ...a };
}

describe("§185 the limit: 3 in total per pair (booked + waiting, both sides)", () => {
  it("developer: 2 booked, sending 2 requests: the first goes, the second is refused on the first press (no stop first)", async () => {
    const f = await twoBooked("tester");
    const loaded = new Date(Date.now() - 60_000).toISOString(); // before the bookings: a press from this page would stop for them
    expect((await devReq(f.testId, f.dev.cookie, f.sessionId, { times: [atHours(60)] })).status).toBe(200);
    const second = await act(f.testId, "request-time", f.dev.cookie, { seenAt: loaded, contractIds: [f.sessionId], minutes: 30, times: [atHours(70)] });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({ code: "limit", message: ANA_FULL });
    expect(await callsTaken(f.sessionId)).toBe(3);
  });

  it("tester: 2 booked, sending 2 requests: the first goes, the second is refused with the developer's name", async () => {
    const f = await twoBooked("developer");
    const loaded = new Date(Date.now() - 60_000).toISOString();
    expect((await testerReq(f.sessionId, f.tester.cookie, { times: [atHours(60)] })).status).toBe(200);
    const second = await sact(f.sessionId, "request-time", f.tester.cookie, { seenAt: loaded, loadedAt: loaded, minutes: 30, times: [atHours(70)] });
    expect(second.body.error).toMatchObject({ code: "limit", message: NORA_FULL });
    // The other side's request counts too: the developer can't send either.
    expect((await devReq(f.testId, f.dev.cookie, f.sessionId, { times: [atHours(80)] })).body.error.message).toBe(ANA_FULL);
  });

  it("Accept and auto-match turn a request into a booking (the count stays 3); a pair over 3 from before is refused at Accept", async () => {
    const f = await twoBooked("tester");
    // Third: the tester's request at T. At 3, the developer's request for exactly T auto-matches (it books hers: nothing new).
    const T = atHours(60);
    expect((await testerReq(f.sessionId, f.tester.cookie, { times: [T] })).status).toBe(200);
    const matched = await devReq(f.testId, f.dev.cookie, f.sessionId, { times: [T] });
    expect(matched.body.booked).toBe(true);
    expect(await callsTaken(f.sessionId)).toBe(3);
    // 3 booked: nothing more from either side.
    expect((await devReq(f.testId, f.dev.cookie, f.sessionId, { times: [atHours(90)] })).body.error.message).toBe(ANA_FULL);
    // A pair over 3 from before the limit (rows written directly): Accept is refused at once, naming the other person.
    const old = await db.callRequest.create({ data: { testId: f.testId, contractId: f.sessionId, fromSide: "tester", startsAt: new Date(atHours(100)), minutes: 30, times: [new Date(atHours(100))] } });
    const r = await act(f.testId, "answer-request", f.dev.cookie, { contractId: f.sessionId, requestId: old.id, action: "accept", seenAt: new Date(Date.now() - 600_000).toISOString() });
    expect(r.body.error).toMatchObject({ code: "limit", message: ANA_FULL });
    expect((await db.callRequest.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("pending");
  });

  it("an accepted request leaves room (3 → 3); a running Forever set is one booked time even with no call ahead", async () => {
    const f = await twoBooked("developer");
    expect((await devReq(f.testId, f.dev.cookie, f.sessionId, { times: [atHours(60)] })).status).toBe(200);
    expect(await callsTaken(f.sessionId)).toBe(3);
    expect((await testerAnswer(f.sessionId, f.tester.cookie, (await newest(f.sessionId, "developer")).id, "accept")).body.booked).toBe(true);
    expect(await callsTaken(f.sessionId)).toBe(3);
    const g = await setup();
    const b = await joined(g.testId, "Ben Carter", "he");
    await db.callSet.create({ data: { testId: g.testId, contractId: b.sessionId, repeat: "weekly", count: 0, minutes: 30, rateCents: null, nextAt: new Date(Date.now() + 40 * 86_400_000) } });
    expect(await callsTaken(b.sessionId)).toBe(1);
  });

  it("the developer's form shows the same line at 3, but not for an exact match with their request", () => {
    const fmt = localFmt("UTC");
    const at = atHours(60);
    const target = { name: "Ana Silva", calls: [], requests: [], pending: 1, booked: 2, leftCents: null };
    expect(clashNotes({ rows: [{ startsAt: at, repeat: "once", count: 1 }], minutes: 30, side: "developer", targets: [target], elsewhere: [], fmt }).limits).toEqual([ANA_FULL]);
    const theirs = { ...target, requests: [{ rows: [{ startsAt: at, repeat: "once" as const, count: 1 }], minutes: 30, mine: false }] };
    expect(clashNotes({ rows: [{ startsAt: at, repeat: "once", count: 1 }], minutes: 30, side: "developer", targets: [theirs], elsewhere: [], fmt }).limits).toEqual([]);
  });
});

describe("§185 sends a day: at most 3 call requests a day to the same person, each side", () => {
  it("tester: 3 sends (one withdrawn) then the 4th is refused at once; withdrawing is unlimited; the next day she can send again", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    for (const h of [50, 60, 70]) expect((await testerReq(a.sessionId, a.tester.cookie, { times: [atHours(h)] })).status).toBe(200);
    expect((await testerAnswer(a.sessionId, a.tester.cookie, (await newest(a.sessionId, "tester")).id, "withdraw")).status).toBe(200);
    expect(await callsTaken(a.sessionId)).toBe(2); // room under the 3-total: the day's sends refuse it
    const fourth = await sact(a.sessionId, "request-time", a.tester.cookie, { seenAt: new Date(Date.now() - 600_000).toISOString(), minutes: 30, times: [atHours(80)] });
    expect(fourth.body.error).toMatchObject({ code: "limit", message: "You've sent 3 call requests to Nora Lane today. You can send more tomorrow." });
    // Withdrawing never counts and is never limited.
    for (const r of await db.callRequest.findMany({ where: { contractId: a.sessionId, status: "pending" } })) expect((await testerAnswer(a.sessionId, a.tester.cookie, r.id, "withdraw")).status).toBe(200);
    // A day later (her rows moved back a day): she can send again.
    await db.callRequest.updateMany({ where: { contractId: a.sessionId }, data: { createdAt: new Date(Date.now() - 26 * 3_600_000) } });
    expect((await testerReq(a.sessionId, a.tester.cookie, { times: [atHours(80)] })).status).toBe(200);
  });

  it("developer: the 4th send to the same tester today is refused (one declined counts); another tester is not affected; an auto-match counts as one", async () => {
    const f = await setup({ spots: 5 });
    const a = await joined(f.testId);
    const b = await joined(f.testId, "Ben Carter", "he");
    expect((await devReq(f.testId, f.dev.cookie, a.sessionId, { times: [atHours(50)] })).status).toBe(200);
    expect((await testerAnswer(a.sessionId, a.tester.cookie, (await newest(a.sessionId, "developer")).id, "decline")).status).toBe(200);
    // Her request at T: the developer's request for T books it (an auto-match: one send).
    const T = atHours(55);
    expect((await testerReq(a.sessionId, a.tester.cookie, { times: [T] })).status).toBe(200);
    expect((await devReq(f.testId, f.dev.cookie, a.sessionId, { times: [T] })).body.booked).toBe(true);
    expect((await devReq(f.testId, f.dev.cookie, a.sessionId, { times: [atHours(60)] })).status).toBe(200);
    expect(await sentToday(a.sessionId, "developer", "")).toBe(3);
    expect((await devReq(f.testId, f.dev.cookie, a.sessionId, { times: [atHours(70)] })).body.error).toMatchObject({ code: "limit", message: "You've sent 3 call requests to Ana Silva today. You can send more tomorrow." });
    expect((await devReq(f.testId, f.dev.cookie, b.sessionId, { times: [atHours(70)] })).status).toBe(200);
    // Ticking both: Ana is named in the box, Ben's goes on the second press.
    const both = await act(f.testId, "request-time", f.dev.cookie, { seenAt: seen(), contractIds: [a.sessionId, b.sessionId], minutes: 30, times: [atHours(75)] });
    expect(both.body.error.code).toBe("stop_once");
    expect(both.body.error.limitSeen).toBe("You've sent 3 call requests to Ana Silva today.");
  });

  it("the day is the sender's own calendar day in their saved zone", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    const now = new Date("2026-11-05T04:30:00Z"); // 11:30 PM on Nov 4 in New York
    const row = (iso: string) => db.callRequest.create({ data: { testId: f.testId, contractId: a.sessionId, fromSide: "tester", startsAt: new Date(atHours(100)), minutes: 30, times: [], status: "withdrawn", createdAt: new Date(iso) } });
    await row("2026-11-04T03:00:00Z"); // 11 PM on Nov 3 in New York
    await row("2026-11-04T05:00:00Z"); // 1 AM on Nov 4 in New York
    await row("2026-11-05T01:00:00Z"); // 9 PM on Nov 4 in New York
    expect(await sentToday(a.sessionId, "tester", "America/New_York", db, now)).toBe(2);
    expect(await sentToday(a.sessionId, "tester", "UTC", db, now)).toBe(1); // in UTC it is already Nov 5: only the 01:00 one
  });
});

describe("§185 withdrawals: never a stop for the other side; one refusal when answered; a quiet live line", () => {
  it("the tester withdraws: the developer's next press goes; his Accept on it reads 'Ana Silva withdrew this request.' once; his live line is quiet", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    expect((await testerReq(a.sessionId, a.tester.cookie, { times: [atHours(50)] })).status).toBe(200);
    const r = await newest(a.sessionId, "tester");
    await later();
    const loaded = seen();
    await later();
    expect((await testerAnswer(a.sessionId, a.tester.cookie, r.id, "withdraw")).status).toBe(200);
    await settle();
    const accept = await act(f.testId, "answer-request", f.dev.cookie, { contractId: a.sessionId, requestId: r.id, action: "accept", seenAt: loaded });
    expect(accept.body.error).toMatchObject({ code: "gone", message: "Ana Silva withdrew this request." });
    // Another press from the same old page: no stop for the withdrawal.
    expect((await act(f.testId, "request-time", f.dev.cookie, { seenAt: loaded, contractIds: [a.sessionId], minutes: 30, times: [atHours(60)] })).status).toBe(200);
    const lines = (await live(`test:${f.testId}`, f.dev.cookie, loaded)).filter((l) => /withdrew/.test(l.text));
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toMatch(/^Ana Silva withdrew a call request for /);
    expect(lines[0].quiet).toBe(true);
  });

  it("the developer withdraws: the tester's next press goes; her Accept reads 'Nora Lane withdrew this request.' once; her live line is quiet", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    expect((await devReq(f.testId, f.dev.cookie, a.sessionId, { times: [atHours(50)] })).status).toBe(200);
    const r = await newest(a.sessionId, "developer");
    await later();
    const loaded = seen();
    await later();
    expect((await devAnswer(f.testId, f.dev.cookie, a.sessionId, r.id, "withdraw")).status).toBe(200);
    await settle();
    const accept = await sact(a.sessionId, "answer-request", a.tester.cookie, { requestId: r.id, action: "accept", seenAt: loaded, loadedAt: loaded });
    expect(accept.body.error).toMatchObject({ code: "gone", message: "Nora Lane withdrew this request." });
    expect((await sact(a.sessionId, "request-time", a.tester.cookie, { seenAt: loaded, loadedAt: loaded, minutes: 30, times: [atHours(60)] })).status).toBe(200);
    const lines = (await live(`session:${a.sessionId}`, a.tester.cookie, loaded)).filter((l) => /withdrew/.test(l.text));
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toMatch(/^Nora Lane withdrew the request for /);
    expect(lines[0].quiet).toBe(true);
  });
});

describe("§185 a new request, an answer and a cancellation still stop per Alerts", () => {
  it("the tester's new request stops the developer's press once (Call changes); ticked in Alerts, it doesn't", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    const loaded = seen();
    await later();
    expect((await testerReq(a.sessionId, a.tester.cookie, { times: [atHours(50)] })).status).toBe(200);
    await settle();
    const press = () => act(f.testId, "request-time", f.dev.cookie, { seenAt: loaded, contractIds: [a.sessionId], minutes: 30, times: [atHours(60)] });
    expect((await press()).body.error.code).toBe("stop_once");
    await db.test.update({ where: { id: f.testId }, data: { ignoredAlerts: ["calls"] } });
    expect((await press()).status).toBe(200);
  });

  it("the developer declining her request, and cancelling a booked call, stop the tester's press once", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    expect((await testerReq(a.sessionId, a.tester.cookie, { times: [atHours(50)] })).status).toBe(200);
    const r = await newest(a.sessionId, "tester");
    let loaded = seen();
    await later();
    expect((await devAnswer(f.testId, f.dev.cookie, a.sessionId, r.id, "decline")).status).toBe(200);
    await settle();
    const press = (at: string, h: number) => sact(a.sessionId, "request-time", a.tester.cookie, { seenAt: at, loadedAt: at, minutes: 30, times: [atHours(h)] });
    expect((await press(loaded, 60)).body.error.code).toBe("stop_once");
    // A booked call, then the developer cancels it.
    expect((await devReq(f.testId, f.dev.cookie, a.sessionId, { times: [atHours(70)] })).status).toBe(200);
    expect((await testerAnswer(a.sessionId, a.tester.cookie, (await newest(a.sessionId, "developer")).id, "accept")).status).toBe(200);
    const call = await db.call.findFirstOrThrow({ where: { contractId: a.sessionId, status: "booked" } });
    await later();
    loaded = seen();
    await later();
    expect((await act(f.testId, "cancel-call", f.dev.cookie, { callId: call.id, seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    expect((await press(loaded, 80)).body.error.code).toBe("stop_once");
  });
});

describe("§185 Join or Cancel on a call already cancelled: refused once; the row leaves the booked list", () => {
  it("both sides' Cancel and Join from an old page: a single refusal, never a stop first; the call is in the Live session's Cancelled (§209)", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    expect((await devReq(f.testId, f.dev.cookie, a.sessionId, { times: [atHours(50)] })).status).toBe(200);
    expect((await testerAnswer(a.sessionId, a.tester.cookie, (await newest(a.sessionId, "developer")).id, "accept")).status).toBe(200);
    const call = await db.call.findFirstOrThrow({ where: { contractId: a.sessionId, status: "booked" } });
    const loaded = seen();
    await later();
    expect((await sact(a.sessionId, "cancel-call", a.tester.cookie, { callId: call.id, seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    // The developer's old page (the tester's cancel would stop any other press there): his Cancel is refused at once.
    const dev1 = await act(f.testId, "cancel-call", f.dev.cookie, { callId: call.id, seenAt: loaded });
    expect(dev1.body.error.code).toBe("cancelled");
    expect(dev1.body.error.message).toMatch(/^The call with Ana Silva was already cancelled\./);
    const t1 = await sact(a.sessionId, "cancel-call", a.tester.cookie, { callId: call.id, seenAt: loaded, loadedAt: loaded });
    expect(t1.body.error.code).toBe("cancelled");
    expect(t1.body.error.message).toMatch(/^Your call with Nora Lane on .+ was already cancelled\.$/);
    // Join: one refusal, marked cancelled (the button goes).
    const devUser = await db.user.findUniqueOrThrow({ where: { id: f.dev.user.id } });
    const e = await joinCall(devUser, call.id).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).message).toMatch(/^Your Join call didn't go through: Ana Silva cancelled this call at /);
    expect((e as HttpError).data).toMatchObject({ cancelled: true });
    // The tester's page: not in the booked list; in the Live session's Cancelled (N) with its Cancelled badge (§209; was §186's Call history).
    auth.user = await db.user.findUniqueOrThrow({ where: { id: a.tester.user.id } });
    const html = await sessionPage(a.sessionId);
    expect(html).not.toContain(`id="call-${call.id}" data-call="booked"`);
    const hist = html.slice(html.indexOf('data-calls-cancelled="1"'));
    expect(html).not.toContain('data-call-history=""');
    expect(hist.indexOf(`id="call-${call.id}"`)).toBeGreaterThan(0);
    expect(hist.indexOf("Cancelled by you")).toBeGreaterThan(0);
  });
});

describe("§185 two request boxes on the developer's page, each with a name search", () => {
  it("Requests to you (theirs: Accept / Decline) and Your requests (yours: Withdraw), by person, oldest first; Needs you points at Requests to you", async () => {
    const f = await setup({ spots: 5 });
    const ana = await joined(f.testId);
    const ben = await joined(f.testId, "Ben Carter", "he");
    expect((await testerReq(ben.sessionId, ben.tester.cookie, { times: [atHours(50)] })).status).toBe(200);
    await later();
    expect((await testerReq(ana.sessionId, ana.tester.cookie, { times: [atHours(52)] })).status).toBe(200);
    // (§208) An older "one of" request (2 times in one request): none is made now, but one still waiting keeps its rows.
    await oldChooseOne(ana.sessionId, "tester", [atHours(54), atHours(56)]);
    expect((await devReq(f.testId, f.dev.cookie, ana.sessionId, { times: [atHours(60)] })).status).toBe(200);
    auth.user = await db.user.findUniqueOrThrow({ where: { id: f.dev.user.id } });
    const html = await testPage(f.testId);
    const toYou = html.indexOf("data-requests-to-you"), yours = html.indexOf("data-your-requests");
    expect(toYou).toBeGreaterThan(0);
    expect(yours).toBeGreaterThan(toYou);
    const a = html.slice(toYou, yours), b = html.slice(yours);
    expect(a).toContain('<h2 class="inline">Call requests to you</h2> <span class="text-sm font-normal text-slate-400">(<span data-call-requests-count="">3</span>)</span>');
    expect(b).toContain('<h2 class="inline">Call requests you sent</h2> <span class="text-sm font-normal text-slate-400">(<span data-call-requests-count="">1</span>)</span>');
    // Each box open, with its own search; people in the order of their oldest request (Ben asked first), closed.
    expect(a).toContain('data-request-search="to-you"');
    expect(b).toContain('data-request-search="yours"');
    expect([...a.matchAll(/data-call-requests-person="([^"]+)"/g)].map((m) => m[1])).toEqual([ben.sessionId, ana.sessionId]);
    expect(a).toContain(`id="call-requests-person-${ana.sessionId}"`);
    // (Owner, Nov 4, §187) The whole name (cut only when the row is full), then "· N requests"; her "one of" request (2 times) is one row per time: 3 rows for 2 requests.
    expect(a).toMatch(/Ana Silva<\/span><\/a><\/span><span class="shrink-0 whitespace-nowrap font-normal text-slate-400">· 2 requests<\/span>/);
    expect([...a.matchAll(/data-request-id="([^"]+)"/g)].length).toBe(4);
    expect([...b.matchAll(/data-call-requests-person="([^"]+)"/g)].map((m) => m[1])).toEqual([ana.sessionId]);
    expect(b).toContain(`id="your-requests-person-${ana.sessionId}"`);
    expect(a).toContain("Decline</button>");
    expect(a).not.toContain("Withdraw</button>");
    expect(b).toContain("Withdraw</button>");
    expect(b).not.toContain("Decline</button>");
    expect(a).toContain('id="call-requests"');
    expect(b).toContain('id="your-requests"');
    // Needs you's line for Ana jumps to her group in Requests to you.
    expect(html).toContain(`href="#call-requests-person-${ana.sessionId}">2 call requests ↓</a>`);
    // The search: case-insensitive, anywhere in the name as shown; nobody: the line.
    expect(matchesName("Ana Silva", "SIL")).toBe(true);
    expect(matchesName("Ana Silva", " ana ")).toBe(true);
    expect(matchesName("Ben Carter", "ana")).toBe(false);
    expect(noMatchLine(" zed ")).toBe("No one matches “zed”");
  });

  it("the tester's session page splits hers the same way: Requests to you / Your requests (no search: one person)", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    expect((await devReq(f.testId, f.dev.cookie, a.sessionId, { times: [atHours(50)] })).status).toBe(200);
    expect((await testerReq(a.sessionId, a.tester.cookie, { times: [atHours(60)] })).status).toBe(200);
    auth.user = await db.user.findUniqueOrThrow({ where: { id: a.tester.user.id } });
    const html = await sessionPage(a.sessionId);
    const toYou = html.indexOf('id="call-requests"'), yours = html.indexOf('id="your-requests"');
    expect(toYou).toBeGreaterThan(0);
    expect(yours).toBeGreaterThan(toYou);
    expect(html.slice(toYou, yours)).toContain('Call requests to you<span class="font-normal text-slate-400"> (1)</span>');
    expect(html.slice(toYou, yours)).toContain("Decline</button>");
    expect(html.slice(yours)).toContain('Call requests you sent<span class="font-normal text-slate-400"> (1)</span>');
    expect(html.slice(yours)).toContain("Withdraw</button>");
    expect(html).not.toContain("data-request-search=");
  });
});

describe("§185 the other side's withdrawal and a request a booking closed: a bell, stacked per test and day", () => {
  it("a withdrawal rings the other person once (both ways), in the test's \"Call requests · N closed today\" stack", async () => {
    const f = await setup();
    const a = await joined(f.testId);
    expect((await testerReq(a.sessionId, a.tester.cookie, { times: [atHours(50)] })).status).toBe(200);
    expect((await testerAnswer(a.sessionId, a.tester.cookie, (await newest(a.sessionId, "tester")).id, "withdraw")).status).toBe(200);
    expect((await devReq(f.testId, f.dev.cookie, a.sessionId, { times: [atHours(60)] })).status).toBe(200);
    expect((await devAnswer(f.testId, f.dev.cookie, a.sessionId, (await newest(a.sessionId, "developer")).id, "withdraw")).status).toBe(200);
    const devBells = await db.notification.findMany({ where: { userId: f.dev.user.id, groupKey: `reqclosed:${f.testId}` } });
    expect(devBells.map((n) => n.text)).toEqual([expect.stringMatching(/^Ana Silva withdrew a call request for .+ (AM|PM)/)]);
    expect(devBells[0].link).toBe(`/app/tests/${f.testId}`);
    const herBells = await db.notification.findMany({ where: { userId: a.tester.user.id, groupKey: `reqclosed:${f.testId}` } });
    expect(herBells.map((n) => n.text)).toEqual([expect.stringMatching(/^Nora Lane withdrew a call request for /)]);
    expect(herBells[0].link).toBe(`/app/sessions/${a.sessionId}`);
    // Her own withdrawal never rings her.
    expect(await db.notification.count({ where: { userId: a.tester.user.id, text: { startsWith: "Ana Silva withdrew" } } })).toBe(0);
  });

  it("the stack: one entry per test and day, titled with its count", () => {
    const at = new Date("2026-11-04T15:00:00Z");
    const n = (id: string, testId: string) => ({ id, testId, own: false, groupKey: `reqclosed:${testId}`, createdAt: at });
    expect(bellKeyIn(n("1", "t1"), "UTC")).toBe(bellKeyIn(n("2", "t1"), "UTC"));
    expect(bellKeyIn(n("1", "t1"), "UTC")).not.toBe(bellKeyIn(n("3", "t2"), "UTC"));
    expect(groupTitle("reqclosed:t1", 1, 3)).toBe("Call requests · 3 closed today");
    expect(groupTitle("appwithdrawn:t1", 1, 2)).toBe("Applications · 2 withdrawn today");
  });
});

describe("§185 a tester withdrawing her application: no live line, no stop; a bell to the developer", () => {
  it("nothing in the developer's live box; a bell in the test's \"Applications · N withdrawn today\" stack; Accept from the old page is one refusal", async () => {
    const f = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    expect((await act(f.testId, "apply", ana.cookie, { note: "hi" })).body).toEqual({ applied: true });
    const app = await db.application.findFirstOrThrow({ where: { testId: f.testId, testerId: ana.user.id } });
    await later();
    const loaded = seen();
    await later();
    expect((await act(f.testId, "withdraw-application", ana.cookie, {})).body).toEqual({ withdrawn: true });
    await settle();
    expect(await db.testEvent.count({ where: { testId: f.testId, text: { contains: "withdrew" } } })).toBe(0);
    expect((await live(`test:${f.testId}`, f.dev.cookie, loaded)).filter((l) => /withdrew/.test(l.text))).toEqual([]);
    const bells = await db.notification.findMany({ where: { userId: f.dev.user.id, groupKey: `appwithdrawn:${f.testId}` } });
    expect(bells.map((n) => n.text)).toEqual([expect.stringMatching(/^Ana Silva withdrew her application to “.+”$/)]);
    const acc = await act(f.testId, "application", f.dev.cookie, { applicationId: app.id, action: "accept", seenAt: loaded });
    expect(acc.body.error).toMatchObject({ code: "gone", message: "Ana Silva withdrew her application." });
  });
});
