import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { ALERT_TYPES, PAUSED_ALERTS } from "@/lib/alerts";
import { POST as alertsPOST } from "@/app/api/account/alerts/route";
import { POST as alertsAddPOST } from "@/app/api/account/alerts/add/route";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { AlertsMenu, allAlertsOn } from "@/components/AlertsMenu";
import { ignoredAlertsFresh, ignoredAlertsNow, publishIgnoredAlerts, startIgnoredAlertsSave, withAlerts } from "@/lib/testerAlerts";
import { json, req } from "./helpers";
import { setup } from "./fixtures";

// The components are compiled with the classic JSX runtime here (as in the other render tests).
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const menu = (cookie: string, body: Record<string, unknown>) => alertsPOST(req("/api/account/alerts", { cookie, body })).then(json);
const chip = (cookie: string, body: Record<string, unknown>) => alertsAddPOST(req("/api/account/alerts/add", { cookie, body })).then(json);
const pulse = (cookie: string, testId: string) => pulseGET(req(`/api/pulse?test=${testId}`, { cookie, method: "GET" })).then(json);
const row = (id: string) => db.test.findUniqueOrThrow({ where: { id }, select: { ignoredAlerts: true, alertsV: true } });
const ALL = ALERT_TYPES.map((a) => a.key);
const sorted = (l: string[]) => [...l].sort();

// Owner, Nov 4 (§169): "Ticking All in Alerts doesn't tick everything, and removing one while All is ticked doesn't untick it."
describe("§169: Alerts All is one atomic save, and no tab shows an older list over a newer one", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("All is ONE request: every type ticked together, in one save (one version step); unticking All unticks them all", async () => {
    const { dev, testId } = await setup();
    const on = await menu(dev.cookie, { testId, keys: ALL, off: true });
    expect(on.status).toBe(200);
    expect(sorted(on.body.ignored)).toEqual(sorted(ALL));
    expect(on.body.v).toBe(1);
    expect(await row(testId)).toMatchObject({ alertsV: 1 });
    expect(sorted((await row(testId)).ignoredAlerts)).toEqual(sorted(ALL));
    const off = await menu(dev.cookie, { testId, keys: ALL, off: false });
    expect(off.body).toMatchObject({ ignored: [], v: 2 });
    // A type the server doesn't know (or none) is refused, and nothing is saved.
    expect((await menu(dev.cookie, { testId, keys: ["joins", "nope"], off: true })).status).toBe(400);
    expect((await menu(dev.cookie, { testId, keys: [], off: true })).status).toBe(400);
    expect(await row(testId)).toEqual({ ignoredAlerts: [], alertsV: 2 });
    // The menu sends one request with the open types.
    const m = src("components/AlertsMenu.tsx");
    expect(m).toContain("return save(ks, on, { keys: ks, off: on });");
    expect(m).not.toContain("await toggle(a.key, on)");
  });

  it("greyed types keep their own ticks: All on a paused test changes only the types that can happen there", async () => {
    const { dev, testId } = await setup();
    // Joins (greyed while paused) is ticked, Work sent (greyed too) is not; an old stored "listing" tick stays as it is.
    await db.test.update({ where: { id: testId }, data: { ignoredAlerts: ["joins", "listing"] } });
    const open = [...PAUSED_ALERTS] as string[];
    const on = await menu(dev.cookie, { testId, keys: open, off: true });
    expect(sorted(on.body.ignored)).toEqual(sorted(["joins", "listing", ...open]));
    expect(on.body.ignored).not.toContain("work");
    const off = await menu(dev.cookie, { testId, keys: open, off: false });
    expect(sorted(off.body.ignored)).toEqual(["joins", "listing"]);
  });

  it("saves at the same moment are all kept (two tabs, the stop box's chip and the menu, All and a chip): the test row is locked for each", async () => {
    const { dev, testId } = await setup();
    // Every type on its own request, all at once: half from the menu, half from stop box chips.
    const rs = await Promise.all(ALL.map((key, i) => (i % 2 ? chip(dev.cookie, { testId, key }) : menu(dev.cookie, { testId, key, off: true }))));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const r = await row(testId);
    expect(sorted(r.ignoredAlerts)).toEqual(sorted(ALL));
    expect(r.alertsV).toBe(ALL.length);
    // Each answer has its own version, and the one with the newest version carries every type.
    expect(new Set(rs.map((x) => x.body.v)).size).toBe(ALL.length);
    expect(sorted(rs.find((x) => x.body.v === ALL.length)!.body.ignored)).toEqual(sorted(ALL));
    // Unticking two at once (two tabs): both go.
    await Promise.all([menu(dev.cookie, { testId, key: "work", off: false }), menu(dev.cookie, { testId, key: "calls", off: false })]);
    expect(sorted((await row(testId)).ignoredAlerts)).toEqual(sorted(ALL.filter((k) => k !== "work" && k !== "calls")));
    // Unticking All while a chip adds Call changes: whichever lands last wins as a whole; neither half-applies.
    await Promise.all([menu(dev.cookie, { testId, keys: ALL, off: false }), chip(dev.cookie, { testId, key: "calls" })]);
    const end = (await row(testId)).ignoredAlerts;
    expect([[], ["calls"]]).toContainEqual(end);
    expect(src("lib/server/testAlerts.ts")).toContain('await tx.$queryRaw`SELECT id FROM "Test" WHERE id = ${testId} FOR UPDATE`;');
  });

  it("the poll carries the list's version; one read before a save is older than that save", async () => {
    const { dev, testId } = await setup();
    const before = (await pulse(dev.cookie, testId)).body.alerts;
    expect(before).toEqual({ ignored: [], v: 0 });
    const saved = await menu(dev.cookie, { testId, keys: ALL, off: true });
    expect(saved.body.v).toBeGreaterThan(before.v);
    expect((await pulse(dev.cookie, testId)).body.alerts.v).toBe(saved.body.v);
    // The whole list (the older form) is versioned too.
    expect((await menu(dev.cookie, { testId, ignored: ["joins"] })).body).toEqual({ ignored: ["joins"], v: 2 });
    expect((await chip(dev.cookie, { testId, key: "calls" })).body).toEqual({ ok: true, ignored: ["joins", "calls"], v: 3 });
    // The pages draw the menu with it, and the poll passes it on.
    expect(src("app/app/tests/[id]/TopPanel.tsx")).toContain("v={p.alertsV}");
    expect(src("app/app/tests/[id]/edit/page.tsx")).toContain("v={t.alertsV}");
    expect(src("components/AutoRefresh.tsx")).toContain("publishIgnoredAlerts(testId, alerts.ignored, false, alerts.v)");
  });

  it("in the tab: an older poll or redraw never replaces a save (while it's on the way or after it); a newer one does", () => {
    const store = new Map<string, string>();
    const win = Object.assign(new EventTarget(), { localStorage: { setItem: (k: string, v: string) => store.set(k, v), getItem: (k: string) => store.get(k) ?? null } });
    vi.stubGlobal("window", win);
    const heard: string[][] = [];
    win.addEventListener("dev-alerts", (e) => heard.push((e as CustomEvent<{ ignored: string[] }>).detail.ignored));
    const t = "t169-poll";
    // The page was drawn with version 4 (nothing ticked).
    publishIgnoredAlerts(t, [], false, 4);
    // All is ticked: every box at once (one change), while the save is on the way.
    const endAll = startIgnoredAlertsSave(t, ALL, true);
    expect(sorted(ignoredAlertsNow(t)!)).toEqual(sorted(ALL));
    expect(heard.at(-1)!.length).toBe(ALL.length);
    // A poll asked before the save answers now with version 4: the boxes stay ticked.
    publishIgnoredAlerts(t, [], false, 4);
    expect(sorted(ignoredAlertsNow(t)!)).toEqual(sorted(ALL));
    // Work sent is unticked before All's answer: it shows unticked (All too), and All's answer (version 5, with Work sent) doesn't tick it back.
    const endWork = startIgnoredAlertsSave(t, ["work"], false);
    expect(ignoredAlertsNow(t)).not.toContain("work");
    endAll({ ignored: ALL, v: 5 });
    expect(ignoredAlertsNow(t)).not.toContain("work");
    expect(JSON.parse(store.get("pt-alerts")!)).toMatchObject({ testId: t, v: 5 });
    // A poll (or a redraw) asked before the saves lands after them: ignored.
    expect(ignoredAlertsFresh(t, 4)).toBe(false);
    publishIgnoredAlerts(t, [], false, 4);
    expect(ignoredAlertsNow(t)!.length).toBe(ALL.length - 1);
    // Work sent's answer (version 6); then a late answer of version 5 changes nothing.
    endWork({ ignored: ALL.filter((k) => k !== "work"), v: 6 });
    publishIgnoredAlerts(t, ALL, false, 5);
    expect(sorted(ignoredAlertsNow(t)!)).toEqual(sorted(ALL.filter((k) => k !== "work")));
    // The same version again (the next poll) and a newer one (another device unticked Joins) are taken.
    expect(ignoredAlertsFresh(t, 6)).toBe(true);
    publishIgnoredAlerts(t, ["calls"], false, 7);
    expect(ignoredAlertsNow(t)).toEqual(["calls"]);
    // A save that fails: its types go back to the saved list; ending twice counts once.
    const endFail = startIgnoredAlertsSave(t, ["joins"], true);
    expect(sorted(ignoredAlertsNow(t)!)).toEqual(["calls", "joins"]);
    endFail();
    endFail({ ignored: ["joins"], v: 8 });
    expect(ignoredAlertsNow(t)).toEqual(["calls"]);
    // Another tab's save reaches this one through storage with its version (and an older one is ignored there too).
    expect(src("lib/testerAlerts.ts")).toContain('publishIgnoredAlerts(d.testId, d.ignored.map(String), false, typeof d.v === "number" ? d.v : undefined)');
  });

  it("All follows the ticks: unticking any one type unticks All at once, ticking it again ticks All; greyed types don't count", () => {
    expect(allAlertsOn(ALL, ALL)).toBe(true);
    const less = withAlerts(ALL, ["work"], false);
    expect(allAlertsOn(ALL, less)).toBe(false);
    expect(allAlertsOn(ALL, withAlerts(less, ["work"], true))).toBe(true);
    // A paused test: Joins and Work sent are greyed; All is ticked with every open type, whatever the greyed ones hold.
    const open = [...PAUSED_ALERTS] as string[];
    expect(allAlertsOn(open, open)).toBe(true);
    expect(allAlertsOn(open, withAlerts(open, ["calls"], false))).toBe(false);
    expect(allAlertsOn([], [])).toBe(false);
    // The menu as drawn: All's box is ticked with every type, and not with one missing.
    const allBox = (html: string) => /data-alerts-all=""[^>]*><input type="checkbox"( checked="")?/.exec(html)?.[1] === ' checked=""';
    expect(allBox(renderToStaticMarkup(createElement(AlertsMenu, { testId: "t169-draw-a", ignored: ALL, v: 1 })))).toBe(true);
    expect(allBox(renderToStaticMarkup(createElement(AlertsMenu, { testId: "t169-draw-b", ignored: less, v: 2 })))).toBe(false);
    expect(allBox(renderToStaticMarkup(createElement(AlertsMenu, { testId: "t169-draw-c", ignored: ["leaving", "calls", "payments", "disputes", "admin"], v: 1, keys: open })))).toBe(true);
    // Its instant tick is made on the ticks shown now, never on the list the click was drawn with (the old loop's stale copy showed one tick at a time).
    expect(src("components/AlertsMenu.tsx")).toContain("const end = startIgnoredAlertsSave(testId, change, on);");
    expect(src("components/QuickIgnore.tsx")).toContain("const end = startIgnoredAlertsSave(testId, [k], true);");
  });
});
