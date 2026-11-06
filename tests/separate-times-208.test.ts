import React, { cloneElement, createElement as h, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { callsTaken, sentToday } from "@/lib/server/requests";
import { RequestRows, SEPARATE_TIMES_NOTE, sentLine, type RowState } from "@/components/RequestRows";
import { callRoomLine, clashNotes, localFmt, sentRoomLine } from "@/lib/callClash";
import { act, atHours, joined, oldChooseOne, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 5, §208) "+ Another time" sends each time (row) as its OWN request: N rows make N independent requests, each counting toward the §185 limits (3 in
// total per pair, 3 sends a day); a press that would pass either is refused as a whole with how many more can go; rows overlapping each other are refused; each
// request is answered on its own. Older "choose one" requests still waiting keep working as before.

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

const devReq = (testId: string, cookie: string, contractIds: string[], extra: Record<string, unknown>) =>
  act(testId, "request-time", cookie, { seenAt: seen(), confirmed: true, contractIds, minutes: 30, ...extra });
const testerReq = (sessionId: string, cookie: string, extra: Record<string, unknown>) => sact(sessionId, "request-time", cookie, { seenAt: seen(), confirmed: true, minutes: 30, ...extra });
const once = (startsAt: string) => ({ startsAt, repeat: "once", count: 1 });
const pendingOf = (contractId: string, fromSide?: string) => db.callRequest.findMany({ where: { contractId, status: "pending", ...(fromSide ? { fromSide } : {}) }, orderBy: { startsAt: "asc" } });
const devAnswer = (testId: string, cookie: string, contractId: string, requestId: string, action: string, extra: Record<string, unknown> = {}) =>
  act(testId, "answer-request", cookie, { contractId, requestId, action, seenAt: seen(), confirmed: true, ...extra });
const testerAnswer = (sessionId: string, cookie: string, requestId: string, action: string, extra: Record<string, unknown> = {}) =>
  sact(sessionId, "answer-request", cookie, { requestId, action, seenAt: seen(), confirmed: true, ...extra });
const iso = (d: Date) => d.toISOString();

describe("§208 each time is its own request", () => {
  it("tester: 3 rows make 3 requests (each one time); one live line and one bell per request, each linking to its own; the developer's box lists 3", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const T = [atHours(50), atHours(74), atHours(98)];
    const r = await testerReq(j.sessionId, j.tester.cookie, { rows: T.map(once) });
    expect(r.status).toBe(200);
    expect(r.body.ids).toHaveLength(3);
    expect(sentLine(r.body)).toBe("3 requests sent.");
    const reqs = await pendingOf(j.sessionId, "tester");
    expect(reqs.map((q) => [q.times.map(iso), q.weeks, (q.rows as unknown[]).length])).toEqual(T.map((t) => [[t], 0, 1]));
    expect(new Set(reqs.map((q) => q.id))).toEqual(new Set(r.body.ids));
    expect(await callsTaken(j.sessionId)).toBe(3);
    expect(await sentToday(j.sessionId, "tester", null)).toBe(3);
    // One "requested" line per request, each linking to its own row; one bell per request.
    const events = await db.testEvent.findMany({ where: { testId: s.testId, kind: "requested" } });
    expect(events).toHaveLength(3);
    expect(new Set(events.map((e) => e.link))).toEqual(new Set(reqs.map((q) => `req-${q.id}`)));
    const bells = await db.notification.findMany({ where: { userId: s.dev.user.id, text: { startsWith: "Ana Silva asked for a call on “Harbor Run”: " } } });
    expect(bells).toHaveLength(3);
    expect(new Set(bells.map((b) => b.link))).toEqual(new Set(reqs.map((q) => `/app/tests/${s.testId}#req-${q.id}`)));
    for (const b of bells) expect(b.text).not.toContain(" or ");
    // The developer's Requests to you: 3 requests, one row each (an older "one of" request would show 3 rows for 1).
    auth.user = await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } });
    const html = await testPage(s.testId);
    const a = html.slice(html.indexOf("data-requests-to-you"));
    expect(a).toContain('(<span data-call-requests-count="">3</span>)');
    expect(a).toMatch(/· 3 requests</);
    expect([...a.matchAll(/data-request-id="([^"]+)"/g)].map((m) => m[1]).filter((x, i, l) => l.indexOf(x) === i).sort()).toEqual(reqs.map((q) => q.id).sort());
  });

  it("each is answered on its own: Accept books one and never closes the others; Decline another; the third still waits", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const T = [atHours(50), atHours(74), atHours(98)];
    expect((await testerReq(j.sessionId, j.tester.cookie, { rows: T.map(once) })).status).toBe(200);
    const [r1, r2, r3] = await pendingOf(j.sessionId, "tester");
    const a = await devAnswer(s.testId, s.dev.cookie, j.sessionId, r2.id, "accept");
    expect(a.status).toBe(200);
    expect((await db.call.findUniqueOrThrow({ where: { id: a.body.callId } })).startsAt.toISOString()).toBe(T[1]);
    expect((await pendingOf(j.sessionId)).map((q) => q.id)).toEqual([r1.id, r3.id]);
    await settle();
    expect((await devAnswer(s.testId, s.dev.cookie, j.sessionId, r1.id, "decline")).status).toBe(200);
    expect((await pendingOf(j.sessionId)).map((q) => q.id)).toEqual([r3.id]);
    await settle();
    const b = await devAnswer(s.testId, s.dev.cookie, j.sessionId, r3.id, "accept");
    expect(b.status).toBe(200);
    expect(await db.call.count({ where: { contractId: j.sessionId, status: "booked" } })).toBe(2);
  });

  it("developer: 3 rows to 2 ticked testers are 3 requests to each (a batch per row); the first tester to accept a row takes it, the other rows stay with both", async () => {
    const s = await setup({ spots: 5 });
    const ana = await joined(s.testId);
    const ben = await joined(s.testId, "Ben Carter", "he");
    const T = [atHours(50), atHours(74), atHours(98)];
    const r = await devReq(s.testId, s.dev.cookie, [ana.sessionId, ben.sessionId], { rows: [once(T[0]), { startsAt: T[1], repeat: "weekly", count: 2 }, once(T[2])] });
    expect(r.status).toBe(200);
    expect(r.body.ids).toHaveLength(6);
    expect(r.body.batchIds).toHaveLength(3);
    const anaReqs = await pendingOf(ana.sessionId), benReqs = await pendingOf(ben.sessionId);
    expect(anaReqs.map((q) => q.startsAt.toISOString())).toEqual(T);
    expect(benReqs.map((q) => q.batchId)).toEqual(anaReqs.map((q) => q.batchId));
    expect(anaReqs[1]).toMatchObject({ weeks: 2, repeat: "weekly" });
    // One live line per row ("You requested a call from … with 2 testers").
    const events = await db.testEvent.findMany({ where: { testId: s.testId, kind: "requested" } });
    expect(events.map((e) => e.text).filter((t) => t.endsWith("with 2 testers"))).toHaveLength(3);
    // Ana takes the first row: Ben's copy of it is taken; every other row still waits with both.
    expect((await testerAnswer(ana.sessionId, ana.tester.cookie, anaReqs[0].id, "accept")).status).toBe(200);
    expect((await db.callRequest.findUniqueOrThrow({ where: { id: benReqs[0].id } })).status).toBe("taken");
    expect((await pendingOf(ana.sessionId)).map((q) => q.id)).toEqual([anaReqs[1].id, anaReqs[2].id]);
    expect((await pendingOf(ben.sessionId)).map((q) => q.id)).toEqual([benReqs[1].id, benReqs[2].id]);
    // Ben takes the weekly row: 2 calls for him; Ana's copy is taken.
    await settle();
    expect((await testerAnswer(ben.sessionId, ben.tester.cookie, benReqs[1].id, "accept")).body.calls).toBe(2);
    expect((await db.callRequest.findUniqueOrThrow({ where: { id: anaReqs[1].id } })).status).toBe("taken");
    expect((await pendingOf(ana.sessionId)).map((q) => q.id)).toEqual([anaReqs[2].id]);
  });

  it("the total of 3: a press that would pass it is refused as a whole, saying how many more can go; nothing is made", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    // 2 already: one waiting from each side.
    expect((await testerReq(j.sessionId, j.tester.cookie, { rows: [once(atHours(40))] })).status).toBe(200);
    expect((await devReq(s.testId, s.dev.cookie, [j.sessionId], { rows: [once(atHours(44))] })).status).toBe(200);
    const before = await db.callRequest.count({ where: { contractId: j.sessionId } });
    const t = await testerReq(j.sessionId, j.tester.cookie, { rows: [once(atHours(50)), once(atHours(74))] });
    expect(t.status).toBe(409);
    expect(t.body.error.message).toBe("You already have 2 calls or requests with Nora Lane: you can send 1 more.");
    expect(t.body.error.code).toBe("limit"); // a single refusal, never a stop first
    const d = await devReq(s.testId, s.dev.cookie, [j.sessionId], { rows: [once(atHours(52)), once(atHours(76)), once(atHours(100))] });
    expect(d.body.error.message).toBe("You already have 2 calls or requests with Ana Silva: you can send 1 more.");
    expect(await db.callRequest.count({ where: { contractId: j.sessionId } })).toBe(before);
    // One time fits.
    expect((await testerReq(j.sessionId, j.tester.cookie, { rows: [once(atHours(50))] })).status).toBe(200);
    expect(callRoomLine("Ana Silva", 1)).toBe("You already have 1 call or request with Ana Silva: you can send 2 more.");
    expect(callRoomLine("Ana Silva", 3)).toMatch(/^You already have 3 calls booked or requested with Ana Silva\. /);
  });

  it("3 sends a day: a press that would pass it is refused as a whole (\"You can send 1 more request to … today.\"); nothing is made", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    // 2 sent today, both withdrawn (so the total is 0).
    expect((await testerReq(j.sessionId, j.tester.cookie, { rows: [once(atHours(40)), once(atHours(44))] })).status).toBe(200);
    for (const q of await pendingOf(j.sessionId)) expect((await testerAnswer(j.sessionId, j.tester.cookie, q.id, "withdraw")).status).toBe(200);
    expect(await callsTaken(j.sessionId)).toBe(0);
    const t = await testerReq(j.sessionId, j.tester.cookie, { rows: [once(atHours(50)), once(atHours(74))] });
    expect(t.body.error.message).toBe("You can send 1 more request to Nora Lane today.");
    expect(await sentToday(j.sessionId, "tester", null)).toBe(2);
    expect((await testerReq(j.sessionId, j.tester.cookie, { rows: [once(atHours(50))] })).status).toBe(200);
    // The developer's side the same, by the developer's own count.
    const d1 = await devReq(s.testId, s.dev.cookie, [j.sessionId], { rows: [once(atHours(60)), once(atHours(84))] });
    expect(d1.status).toBe(200);
    for (const q of await pendingOf(j.sessionId, "developer")) expect((await devAnswer(s.testId, s.dev.cookie, j.sessionId, q.id, "withdraw")).status).toBe(200);
    const d2 = await devReq(s.testId, s.dev.cookie, [j.sessionId], { rows: [once(atHours(62)), once(atHours(86))] });
    expect(d2.body.error.message).toBe("You can send 1 more request to Ana Silva today.");
    expect(sentRoomLine("Ana Silva", 1)).toBe("You can send 2 more requests to Ana Silva today.");
    expect(sentRoomLine("Ana Silva", 3)).toBe("You've sent 3 call requests to Ana Silva today. You can send more tomorrow.");
  });

  it("several ticked testers: one the press doesn't fit is named in the \"Press again to send to the others\" box; the second press sends to the others", async () => {
    const s = await setup({ spots: 5 });
    const ana = await joined(s.testId);
    const ben = await joined(s.testId, "Ben Carter", "he");
    expect((await testerReq(ana.sessionId, ana.tester.cookie, { rows: [once(atHours(40)), once(atHours(44))] })).status).toBe(200);
    const rows = [once(atHours(50)), once(atHours(74))];
    const first = await devReq(s.testId, s.dev.cookie, [ana.sessionId, ben.sessionId], { rows });
    expect(first.body.error.code).toBe("stop_once");
    const text = first.body.error.limitSeen as string;
    expect(text).toBe("You already have 2 calls or requests with Ana Silva: you can send 1 more.");
    expect(first.body.error.tail).toBe("Press again to send to the others (Ben Carter).");
    expect(await db.callRequest.count({ where: { testId: s.testId, fromSide: "developer" } })).toBe(0);
    const second = await devReq(s.testId, s.dev.cookie, [ana.sessionId, ben.sessionId], { rows, limitSeen: text });
    expect(second.status).toBe(200);
    expect((await pendingOf(ben.sessionId, "developer")).map((q) => q.startsAt.toISOString())).toEqual(rows.map((r) => r.startsAt));
    expect(await pendingOf(ana.sessionId, "developer")).toHaveLength(0);
  });

  it("rows overlapping each other are refused (at the row); a row overlapping a request between the two is refused as before; nothing is made", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const t = atHours(50);
    const plus = (m: number) => new Date(new Date(t).getTime() + m * 60_000).toISOString();
    const r = await testerReq(j.sessionId, j.tester.cookie, { rows: [once(t), once(plus(15))] });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/^Overlaps time 1 in this form \(/);
    // A weekly row whose 2nd call overlaps another row of the same press.
    const d = await devReq(s.testId, s.dev.cookie, [j.sessionId], { rows: [once(plus(7 * 24 * 60)), { startsAt: plus(10), repeat: "weekly", count: 2 }] });
    expect(d.status).toBe(409);
    expect(d.body.error.message).toMatch(/^Overlaps time 1 in this form \(/);
    expect(await db.callRequest.count({ where: { contractId: j.sessionId } })).toBe(0);
    // A waiting request between the two at one row's time: that press refused, nothing made.
    expect((await testerReq(j.sessionId, j.tester.cookie, { rows: [once(t)] })).status).toBe(200);
    const again = await testerReq(j.sessionId, j.tester.cookie, { rows: [once(atHours(80)), once(plus(10))] });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/^You already have a request with Nora Lane waiting for that time/);
    expect(await db.callRequest.count({ where: { contractId: j.sessionId } })).toBe(1);
  });

  it("a row exactly at the other side's waiting time books it (auto-match); the press's other rows are sent as requests", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const t = atHours(50), t2 = atHours(74);
    expect((await devReq(s.testId, s.dev.cookie, [j.sessionId], { rows: [once(t)] })).status).toBe(200);
    const r = await testerReq(j.sessionId, j.tester.cookie, { rows: [once(t), once(t2)] });
    expect(r.status).toBe(200);
    expect(r.body.booked).toBe(true);
    expect(r.body.ids).toHaveLength(1);
    expect((await db.call.findUniqueOrThrow({ where: { id: r.body.callId } })).startsAt.toISOString()).toBe(t);
    expect((await pendingOf(j.sessionId)).map((q) => [q.fromSide, q.startsAt.toISOString()])).toEqual([["tester", t2]]);
    // Both count as sends today; the total is 1 booked + 1 waiting.
    expect(await sentToday(j.sessionId, "tester", null)).toBe(2);
    expect(await callsTaken(j.sessionId)).toBe(2);
  });

  it("an older \"choose one\" request still waiting keeps working as before: one request, Accept on one time closes the rest", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const T = [atHours(50), atHours(74), atHours(98)];
    const old = await oldChooseOne(j.sessionId, "tester", T);
    expect(await callsTaken(j.sessionId)).toBe(1);
    const a = await devAnswer(s.testId, s.dev.cookie, j.sessionId, old.id, "accept", { time: T[2] });
    expect(a.status).toBe(200);
    expect((await db.call.findUniqueOrThrow({ where: { id: a.body.callId } })).startsAt.toISOString()).toBe(T[2]);
    expect((await db.callRequest.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("booked");
    expect(await db.call.count({ where: { contractId: j.sessionId } })).toBe(1);
    expect(await pendingOf(j.sessionId)).toHaveLength(0);
  });
});

describe("§208 the form", () => {
  const row = (when: string): RowState => ({ when, repeat: "once", count: "4" });
  const render = (rows: RowState[]) => renderToStaticMarkup(h(RequestRows, { rows, setRows: () => {}, minNow: "" }));
  it("2 or 3 rows: \"Each time is sent as its own request.\" (never \"pick one of these\"); 1 row: no note", () => {
    expect(SEPARATE_TIMES_NOTE).toBe("Each time is sent as its own request.");
    for (const n of [2, 3]) {
      const html = render(Array.from({ length: n }, (_, i) => row(`2026-11-1${i}T15:00`)));
      expect(html).toContain(`data-separate-times="">${SEPARATE_TIMES_NOTE}</p>`);
      expect(html).not.toMatch(/one of these|picks? one/i);
    }
    expect(render([row("2026-11-10T15:00")])).not.toContain("data-separate-times");
    expect(sentLine({ ids: ["a"] })).toBe("Request sent.");
    expect(sentLine({ booked: true, callId: "c" })).toBe("Request sent.");
  });
  it("the form's limit line counts each row: 2 taken and 2 new rows read how many more can go; an exact match adds nothing", () => {
    const fmt = localFmt("UTC");
    const target = { name: "Ana Silva", calls: [], requests: [], pending: 1, booked: 1 };
    const rows = [once("2026-11-10T15:00:00.000Z"), once("2026-11-11T15:00:00.000Z")] as { startsAt: string; repeat: "once"; count: number }[];
    expect(clashNotes({ rows: rows.slice(0, 1), minutes: 30, side: "developer", targets: [target], elsewhere: [], fmt }).limits).toEqual([]);
    expect(clashNotes({ rows, minutes: 30, side: "developer", targets: [target], elsewhere: [], fmt }).limits).toEqual(["You already have 2 calls or requests with Ana Silva: you can send 1 more."]);
    const theirs = { ...target, requests: [{ rows: rows.slice(0, 1), minutes: 30, mine: false }] };
    expect(clashNotes({ rows, minutes: 30, side: "developer", targets: [theirs], elsewhere: [], fmt }).limits).toEqual([]);
    // Two rows of the form overlapping: red on the later one, "in this form".
    const two = clashNotes({ rows: [once("2026-11-10T15:00:00.000Z"), once("2026-11-10T15:15:00.000Z")] as typeof rows, minutes: 30, side: "tester", targets: [], elsewhere: [], fmt });
    expect(two.rows[1][0]).toEqual({ tone: "red", text: "Overlaps time 1 in this form (Tue, Nov 10, 3:00–3:30 PM)." });
  });
});
