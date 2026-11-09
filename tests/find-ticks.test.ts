import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { filtersHidLine, findEmpty, findHref, passesTicks, profileHidLine, profileTicks, showFor, ticksFrom, ticksOf, type FindTicks } from "@/lib/findFilters";
import { DEVICES, LANGUAGES } from "@/lib/options";
import { needsLines } from "@/lib/server/tests";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
import { CategoryTicks, FindFilters } from "@/app/app/find/FindFilters";

// (Owner, Nov 3, batch 35 §144) Find's tick-box filters, Show following the ticks, and the empty states.
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const oldReact = globalThis.React;
vi.stubGlobal("React", React);
afterAll(() => { vi.stubGlobal("React", oldReact); });

type T = { id: string; categories: string[]; devices: string[]; languages: string[]; writtenCents: number | null; recordingCents: number | null; liveRateCents: number | null };
const t = (id: string, o: Partial<T> = {}): T => ({ id, categories: [], devices: [], languages: [], writtenCents: 500, recordingCents: null, liveRateCents: null, ...o });
const none: FindTicks = { categories: [], devices: [], languages: [], parts: [] };
const ids = (list: T[], f: Partial<FindTicks>) => list.filter((x) => passesTicks(x, { ...none, ...f })).map((x) => x.id);

const tests = [
  t("puzzle-game", { categories: ["Game", "Education"], devices: ["Windows PC"], languages: ["English"] }),
  t("game", { categories: ["Game"], devices: ["Mac"], languages: ["Spanish"], writtenCents: null, recordingCents: 800 }),
  t("any", { categories: ["Social"], liveRateCents: 2000 }),
  t("phone", { categories: ["Game", "Social"], devices: ["iPhone", "Android phone"], languages: ["French", "English"], writtenCents: null, liveRateCents: 1000 }),
];

describe("the filter rules", () => {
  it("categories: a test shows only with EVERY ticked category; none ticked = all", () => {
    expect(ids(tests, {})).toEqual(["puzzle-game", "game", "any", "phone"]);
    expect(ids(tests, { categories: ["Game"] })).toEqual(["puzzle-game", "game", "phone"]);
    expect(ids(tests, { categories: ["Game", "Education"] })).toEqual(["puzzle-game"]);
    expect(ids(tests, { categories: ["Game", "Social"] })).toEqual(["phone"]);
    expect(ids(tests, { categories: ["Education", "Social"] })).toEqual([]);
  });
  it("devices and languages: a test needing none, or one of the ticked ones (the needsLines rule)", () => {
    expect(ids(tests, { devices: ["Mac"] })).toEqual(["game", "any"]);
    expect(ids(tests, { devices: ["Mac", "iPhone"] })).toEqual(["game", "any", "phone"]);
    expect(ids(tests, { languages: ["English"] })).toEqual(["puzzle-game", "any", "phone"]);
    // Both groups: AND across them.
    expect(ids(tests, { devices: ["Windows PC", "Mac"], languages: ["Spanish"] })).toEqual(["game", "any"]);
    // Ticking a profile's devices and languages = needsLines has nothing to say.
    const p = { devices: ["Mac", "iPhone"], languages: ["English"] };
    expect(ids(tests, p)).toEqual(tests.filter((x) => needsLines(x, p).length === 0).map((x) => x.id));
  });
  it("parts: a test offering ANY ticked part; with categories and devices, every group must pass", () => {
    expect(ids(tests, { parts: ["recording"] })).toEqual(["game"]);
    expect(ids(tests, { parts: ["recording", "live"] })).toEqual(["game", "any", "phone"]);
    expect(ids(tests, { parts: ["written"] })).toEqual(["puzzle-game", "any"]);
    expect(ids(tests, { categories: ["Game"], parts: ["live", "written"], devices: ["iPhone"] })).toEqual(["phone"]);
  });
});

describe("the address (repeated params, old links, mine=1)", () => {
  const profile = { devices: ["Mac", "Linux", "Not a device"], languages: ["English"] };
  it("reads repeated params and old single ones, kept to the known values in the list's order", () => {
    expect(ticksOf(["Linux", "Mac", "PC", "Mac"], DEVICES)).toEqual(["Mac", "Linux"]);
    expect(ticksOf("Mac", DEVICES)).toEqual(["Mac"]);
    expect(ticksOf(undefined, LANGUAGES)).toEqual([]);
    expect(ticksFrom({ category: "Game", device: "Mac" }, false, profile)).toEqual({ categories: ["Game"], devices: ["Mac"], languages: [], parts: [] });
    expect(ticksFrom({ category: ["Social", "Game"], device: ["Xbox"], lang: ["French", "Klingon"], part: ["live", "nope", "written"] }, false, profile))
      .toEqual({ categories: ["Game", "Social"], devices: ["Xbox"], languages: ["French"], parts: ["written", "live"] });
  });
  it("mine=1: the profile's devices and languages are the device and language ticks (whatever else the link says); parts and categories stay", () => {
    expect(ticksFrom({ mine: "1", device: "Xbox", lang: "French", part: "live", category: "Game" }, true, profile)).toEqual({ categories: ["Game"], devices: ["Mac", "Linux"], languages: ["English"], parts: ["live"] });
    expect(profileTicks(null)).toEqual({ devices: [], languages: [] });
  });
  it("writes repeated params; with Show = Matching my profile only mine=1 stands for the devices and languages", () => {
    expect(findHref({ categories: ["Game", "Social"], devices: ["Windows PC", "Mac"], languages: ["English"], parts: ["written"], sort: "pay", q: "har" }))
      .toBe("/app/find?category=Game&category=Social&device=Windows+PC&device=Mac&lang=English&part=written&sort=pay&q=har");
    expect(findHref({ categories: ["Game"], devices: ["Mac"], languages: ["English"], mine: true })).toBe("/app/find?category=Game&mine=1");
    expect(findHref({})).toBe("/app/find");
  });
});

describe("Show follows the ticks", () => {
  const profile = { devices: ["Mac", "iPhone"], languages: ["English", "French"] };
  it("Matching my profile only while the device and language ticks are exactly the profile's (any order)", () => {
    expect(showFor({ devices: ["iPhone", "Mac"], languages: ["French", "English"] }, profile)).toBe("1");
    expect(showFor({ devices: ["Mac"], languages: ["English", "French"] }, profile)).toBe("0"); // one unticked
    expect(showFor({ devices: ["Mac", "iPhone", "Xbox"], languages: ["English", "French"] }, profile)).toBe("0"); // one more
    expect(showFor({ devices: ["Mac", "iPhone"], languages: ["English"] }, profile)).toBe("0"); // a language off
    expect(showFor({ devices: [], languages: [] }, profile)).toBe("0");
    // An empty profile never reads "Matching my profile" by itself.
    expect(showFor({ devices: [], languages: [] }, { devices: [], languages: [] })).toBe("0");
    expect(showFor({ devices: [], languages: [] }, null)).toBe("0");
  });
  it("the form: Show, its ticks, the parts and the hidden search and categories render from the address; Matching ticks the profile's", () => {
    const params = { categories: ["Game"], devices: ["Mac", "iPhone"], languages: ["English", "French"], parts: ["live" as const], mine: true, q: "har", sort: "pay" };
    const html = renderToStaticMarkup(React.createElement(FindFilters, { params, profile }) as ReactElement);
    expect(html).toMatch(/<form [^>]*action="\/app\/find"/);
    expect(html).toMatch(/<option value="1" selected="">Matching my profile<\/option>/);
    for (const [name, v] of [["device", "Mac"], ["device", "iPhone"], ["lang", "English"], ["lang", "French"], ["part", "live"]]) expect(html).toContain(`name="${name}" checked="" value="${v}"`);
    expect(html).toContain('<input type="checkbox" name="device" value="Xbox"/>');
    expect(html).toContain('<input type="hidden" name="category" value="Game"/>');
    expect(html).toContain('<input type="hidden" name="q" value="har"/>');
    // An admin's form has no Show.
    expect(renderToStaticMarkup(React.createElement(FindFilters, { params: {}, profile: null }) as ReactElement)).not.toContain("Matching my profile");
  });
  it("the client wiring: a tick re-reads Show from the ticks; Matching ticks the profile's, Everything clears them; parts aren't Show's", () => {
    const f = src("app/app/find/FindFilters.tsx");
    expect(f).toContain("setMine(showFor(next, profile));");
    expect(f).toContain('setDevices(v === "1" ? [...(profile?.devices ?? [])] : []);');
    expect(f).toContain('setLanguages(v === "1" ? [...(profile?.languages ?? [])] : []);');
    expect(f).toContain('<Ticks legend="Parts" name="part" options={Object.keys(FIND_PARTS)} labels={FIND_PARTS} ticked={(params.parts ?? []) as FindPart[]} />');
  });
  it("category chips tick on and off (several at once); All clears them; counts stay", () => {
    const html = renderToStaticMarkup(React.createElement(CategoryTicks, { params: { categories: ["Game"], sort: "pay" }, counts: { Game: 3, Social: 2 }, total: 4 }) as ReactElement);
    expect(html).toContain('href="/app/find?sort=pay"'); // All, and Game's own link (unticks it)
    expect(html).toContain('href="/app/find?category=Game&amp;category=Social&amp;sort=pay"');
    expect(html).toMatch(/aria-current="true"[^>]*data-find-category="Game"/);
    expect(html).toContain('<span class="text-slate-500">3</span>');
  });
});

describe("the empty states", () => {
  it("nothing open; the filters hid N; Matching my profile alone hid N", () => {
    expect(findEmpty([], none, true)).toEqual({ kind: "nothing" });
    // The categories hid them all (even with Show = Matching): the filters' state, every open test counted.
    expect(findEmpty(tests, { ...none, categories: ["Education", "Social"] }, true)).toEqual({ kind: "filters", n: 4 });
    // Device ticks under Everything: the filters' state (only tests that need something, so none is left).
    const needy = tests.filter((x) => x.id !== "any");
    expect(ids(needy, { devices: ["Xbox"], languages: ["Korean"] })).toEqual([]);
    expect(findEmpty(needy, { ...none, devices: ["Xbox"], languages: ["Korean"] }, false)).toEqual({ kind: "filters", n: 3 });
    // Matching my profile alone: the tests the categories and parts leave.
    expect(findEmpty(needy, { ...none, devices: ["Xbox"], languages: ["Korean"] }, true)).toEqual({ kind: "profile", n: 3 });
    expect(findEmpty(needy, { ...none, parts: ["live"], devices: ["Xbox"], languages: ["Korean"] }, true)).toEqual({ kind: "profile", n: 1 });
    expect(findEmpty(tests, { ...none, categories: ["Game"], parts: ["recording"], devices: ["Xbox"], languages: ["Korean"] }, true)).toEqual({ kind: "profile", n: 1 });
  });
  it("singular for one, plural otherwise", () => {
    expect(profileHidLine(1)).toBe("1 open test needs a device or language that isn't on your profile.");
    expect(profileHidLine(3)).toBe("3 open tests need a device or language that isn't on your profile.");
    expect(filtersHidLine(1)).toBe("1 open test doesn't match.");
    expect(filtersHidLine(5)).toBe("5 open tests don't match.");
  });
  it("Find: the owner's words, Clear filters keeps the search and sort, Show them keeps categories and parts (Everything)", () => {
    const page = src("app/app/find/page.tsx");
    expect(page).toContain('<p className="font-medium text-slate-300">No open tests right now</p>');
    expect(page).toContain('<p className="text-sm text-slate-500">New tests show up here as soon as developers post them.</p>');
    expect(page).toContain('<p className="font-medium text-slate-300">No open tests match your filters</p>');
    expect(page).toContain('<Link href={findHref({ sort, q: typed || undefined })} data-find-clear="">Clear filters</Link>');
    expect(page).toContain('<p className="font-medium text-slate-300">No open tests match your profile</p>');
    expect(page).toContain('<Link href={findHref({ ...params, devices: [], languages: [], mine: false })} data-find-show-all="">Show them</Link>');
    // A typed search that finds nothing keeps its line; the admin's empty line is unchanged.
    expect(page).toContain("shown.length === 0 && typed && (admin || open.length === 0) ? (");
    expect(page).toContain('<p className="font-medium text-slate-300">No tests match these ticks</p>');
    expect(page).toContain("const shown = open.filter((t) => passesTicks(t, ticks));");
    expect(page).not.toContain("adding more devices and languages");
  });
  it("the dashboard's New tests for you: no mention of devices or languages, a link to all tests", () => {
    const dash = src("app/app/page.tsx");
    expect(dash).not.toContain("New tests for you"); // (Codex eb8ca7cd, docs/NOV7-DASHBOARD-CHANGES.md) the panel was removed (Find tests lists them)
    expect(dash).not.toContain("No new matches right now");
    expect(dash).not.toContain("Add more devices or languages");
  });
});
