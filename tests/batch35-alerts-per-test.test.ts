import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as alertsPOST } from "@/app/api/account/alerts/route";
import { POST as alertsAddPOST } from "@/app/api/account/alerts/add/route";
import { POST as testsPOST } from "@/app/api/tests/route";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { devChanges } from "@/lib/server/live";
import { ignoredAlertsNow, publishIgnoredAlerts } from "@/lib/testerAlerts";
import { json, makeUser, req } from "./helpers";
import { act, listingBody, seen, settle, setup } from "./fixtures";

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const menu = (cookie: string, body: Record<string, unknown>) => alertsPOST(req("/api/account/alerts", { cookie, body })).then(json);
const chip = (cookie: string, body: Record<string, unknown>) => alertsAddPOST(req("/api/account/alerts/add", { cookie, body })).then(json);
const saved = async (id: string) => (await db.test.findUniqueOrThrow({ where: { id } })).ignoredAlerts;

// Owner, Oct 31 (batch 35 §73): the developer's Alerts ticks belong to each test, not the account.
describe("batch 35 §73: the developer's Alerts belong to each test", () => {
  it("ticks on test A don't affect test B (saved, polled, and in the stop gate)", async () => {
    const { dev, testId: a } = await setup();
    const b = (await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ title: "Test B" }) })))).body.id as string;
    expect((await menu(dev.cookie, { testId: a, key: "joins", off: true })).body.ignored).toEqual(["joins"]);
    expect(await saved(a)).toEqual(["joins"]);
    expect(await saved(b)).toEqual([]);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).ignoredAlerts).toEqual([]);
    expect((await json(await pulseGET(req(`/api/pulse?test=${a}`, { cookie: dev.cookie, method: "GET" })))).body.alerts).toEqual({ ignored: ["joins"] });
    expect((await json(await pulseGET(req(`/api/pulse?test=${b}`, { cookie: dev.cookie, method: "GET" })))).body.alerts).toEqual({ ignored: [] });
    // The gate: a join on each test since the page opened stops B's press, not A's.
    const opened = new Date(Date.now() - 1000);
    for (const t of [a, b]) await db.testEvent.create({ data: { testId: t, kind: "joined", text: "Ana Silva joined" } });
    const lines = async (t: string) => (await devChanges(dev.user.id, t, opened, "Z", db)).filter((c) => c.text === "Ana Silva joined");
    expect(await lines(a)).toEqual([]);
    expect((await lines(b)).length).toBe(1);
    expect(src("lib/server/live.ts")).toContain("tx.test.findUnique({ where: { id: testId }, select: { ignoredAlerts: true } })");
  });

  it("a new test and a Next round start with every alert on", async () => {
    const { dev, testId } = await setup();
    await menu(dev.cookie, { testId, ignored: ["joins", "calls", "work"] });
    await settle();
    const draft = await act(testId, "next-round", dev.cookie, { seenAt: seen(), confirmed: true });
    expect(draft.status).toBe(200);
    expect(await saved(draft.body.id)).toEqual([]);
    expect((await saved(testId)).sort()).toEqual(["calls", "joins", "work"]);
    const fresh = (await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ title: "Fresh" }) })))).body.id as string;
    expect(await saved(fresh)).toEqual([]);
  });

  it("the stop box's chip saves on that test", async () => {
    const { dev, testId: a } = await setup();
    const b = (await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ title: "Test B" }) })))).body.id as string;
    expect((await chip(dev.cookie, { testId: b, key: "calls" })).body.ignored).toEqual(["calls"]);
    expect(await saved(b)).toEqual(["calls"]);
    expect(await saved(a)).toEqual([]);
    // Without a test, nothing is saved.
    expect((await chip(dev.cookie, { key: "calls" })).status).toBe(400);
    // The chip finds its test from the page (the test page or Edit), and the menu passes its own.
    expect(src("components/QuickIgnore.tsx")).toContain('"/api/account/alerts/add", { testId, key: k }');
    expect(src("components/AlertsMenu.tsx")).toContain('"/api/account/alerts", { testId, key, off: on }');
  });

  it("only the test's developer can change them", async () => {
    const { testId } = await setup();
    const other = await makeUser({ dev: true, name: "Olga Park" });
    const tester = await makeUser({ tester: true, name: "Tia" });
    for (const u of [other, tester]) {
      expect((await menu(u.cookie, { testId, key: "joins", off: true })).status).toBe(404);
      expect((await chip(u.cookie, { testId, key: "joins" })).status).toBe(404);
    }
    expect(await saved(testId)).toEqual([]);
  });

  it("in the page: each test's ticks are kept apart (events and other tabs carry the test id)", () => {
    const store = new Map<string, string>();
    const win = Object.assign(new EventTarget(), { location: { pathname: "/app/tests/tA" }, localStorage: { setItem: (k: string, v: string) => store.set(k, v), getItem: (k: string) => store.get(k) ?? null } });
    vi.stubGlobal("window", win);
    const heard: { testId: string; ignored: string[] }[] = [];
    win.addEventListener("dev-alerts", (e) => heard.push((e as CustomEvent<{ testId: string; ignored: string[] }>).detail));
    publishIgnoredAlerts("tA", ["calls"]);
    publishIgnoredAlerts("tB", ["joins"]);
    expect(ignoredAlertsNow("tA")).toEqual(["calls"]);
    expect(ignoredAlertsNow("tB")).toEqual(["joins"]);
    expect(heard).toEqual([{ testId: "tA", ignored: ["calls"] }, { testId: "tB", ignored: ["joins"] }]);
    expect(JSON.parse(store.get("pt-alerts")!)).toMatchObject({ testId: "tB", ignored: ["joins"] });
    vi.unstubAllGlobals();
  });
});
