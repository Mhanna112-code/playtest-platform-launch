import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as pulseGET } from "@/app/api/pulse/route";
import {
  CallRequestsPanel, GONE_SHOWN_MS, KEEP_UNKNOWN_MS, NO_GONE, keepLeft, nextGoneChange, pruneGone, shownRequests, withAnswer, type Closing, type GoneState, type PanelReq,
} from "@/components/CallRequestsPanel";
import { TIME_PASSED_REASON } from "@/lib/server/requests";
import { json, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 5, §228 fix; recording B6) A request that stops waiting shows what happened for 6 seconds from ANY cause, then leaves: the box's own press, the
// other side's action (by the page's redraw or by the box's own check), its time passing, and with the page's live updates held back. The 6 seconds count from
// when the line first shows. Before: an Accept on the page showed no line (gone 1.0 s after the press), the tester's Withdraw showed none (gone at the redraw),
// and a held-back Withdraw showed its line for 0.2 s.

(globalThis as unknown as { React: typeof React }).React = React; // the components' JSX in the tests' render
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");
const S = 1_000;
const ROW = { startsAt: "2026-11-20T15:00:00.000Z", repeat: "once" as const, count: 1 };
const r = (id: string): PanelReq => ({ id, contractId: "c1", tester: "Ana Silva", asker: "Ana Silva", rows: [ROW], minutes: 30, mine: false, rate: "Contract $31/h" });
const ids = (s: GoneState, list: PanelReq[], t: number) => shownRequests(s, list, t).map((x) => x.id);
const A = r("a"), B = r("b");

describe("§228 fix: the box's list state (useClosingRequests' pure steps)", () => {
  it("your own press: its line comes from the check sent at once, then the redraw drops it; the row stays 6 s from the line, then leaves", () => {
    // t=0 the Accept went through: the panel checks at once; the line ("Booked") is back at 0.2 s, before the redraw.
    let s = withAnswer(NO_GONE, ["a", "b"], [{ id: "a", line: "Booked", bookedAt: ROW.startsAt }], 0, 0.2 * S);
    expect(s.lines.a).toEqual({ line: "Booked", bookedAt: ROW.startsAt });
    // 1.0 s: the page's redraw drops it (recording B6: the row was gone here, with no line ever shown).
    s = keepLeft(s, [A, B], [B], 1.0 * S);
    expect(ids(s, [B], 1.0 * S)).toEqual(["b", "a"]);
    expect(ids(s, [B], 0.2 * S + GONE_SHOWN_MS - 1)).toEqual(["b", "a"]);
    expect(ids(s, [B], 0.2 * S + GONE_SHOWN_MS)).toEqual(["b"]);
    expect(nextGoneChange(s, 1.0 * S)).toBe(0.2 * S + GONE_SHOWN_MS - 1.0 * S);
    expect(pruneGone(s, 0.2 * S + GONE_SHOWN_MS).kept).toEqual({});
  });

  it("the other side via the page's redraw: the row is kept (no buttons, no line) until the server says what happened, then 6 s from THAT", () => {
    // 12.7 s: the redraw drops the request the tester withdrew in their own tab.
    let s = keepLeft(NO_GONE, [A, B], [B], 12.7 * S);
    expect(s.kept.a.req).toBe(A);
    expect(ids(s, [B], 12.7 * S)).toEqual(["b", "a"]);
    expect(s.lines.a).toBeUndefined(); // no guessed line meanwhile
    // The check sent on the drop answers at 12.9 s: "Withdrawn".
    s = withAnswer(s, ["b", "a"], [{ id: "a", line: "Withdrawn" }], 12.75 * S, 12.9 * S);
    expect(s.lines.a.line).toBe("Withdrawn");
    expect(ids(s, [B], 12.9 * S + GONE_SHOWN_MS - 1)).toEqual(["b", "a"]);
    expect(ids(s, [B], 12.9 * S + GONE_SHOWN_MS)).toEqual(["b"]);
  });

  it("the other side via the box's own check: the line shows while the page still lists it, and it leaves 6 s later even before any redraw", () => {
    const s = withAnswer(NO_GONE, ["a", "b"], [{ id: "a", line: "Declined" }], 4 * S, 4.1 * S);
    expect(ids(s, [A, B], 4.1 * S)).toEqual(["a", "b"]);
    expect(ids(s, [A, B], 4.1 * S + GONE_SHOWN_MS)).toEqual(["b"]);
    // A redraw after its time doesn't bring it back.
    const later = keepLeft(s, [A, B], [B], 11 * S);
    expect(later.kept).toEqual({});
    expect(ids(later, [B], 11 * S)).toEqual(["b"]);
    // A later check that still finds it closed keeps its first shown time (never a fresh 6 s).
    expect(withAnswer(s, ["a"], [{ id: "a", line: "Declined" }], 8 * S, 8.1 * S).shownAt.a).toBe(4.1 * S);
  });

  it("held-back live updates (Dee's case): the line at 7.5 s, the redraw at 7.7 s; the row stays until 13.5 s, not 0.2 s", () => {
    let s = withAnswer(NO_GONE, ["a"], [{ id: "a", line: "Withdrawn" }], 7.4 * S, 7.5 * S);
    s = keepLeft(s, [A], [], 7.7 * S);
    expect(ids(s, [], 7.7 * S)).toEqual(["a"]);
    expect(ids(s, [], 13.4 * S)).toEqual(["a"]);
    expect(ids(s, [], 13.5 * S)).toEqual([]);
  });

  it("expiry reads like any close; a dropped request the server says still waits leaves at once with no line; no answer at all: after KEEP_UNKNOWN_MS", () => {
    let s = keepLeft(NO_GONE, [A], [], 5 * S);
    s = withAnswer(s, ["a"], [{ id: "a", line: `Closed: ${TIME_PASSED_REASON}` }], 5.05 * S, 5.1 * S);
    expect(s.lines.a.line).toBe("Closed: its time passed");
    // Still waiting by the server (the page left it out for another reason): no false line, it just goes. A check sent BEFORE the drop doesn't count.
    let w = keepLeft(NO_GONE, [A], [], 5 * S);
    expect(withAnswer(w, ["a"], [], 4.9 * S, 5.1 * S).kept.a).toBeDefined();
    w = withAnswer(w, ["a"], [], 5.05 * S, 5.1 * S);
    expect(w.kept).toEqual({});
    expect(w.lines.a).toBeUndefined();
    // Offline: kept with no line, then gone.
    const off = keepLeft(NO_GONE, [A], [], 5 * S);
    expect(ids(off, [], 5 * S + KEEP_UNKNOWN_MS - 1)).toEqual(["a"]);
    expect(ids(off, [], 5 * S + KEEP_UNKNOWN_MS)).toEqual([]);
    // Back on the page's list (the server put it back): no longer kept.
    expect(keepLeft(off, [], [A], 6 * S).kept).toEqual({});
  });
});

describe("§228 fix: the panel draws it", () => {
  const closing = (c: Partial<Closing>): Closing => ({ lines: {}, left: () => false, check: () => {}, ...c });
  const draw = (c: Closing, list: PanelReq[]) => renderToStaticMarkup(h(CallRequestsPanel, { side: "developer", seenAt: "2026-11-05T00:00:00Z", requests: list, path: () => "/api/tests/t1", panelId: "call-requests-t1", closing: c }));
  it("a closed request's row says what happened, no buttons; a dropped one waiting for its line shows no buttons and no line", () => {
    const withLine = draw(closing({ lines: { a: { line: "Withdrawn" } }, left: (id) => id === "a" }), [A]);
    expect(withLine).toContain('data-request-gone="">Withdrawn</span>');
    expect(withLine).not.toContain(">Decline</button>");
    const waiting = draw(closing({ left: (id) => id === "a" }), [A]);
    expect(waiting).toContain("data-request-closing");
    expect(waiting).not.toContain("data-request-gone");
    expect(waiting).not.toContain(">Decline</button>");
    expect(draw(closing({}), [A])).toContain(">Decline</button>");
  });

  it("held over the whole box on both pages; the test page always draws the box; your own press checks at once", () => {
    const panel = src("components/CallRequestsPanel.tsx");
    expect(panel).toContain("closing.check(); // (Owner, Nov 5, §228 fix) your own press");
    expect(panel).toContain("const lost = lostRefusal(at, error, live.filter((r) => !closing.left(r.id)));");
    expect(src("app/app/tests/[id]/CallRequestsBox.tsx")).toContain("const { shown, closing } = useClosingRequests(requests);");
    expect(src("components/CallRequests.tsx")).toContain("const { shown: reqsShown, closing } = useClosingRequests(");
    const page = src("app/app/tests/[id]/page.tsx");
    expect(page).toContain("      <CallRequestsBox testId={t.id} seenAt={seenAt} requests={callRequests} leadMinutes={CALL_MIN_AHEAD_MINUTES} />");
    expect(page).not.toContain("callRequests.length > 0 && <CallRequestsBox");
  });
});

describe("§228 fix: the pulse names what happened (the lines the rows show)", () => {
  it("the other side's Accept: Booked; your own Withdraw: Withdrawn; a time that passed: Closed: its time passed (the page lists only times ahead)", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    const at = (days: number) => {
      const d = new Date(Date.now() + days * 86_400_000);
      d.setUTCSeconds(0, 0);
      return d.toISOString();
    };
    const ask = async (days: number) => {
      expect((await act(testId, "request-time", dev.cookie, { contractIds: [j.sessionId], startsAt: at(days), minutes: "30", seenAt: seen(), confirmed: true })).status).toBe(200);
      await settle();
      return (await db.callRequest.findFirstOrThrow({ where: { contractId: j.sessionId, status: "pending" }, orderBy: { createdAt: "desc" } })).id;
    };
    const a = await ask(3), b = await ask(5), c = await ask(7);
    const poll = async (cookie: string) => (await json(await pulseGET(req(`/api/pulse?requests=${[a, b, c].join(",")}`, { cookie, method: "GET" })))).body.gone as { id: string; line: string; bookedAt?: string }[];
    expect(await poll(dev.cookie)).toEqual([]);
    // The tester accepts a (the developer's page: the other side).
    expect((await sact(j.sessionId, "answer-request", j.tester.cookie, { requestId: a, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
    // The developer withdraws c (their own press).
    expect((await act(testId, "answer-request", dev.cookie, { contractId: j.sessionId, requestId: c, action: "withdraw", seenAt: seen(), confirmed: true })).status).toBe(200);
    // b's time passes while nothing has closed it yet.
    await db.callRequest.update({ where: { id: b }, data: { startsAt: new Date(Date.now() - 60_000) } });
    expect((await db.callRequest.findUniqueOrThrow({ where: { id: b } })).status).toBe("pending");
    const gone = new Map((await poll(dev.cookie)).map((x) => [x.id, x]));
    expect(gone.get(a)?.line).toBe("Booked");
    expect(gone.get(a)?.bookedAt).toBeTruthy();
    expect(gone.get(b)?.line).toBe("Closed: its time passed");
    expect(gone.get(c)?.line).toBe("Withdrawn");
    // The tester's session page reads the same.
    const theirs = new Map((await poll(j.tester.cookie)).map((x) => [x.id, x.line]));
    expect([theirs.get(a), theirs.get(b), theirs.get(c)]).toEqual(["Booked", "Closed: its time passed", "Withdrawn"]);
  });
});
