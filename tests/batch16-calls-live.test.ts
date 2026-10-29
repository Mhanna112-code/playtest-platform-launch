import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { clashNotes, localFmt } from "@/lib/callClash";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { json, req } from "./helpers";
import { act, atHours, bookCall, joined, sact, seen, setup } from "./fixtures";

// Batch 16 sections 33 and 35: live call panels, one Call requests panel, clash checks before the press (and again on the server); Needs you opens the panel.
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const fmt = localFmt("UTC");
const H = 3_600_000;
const at = (iso: string) => iso;
const once = (startsAt: string) => ({ startsAt, repeat: "once" as const, count: 1 });

describe("clash checks (section 33)", () => {
  const base = "2026-11-02T13:38:00.000Z"; // Mon, Nov 2, 1:38 PM UTC
  it("exact match with their waiting request: blue, not red; an overlap with their request, with your call, with another of your calls, and between two rows: red", () => {
    const exact = clashNotes({ rows: [once(base)], minutes: 10, side: "developer", targets: [{ name: "fbbb", calls: [], requests: [{ rows: [once(base)], minutes: 10, mine: false }] }], elsewhere: [], fmt });
    expect(exact.rows[0]).toEqual([{ tone: "blue", text: "fbbb asked for exactly this: Request a time books it." }]);
    const near = clashNotes({ rows: [once("2026-11-02T13:30:00.000Z")], minutes: 30, side: "developer", targets: [{ name: "fbbb", calls: [], requests: [{ rows: [once(base)], minutes: 10, mine: false }] }], elsewhere: [], fmt });
    expect(near.rows[0]).toEqual([{ tone: "red", text: "Overlaps fbbb's request for Mon, Nov 2, 1:38–1:48 PM." }]);
    const call = clashNotes({ rows: [once(base)], minutes: 30, side: "developer", targets: [{ name: "fbbb", calls: [{ start: "2026-11-02T13:30:00.000Z", minutes: 30 }], requests: [] }], elsewhere: [], fmt });
    expect(call.rows[0][0].text).toBe("Overlaps your call with fbbb on Mon, Nov 2, 1:30–2:00 PM.");
    const other = clashNotes({ rows: [once(base)], minutes: 30, side: "developer", targets: [{ name: "fbbb", calls: [], requests: [] }], elsewhere: [{ name: "Ana Silva", start: "2026-11-02T13:30:00.000Z", minutes: 30 }], fmt });
    expect(other.rows[0][0].text).toBe("You have a call with Ana Silva then (1:30–2:00 PM).");
    const two = clashNotes({ rows: [once(base), once("2026-11-02T13:50:00.000Z")], minutes: 30, side: "tester", targets: [], elsewhere: [], fmt });
    expect(two.rows[0]).toEqual([]);
    expect(two.rows[1][0]).toEqual({ tone: "red", text: "Overlaps time 1 in this request (Mon, Nov 2, 1:38–2:08 PM)." });
    // Nothing is checked until the length is known.
    expect(clashNotes({ rows: [once(base)], minutes: null, side: "developer", targets: [{ name: "fbbb", calls: [{ start: base, minutes: 30 }], requests: [] }], elsewhere: [], fmt }).rows[0]).toEqual([]);
  });

  it("a weekly set names the first call that clashes; the limits in today's wording", () => {
    const week = clashNotes({ rows: [{ startsAt: "2026-10-29T15:00:00.000Z", repeat: "weekly", count: 4 }], minutes: 30, side: "developer", targets: [{ name: "fbbb", calls: [{ start: "2026-11-12T15:10:00.000Z", minutes: 30 }], requests: [] }], elsewhere: [], fmt });
    expect(week.rows[0][0].text).toBe("The 3rd call (Thu, Nov 12) overlaps your call with fbbb on Thu, Nov 12, 3:10–3:40 PM.");
    const lim = clashNotes({ rows: [once(at("2026-11-02T13:38:00.000Z"))], minutes: 60, side: "developer", targets: [
      { name: "A", calls: [], requests: [], pending: 3 },
      { name: "B", calls: [], requests: [], booked: 3 },
      { name: "C", calls: [], requests: [], leftCents: 400, rateCents: 3000 }, // (batch 18 section 6) under 10 minutes left: nothing can be booked
    ], elsewhere: [], fmt });
    expect(lim.limits[0]).toBe("You already have 3 requests waiting with A. Withdraw one or wait for an answer.");
    expect(lim.limits[1]).toBe("B already has 3 booked times with you. Wait until one is over or cancel one.");
    expect(lim.limits[2]).toMatch(/^Calls with C on this test can come to at most \$1,000; \$4\.00 is left, so this call can't be booked\.$/);
  });
});

describe("live panels, the one Call requests panel, and the server's re-check (sections 33 and 35)", () => {
  it("the owner's case: the tester asked for a time; the developer's same time books it at once and both requests leave the panel", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "fbbb");
    const startsAt = atHours(72);
    const v1 = (await json(await pulseGET(req(`/api/pulse?test=${testId}`, { cookie: dev.cookie, method: "GET" })))).body.v;
    expect((await sact(sessionId, "request-time", tester.cookie, { startsAt, minutes: 10, seenAt: seen(), confirmed: true })).status).toBe(200);
    // Live: the request arrived while the developer's page was open: the page's fingerprint changes (the panel refreshes).
    expect((await json(await pulseGET(req(`/api/pulse?test=${testId}`, { cookie: dev.cookie, method: "GET" })))).body.v).not.toBe(v1);
    const r = await act(testId, "request-time", dev.cookie, { contractIds: [sessionId], startsAt, minutes: 10, seenAt: seen(), confirmed: true });
    expect(r.body.message).toMatch(/^Booked: you both picked /);
    expect(await db.callRequest.count({ where: { contractId: sessionId, status: "pending" } })).toBe(0);
    expect(await db.call.count({ where: { contractId: sessionId, status: "booked" } })).toBe(1);
  });

  it("the server re-checks the developer's other calls: refused with the form's line", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const ana = await joined(testId, "Ana Silva");
    const ben = await joined(testId, "Ben Okafor");
    const call = await bookCall(testId, dev.cookie, ana.sessionId, ana.tester.cookie, 72);
    const clash = new Date(call.startsAt.getTime() + 10 * 60_000).toISOString();
    const r = await act(testId, "request-time", dev.cookie, { contractIds: [ben.sessionId], startsAt: clash, minutes: 30, seenAt: seen(), confirmed: true });
    expect(r.body.error.message).toMatch(/^You have a call with Ana Silva then \(.+\)\.$/);
    // Fine an hour later.
    expect((await act(testId, "request-time", dev.cookie, { contractIds: [ben.sessionId], startsAt: new Date(call.startsAt.getTime() + 2 * H).toISOString(), minutes: 30, seenAt: seen(), confirmed: true })).status).toBe(200);
  });

  it("the panel, the forms and Needs you (source)", () => {
    const panel = src("components/CallRequestsPanel.tsx");
    expect(panel).toContain('<h3 className="text-sm font-semibold text-white">Call requests</h3>');
    expect(panel).toContain("id={`req-${r.id}`}");
    expect(panel).toContain("asked by {r.mine ? \"you\" : r.asker}");
    expect(src("app/app/tests/[id]/DevCallPanel.tsx")).toContain('<CallRequestsPanel side="developer"');
    expect(src("components/CallRequests.tsx")).toContain("<CallRequestsPanel side={p.side}");
    expect(src("components/RequestRows.tsx")).toContain('data-clash={x.tone}');
    expect(src("app/app/tests/[id]/DevCallPanel.tsx")).toContain("notes={clash.notes}");
    expect(src("components/CallRequests.tsx")).toContain("notes={clash.notes}");
    // Needs you: no Accept / Decline of its own; the row opens the panel at the request.
    const needs = src("app/app/tests/[id]/NeedsRequests.tsx");
    expect(needs).not.toMatch(/acceptChoices|>Decline</);
    expect(needs).toContain("Answer in Live session →");
    expect(needs).toContain("jumpTo(`req-${id}`)");
    const dash = src("app/app/page.tsx");
    expect(dash).toContain("href: `/app/tests/${x.t.id}#req-${r.id}`");
    expect(dash).toContain("href: `/app/sessions/${c.id}#req-${r.id}`");
  });
});
