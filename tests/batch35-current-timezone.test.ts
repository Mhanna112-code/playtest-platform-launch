import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fmtDateIn } from "@/lib/format";
import { fmtDate, fmtDateTime } from "@/lib/server/dateFormat";
import { dateZone, withDateZone } from "@/lib/server/dateZone";
import { handle, HttpError } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { db } from "@/lib/db";
import { bellKeyIn } from "@/lib/bell";
import { endOfDayIn, type Listing } from "@/lib/rules";
import { panelRows } from "@/lib/listingPanel";
import { makeUser, req } from "./helpers";
import { setup, joined, bookCall } from "./fixtures";
import { GET as liveGET } from "@/app/api/live/route";
import { POST as testAction } from "@/app/api/tests/[id]/[action]/route";
import { fmtIn } from "@/lib/tz";
import { hasTimeTokens } from "@/lib/tz";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/app/tests/example", useSearchParams: () => new URLSearchParams() }));
(globalThis as unknown as { React: typeof React }).React = React;
const CENTRAL = "America/Chicago";
const close = endOfDayIn("2026-11-09", CENTRAL);

describe("dates use the current viewer zone, not the server's UTC date", () => {
  it("the same instant reads Nov 9 in Chicago and Nov 10 in UTC or Tokyo", () => {
    expect(close.toISOString()).toBe("2026-11-10T05:59:59.000Z");
    expect(fmtDateIn(close, CENTRAL)).toBe("Nov 9, 2026");
    expect(fmtDateIn(close, "UTC")).toBe("Nov 10, 2026");
    expect(fmtDateIn(close, "Asia/Tokyo")).toBe("Nov 10, 2026");
  });

  it("parallel and nested rendering scopes never share a viewer's zone", async () => {
    const values = await Promise.all([CENTRAL, "Asia/Tokyo", "UTC"].map(zone => withDateZone(zone, async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      const before = fmtDate(close);
      expect(withDateZone("Pacific/Honolulu", () => fmtDate(close))).toBe("Nov 9, 2026");
      await Promise.resolve();
      expect(dateZone()).toBe(zone);
      expect(fmtDate(close)).toBe(before);
      return before;
    })));
    expect(values).toEqual(["Nov 9, 2026", "Nov 10, 2026", "Nov 10, 2026"]);
    expect(dateZone()).toBe("UTC");
  });

  it("an API refusal uses the browser's current zone before the saved zone catches up", async () => {
    const person = await makeUser({ tester: true });
    await db.user.update({ where: { id: person.user.id }, data: { timeZone: "Asia/Tokyo" } });
    const request = req("/api/example", { cookie: person.cookie, headers: { "x-timezone": CENTRAL } });
    const res = await handle(async () => {
      await requireUser(request);
      throw new HttpError(409, "closed", `Closed on ${fmtDate(close)} (${fmtDateTime(close)}).`);
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain("Closed on Nov 9, 2026");
    expect(body.error.message).toContain("11:59 PM");
    expect(dateZone()).toBe("UTC");
  });

  it.each([undefined, "Not/AZone"])("API fallback uses the account zone for an absent or invalid browser zone (%s)", async zone => {
    const person = await makeUser({ dev: true });
    await db.user.update({ where: { id: person.user.id }, data: { timeZone: CENTRAL } });
    const response = await handle(async () => {
      await requireUser(req("/api/example", { cookie: person.cookie, headers: zone ? { "x-timezone": zone } : {} }));
      return Response.json({ date: fmtDate(close) });
    });
    expect((await response.json()).date).toBe("Nov 9, 2026");
  });

  it("the developer header and Listing before / now use the same local day", async () => {
    const { TopPanel } = await import("@/app/app/tests/[id]/TopPanel");
    const html = renderToStaticMarkup(React.createElement(TopPanel, { id: "example", title: "Example", status: "open", terms: "", spotsLine: "1 spot", seenAt: new Date().toISOString(), working: [], nextRoundId: null, openUntil: close.toISOString(), timeZone: CENTRAL }));
    expect(html).toContain("Open until (last day to join) Nov 9, 2026");
    const listing = { openUntil: close.toISOString() } as Listing;
    const saved = { fields: ["openUntil"], before: { openUntil: endOfDayIn("2026-11-04", CENTRAL).toISOString() }, after: {}, at: new Date() };
    for (const side of ["developer", "tester"] as const) {
      const row = panelRows(listing, saved, side, CENTRAL).find(r => r.key === "openUntil")!;
      expect(row.now).toBe("Nov 9, 2026");
      expect(row.before).toBe("Nov 4, 2026");
    }
  });

  it("Post / Edit retain the selected calendar date, while converting saved instants in the developer zone", async () => {
    const { formDay } = await import("@/app/app/tests/TestForm");
    expect(formDay("2026-11-09", CENTRAL)).toBe("2026-11-09");
    expect(formDay(close.toISOString(), CENTRAL)).toBe("2026-11-09");
    expect(formDay(close.toISOString(), "UTC")).toBe("2026-11-10");
    expect(fmtDateIn(endOfDayIn(formDay(close.toISOString(), CENTRAL), CENTRAL), CENTRAL)).toBe("Nov 9, 2026");
  });

  it("a stored call notice uses each later reader's current zone, rather than freezing the sender's zone", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    const since = new Date(Date.now() - 500).toISOString();
    const call = await bookCall(f.testId, f.dev.cookie, j.sessionId, j.tester.cookie, 48);
    const event = await db.testEvent.findFirstOrThrow({ where: { testId: f.testId, kind: "booked" } });
    expect(hasTimeTokens(event.text)).toBe(true);
    for (const zone of [CENTRAL, "Asia/Tokyo"]) {
      const res = await liveGET(req(`/api/live?scope=test:${f.testId}&since=${encodeURIComponent(since)}`, { cookie: f.dev.cookie, headers: { "x-timezone": zone } }));
      expect(res.status).toBe(200);
      const lines = (await res.json()).changes as { text: string }[];
      expect(lines.map(line => line.text)).toContain(`Ana Silva booked a call for ${fmtIn(zone, call.startsAt)}`);
      expect(lines.some(line => hasTimeTokens(line.text))).toBe(false);
      const stopped = await testAction(req(`/api/tests/${f.testId}/next-round`, { cookie: f.dev.cookie, body: { seenAt: since }, headers: { "x-timezone": zone } }), { params: Promise.resolve({ id: f.testId, action: "next-round" }) });
      const error = (await stopped.json()).error;
      expect(error.code).toBe("stop_once");
      expect(error.changes.map((line: { text: string }) => line.text)).toContain(`Ana Silva booked a call for ${fmtIn(zone, call.startsAt)}`);
      expect(error.changes.some((line: { text: string }) => hasTimeTokens(line.text))).toBe(false);
    }
  });

  it("bell grouping follows local midnight, rather than splitting one local day's updates at UTC midnight", () => {
    const n = { id: "1", testId: "test", own: false, createdAt: new Date("2026-11-10T00:30:00Z") };
    const earlier = { ...n, id: "2", createdAt: new Date("2026-11-09T23:30:00Z") };
    expect(bellKeyIn(n, CENTRAL)).toBe(bellKeyIn(earlier, CENTRAL));
    expect(bellKeyIn(n, "UTC")).not.toBe(bellKeyIn(earlier, "UTC"));
  });
});
