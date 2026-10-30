import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { POST as testsPOST } from "@/app/api/tests/route";
import { applyDeclinedLine, joinBackLine, joinInLine, joinPageV, rejoinDeclinedLine } from "@/lib/server/pulseV";
import { LISTING_MIN_CHARS, checkListing, minCharsLine, minCounter } from "@/lib/rules";
import { PayLinesBox, PAY_LINES_SHOWN } from "@/components/ScrollList";
import { json, makeUser, req } from "./helpers";
import { act, joined, listingBody, sact, seen, settle, setup } from "./fixtures";

// Batch 30 wave 1 (owner, Oct 29): §8 the join page follows its application / ask live, §18 titles and steps at least 10 characters, §16 a part's payment lines in a box.
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");

// ---------- §8: the join page follows its application or ask ----------

describe("batch 30 §8 (owner's repro): the join page follows its application or ask to rejoin live", () => {
  type Pulse = { v: string; back: { line: string; href: string } | null };
  const poll = async (testId: string, cookie: string) => (await json(await pulseGET(req(`/api/pulse?join=${testId}`, { cookie })))).body as Pulse;
  const decide = (testId: string, cookie: string, applicationId: string, action: "accept" | "decline") => act(testId, "application", cookie, { applicationId, action, seenAt: seen(), confirmed: true });
  const askBack = async (testId: string) => {
    const j = await joined(testId, "Fbbb Tester");
    expect((await sact(j.sessionId, "leave", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    const lv = (await db.test.findUniqueOrThrow({ where: { id: testId } })).listingVersion;
    expect((await act(testId, "rejoin-ask", j.tester.cookie, { listingVersion: lv, seenAt: seen(), confirmed: true, anyway: true })).status).toBe(200);
    await settle();
    return { ...j, app: await db.application.findFirstOrThrow({ where: { testId, testerId: j.tester.user.id } }) };
  };

  it("accepted while the page is open: the next poll differs from the render, with \"You're back in …\" and the session", async () => {
    const { dev, testId } = await setup({ title: "lllllq rejoin" });
    const j = await askBack(testId);
    const rendered = await joinPageV(j.tester.user.id, testId);
    const before = await poll(testId, j.tester.cookie);
    expect(before.v).toBe(rendered);
    expect(before.back).toBeNull();
    expect((await decide(testId, dev.cookie, j.app.id, "accept")).status).toBe(200);
    const after = await poll(testId, j.tester.cookie);
    expect(after.v).not.toBe(rendered);
    expect(after.back?.href).toBe(`/app/sessions/${j.sessionId}`);
    expect(after.back?.line).toMatch(/^You're back in “lllllq rejoin”: your deadline is .+\.$/);
    expect(after.back?.line).not.toContain("⟦t:");
  });

  it("declined: the poll differs and the page renders \"Your ask to rejoin wasn't accepted.\"; a first application's lines", async () => {
    const { dev, testId } = await setup();
    const j = await askBack(testId);
    const rendered = await joinPageV(j.tester.user.id, testId);
    expect((await decide(testId, dev.cookie, j.app.id, "decline")).status).toBe(200);
    const after = await poll(testId, j.tester.cookie);
    expect(after.v).not.toBe(rendered);
    expect(after.back).toBeNull();
    expect(rejoinDeclinedLine).toBe("Your ask to rejoin wasn't accepted.");
    const page = src("app/app/find/[id]/page.tsx");
    expect(page).toContain('myApp?.status === "declined" && <p className="info" data-app-declined="">{myApp.kind === "rejoin" ? rejoinDeclinedLine : applyDeclinedLine(t.title)}</p>');
    expect(page).toContain("<JoinWatch testId={t.id} v={joinFp} />");
    // A first application: accepted ("You're in: …") and declined.
    const r = await setup({ joinMode: "apply", title: "Apply here" });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    expect((await act(r.testId, "apply", ana.cookie, { note: "hi" })).status).toBe(200);
    const fp = await joinPageV(ana.user.id, r.testId);
    const a = await db.application.findFirstOrThrow({ where: { testId: r.testId, testerId: ana.user.id } });
    expect((await decide(r.testId, r.dev.cookie, a.id, "accept")).status).toBe(200);
    const p = await poll(r.testId, ana.cookie);
    expect(p.v).not.toBe(fp);
    expect(p.back?.line).toBe(joinInLine("Apply here"));
    expect(joinInLine("Apply here")).toBe("You're in: “Apply here”.");
    expect(applyDeclinedLine("Apply here")).toBe("Your application to “Apply here” wasn't accepted.");
    expect(joinBackLine("T", "Nov 12")).toBe("You're back in “T”: your deadline is Nov 12.");
  });

  it("JoinWatch moves to the session unless something is being typed; the Sent line gives way when the application changes", () => {
    const w = src("app/app/find/[id]/JoinWatch.tsx");
    expect(w).toContain("if (!pageBusy()) window.location.href = j.back.href;");
    expect(w).toContain("Go to your session →");
    expect(src("app/app/find/[id]/JoinBox.tsx")).toContain('useEffect(() => setDone(""), [appState]);');
  });
});

// ---------- §18: title and steps at least 10 characters ----------

describe("batch 30 §18: the test's name and what testers should do are at least 10 characters", () => {
  beforeEach(() => {
    process.env.LISTING_MIN_CHARS = "10"; // the real minimum (the suite runs at 1 for the tests written before batch 30)
  });
  afterEach(() => {
    process.env.LISTING_MIN_CHARS = "1";
  });
  const long = "Play the first three levels and tell us where you got stuck.";
  const post = async (over: Record<string, unknown>) => {
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    return { dev, r: await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ description: long, ...over }) }))) };
  };

  it("Post: 9 characters refused at each field with the line, 10 accepted", async () => {
    const t9 = await post({ title: "Harbor Ru" });
    expect(t9.r.status).toBe(400);
    expect(t9.r.body.error.errors).toContain("Name of this test: at least 10 characters (9 so far).");
    // Trimmed: spaces around don't count.
    const d8 = await post({ description: "  Sail now  " });
    expect(d8.r.body.error.errors).toContain(minCharsLine("What should testers do", 8));
    const d9b = await post({ description: "123456789" });
    expect(d9b.r.body.error.errors).toContain("What should testers do: at least 10 characters (9 so far).");
    const ok = await post({ title: "Harbor Run", description: "1234567890" });
    expect(ok.r.status).toBe(200);
  });

  it("Edit: an old short title doesn't block saving another field; changing it needs 10", async () => {
    process.env.LISTING_MIN_CHARS = "1";
    const { dev, testId } = await setup({ title: "Run", description: "Sail" });
    process.env.LISTING_MIN_CHARS = "10";
    const v = async () => (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: await v(), fields: { writtenCents: "12.00" }, seenAt: seen(), confirmed: true })).status).toBe(200);
    const bad = await act(testId, "edit", dev.cookie, { version: await v(), fields: { title: "Run again" }, seenAt: seen(), confirmed: true });
    expect(bad.status).toBe(400);
    expect(bad.body.error.errors).toEqual(["Name of this test: at least 10 characters (9 so far)."]);
    expect((await act(testId, "edit", dev.cookie, { version: await v(), fields: { title: "Run it again" }, seenAt: seen(), confirmed: true })).status).toBe(200);
  });

  it("the rule, the counter and the form: red on leaving and on the press, only for a changed field on Edit; product name unchanged", () => {
    expect(LISTING_MIN_CHARS).toBe(10);
    expect(minCounter(6)).toBe("6 / 10 minimum");
    const base = { ...listingBody({ description: long }), writtenCents: 1000, recordingCents: null, liveRateCents: 3000, productName: "Ab" } as unknown as Parameters<typeof checkListing>[0];
    expect(checkListing({ ...base, title: "Harbor Run" }).some((e) => /^Name of this test/.test(e))).toBe(false);
    expect(checkListing({ ...base, title: "short" }, 0, new Date(), { changed: new Set(["writtenCents"]) }).some((e) => /^Name of this test/.test(e))).toBe(false);
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain('{ "data-min-chars": String(LISTING_MIN_CHARS), "data-min-label": label }');
    expect(form).toContain("!edit || f[k] !== base[k]");
    expect(form).toContain("minCounter(f.description.trim().length)");
    expect(src("components/FieldChecks.tsx")).toContain("`${el.dataset.minLabel}: at least ${min} characters (${v.length} so far).`");
  });
});

// ---------- §16: a part's payment lines in a box ----------

describe("batch 30 §16: more than 4 payment lines under a paid part sit in a plain scroll box", () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => createElement("p", { key: i, "data-pay-line": "" }, `Extra $${i + 1}.00: you get $0.80`));
  it("6 payments: everything in a box about 4 lines tall (no Show N more); 4: no box", () => {
    expect(PAY_LINES_SHOWN).toBe(4);
    const six = renderToStaticMarkup(createElement(PayLinesBox, { count: 6, children: lines(6) }));
    expect(six).toContain('data-scroll-list="four"');
    expect(six).toContain("max-h-28 overflow-y-auto");
    expect((six.match(/data-pay-line/g) ?? []).length).toBe(6);
    expect(six).not.toContain("Show");
    const four = renderToStaticMarkup(createElement(PayLinesBox, { count: 4, children: lines(4) }));
    expect(four).not.toContain("data-scroll-list");
    // The session page: the Pay line and the extras inside; whether it can be paid more and the dispute after the box.
    const page = src("app/app/sessions/[id]/page.tsx");
    const start = page.indexOf("<PayLinesBox count={1 + extras.length");
    const end = page.indexOf("</PayLinesBox>");
    expect(start).toBeGreaterThan(0);
    expect(page.slice(start, end)).toContain("data-extra-line");
    expect(page.slice(end)).toContain("data-pay-more-state");
    expect(page.slice(start, end)).not.toContain("data-pay-more-state");
  });
});
