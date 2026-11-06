import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { GET as liveGET } from "@/app/api/live/route";
import { withLineLinks } from "@/components/LineLinks";
import { lineFallbacks, ownLink, testerPartRow, devPartRow, TESTER_REQUESTS_BOX } from "@/lib/lineAnchors";
import { withEventLinks } from "@/lib/server/liveLinks";
import { json, makeUser, req } from "./helpers";
import { act, joined, seen, settle, setup } from "./fixtures";

type Line = { text: string; link?: string; ignored?: boolean };
const live = async (scope: string, since: string, cookie: string) =>
  (await json(await liveGET(req(`/api/live?scope=${scope}&since=${encodeURIComponent(since)}`, { cookie, method: "GET" })))).body.changes as Line[];
const src = (p: string) => readFileSync(path.resolve(__dirname, "../src", p), "utf8");

// (Owner, Nov 6, §284) Every top-box line about something with a place on the page opens it (jumps and marks, as other row links do), ignored (greyed) lines too.
describe("§284: every top-box line opens what it's about, ignored ones too", () => {
  it("the tester's \"requested a call\" line carries its request row, also when her Alerts ignore it", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    // Her Alerts turned off: the line shows greyed (ignored), but still opens the request.
    await db.user.update({ where: { id: tester.user.id }, data: { testerAlertsOff: true } });
    const since = new Date(Date.now() - 1000).toISOString();
    const startsAt = new Date(Date.now() + 48 * 3_600_000);
    startsAt.setUTCSeconds(0, 0);
    expect((await act(testId, "request-time", dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: startsAt.toISOString() })).status).toBe(200);
    await settle();
    const q = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId, fromSide: "developer", status: "pending" } });
    const line = (await live(`session:${sessionId}`, since, tester.cookie)).find((l) => / requested a call for /.test(l.text));
    expect(line).toBeDefined();
    expect(line!.ignored).toBe(true);
    expect(line!.link).toBe(`req-${q.id}`);
    // Withdrawn, its row leaves: the same link, falling back to her Call requests box.
    await db.callRequest.update({ where: { id: q.id }, data: { status: "withdrawn", decidedAt: new Date() } });
    const gone = (await live(`session:${sessionId}`, since, tester.cookie)).find((l) => / withdrew the request for /.test(l.text));
    expect(gone?.link).toBe(`req-${q.id}`);
    expect(lineFallbacks(`req-${q.id}`)).toEqual([`req-${q.id}`, TESTER_REQUESTS_BOX, "call-requests", "your-requests", "live"]);
  });

  it("developer side: an application line opens its Needs you Applications row; a join opens the tester's row in Testers", async () => {
    const a = await setup({ joinMode: "apply" });
    const since = new Date(Date.now() - 1000).toISOString();
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const v = (await db.test.findUniqueOrThrow({ where: { id: a.testId } })).listingVersion;
    expect((await act(a.testId, "apply", ana.cookie, { listingVersion: v, note: "Hi" })).status).toBe(200);
    await settle();
    const app = await db.application.findFirstOrThrow({ where: { testId: a.testId, testerId: ana.user.id } });
    const applied = (await live(`test:${a.testId}`, since, a.dev.cookie)).find((l) => l.text === "Ana Silva applied to join");
    expect(applied?.link).toBe(`item-app-${app.id}`);

    const b = await setup();
    const since2 = new Date(Date.now() - 1000).toISOString();
    const { sessionId } = await joined(b.testId, "Omar Reyes", "he");
    // Ignored in this test's Alerts: still linked.
    await db.test.update({ where: { id: b.testId }, data: { ignoredAlerts: ["joins"] } });
    const join = (await live(`test:${b.testId}`, since2, b.dev.cookie)).find((l) => l.text === "Omar Reyes joined");
    expect(join?.link).toBe(`tester-${sessionId}`);
    expect(join?.ignored).toBe(true);
  });

  it("an older stored event with no link gets its place derived at read time", async () => {
    const { dev, testId } = await setup();
    const { sessionId } = await joined(testId);
    const since = new Date(Date.now() - 1000).toISOString();
    // As recorded before §284: the tester's withdrawal and her leaving, no `link`.
    const r = await db.callRequest.create({ data: { testId, contractId: sessionId, fromSide: "tester", startsAt: new Date(Date.now() + 72 * 3_600_000), minutes: 30, status: "withdrawn", decidedAt: new Date() } });
    await db.testEvent.create({ data: { testId, kind: "withdrew_req", text: "Ana Silva withdrew a call request for Mon, Nov 9, 3:00 PM", contractId: sessionId } });
    await db.testEvent.create({ data: { testId, kind: "left", text: "Ana Silva left the test", contractId: sessionId } });
    await settle();
    const lines = await live(`test:${testId}`, since, dev.cookie);
    expect(lines.find((l) => l.text.includes("withdrew a call request"))?.link).toBe(`req-${r.id}`);
    expect(lines.find((l) => l.text === "Ana Silva left the test")?.link).toBe(`tester-${sessionId}`);
    // The helper itself: a stored link is kept; a team decision finds the part it decided; nothing found keeps the tester's row.
    const at = new Date();
    const ev = (kind: string, text: string, link = "") => ({ kind, text, createdAt: at, contractId: sessionId, link });
    const out = await withEventLinks(testId, [ev("sent", "x", "part-abc"), ev("cancelled", "Ana Silva cancelled her call on …"), ev("rated", "Ana Silva rated you")]);
    expect(out.map((e) => e.link)).toEqual(["part-abc", `tester-${sessionId}`, `tester-${sessionId}`]);
  });

  it("the anchors: parts, own actions, and the top box's ignored line keeping its grey", () => {
    expect(testerPartRow({ kind: "recording" })).toBe("part-recording");
    expect(testerPartRow({ kind: "written" })).toBe("part-written");
    expect(testerPartRow({ callId: "c1" })).toBe("call-c1");
    expect(devPartRow({ submissionId: "s1" })).toBe("part-s1");
    expect(devPartRow({ callId: "c1" })).toBe("call-c1");
    expect(ownLink(["req:r1", "c:k"], (s) => `part-${s}`)).toBe("req-r1");
    expect(ownLink(["c:k"], (s) => `part-${s}`, (c) => `tester-${c}`)).toBe("tester-k");
    expect(ownLink(["c:k"], (s) => `part-${s}`)).toBe("");
    // §270's name link stays green; the other words open the row, in the ignored line's own colour.
    const html = renderToStaticMarkup(h("li", null, withLineLinks("fbbb requested a call", [{ text: "fbbb", href: "/app/developers/u1", kind: "person" }], { rest: "#req-r1", restClass: "text-inherit no-underline hover:underline", onRest: () => {} })));
    expect(html).toContain('href="/app/developers/u1"');
    expect(html).toContain('<a href="#req-r1" class="text-inherit no-underline hover:underline" data-line-rest="">');
    const top = src("components/LiveTop.tsx");
    expect(top).toContain("restClass: l.ignored ? IGNORED_REST : undefined, onRest:");
    expect(top).toContain("jumpToFirst(l.link!)");
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("<section id={TESTER_REQUESTS_BOX}");
  });
});
