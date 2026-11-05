import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import AppHome from "@/app/app/page";
import { POST as testsPOST } from "@/app/api/tests/route";
import { YourTestsSearch } from "@/app/app/YourTestsSearch";
import { DEV_SEARCH_LABEL, devOrTestMatches, noDevMatchLine, noTodoMatchLine, searchByDeveloper } from "@/lib/devSearch";
import { FIND_SEARCH_MAX } from "@/lib/findSearch";
import { YOUR_TESTS_SEARCH_LABEL, noYourTestsLine, yourTestMatches } from "@/lib/yourTestsSearch";
import { json, makeUser, req } from "./helpers";
import { act, listingBody, settle, setup } from "./fixtures";

// (Owner, Nov 5, §204) Searching the dashboards: the developer's "Your tests" by test or product name; the tester's existing "Search by developer" box now
// searches the developer's name OR the test's name, and To do stays on the page, filtered, while it's typed in.

const page = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => page.user, requireOpenPage: async () => page.user, adminAway: () => {}, getPageUser: async () => null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), redirect: (to: string) => { throw Error(`redirect:${to}`); }, notFound: () => { throw Error("not found"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

/** Renders a server page: async components are resolved first (renderToStaticMarkup can't). */
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
const html = async (node: ReactNode | Promise<ReactNode>) => renderToStaticMarkup(await serverTree(await node));
const dashboard = async (id: string) => {
  page.user = await db.user.findUniqueOrThrow({ where: { id } });
  return html(AppHome({ searchParams: Promise.resolve({}) }));
};
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");

describe("§204 the developer's Your tests search", () => {
  it("matches the test name or the product name, any part, any case; blank keeps every test; the no-match line", () => {
    const t = { title: "Harbor Run", product: "Sea Games" };
    expect(yourTestMatches(t, "")).toBe(true);
    expect(yourTestMatches(t, "   ")).toBe(true);
    expect(yourTestMatches(t, "bor r")).toBe(true); // any part of the name
    expect(yourTestMatches(t, " HARBOR ")).toBe(true); // any case, trimmed
    expect(yourTestMatches(t, "a g")).toBe(true); // "Se[a G]ames": the product
    expect(yourTestMatches(t, "games")).toBe(true);
    expect(yourTestMatches(t, "nora")).toBe(false);
    expect(yourTestMatches({ title: "Sky Forge", product: null }, "sky")).toBe(true);
    expect(yourTestMatches({ title: "Sky Forge", product: null }, "games")).toBe(false);
    expect(noYourTestsLine(" zed ")).toBe("No tests match “zed”.");
  });

  it("the box: above the cards with maxLength FIND_SEARCH_MAX, a label and the placeholder; every card passed in, in the cards scroll box", () => {
    const out = renderToStaticMarkup(React.createElement(YourTestsSearch, { items: [{ key: "a", title: "Harbor Run", product: "Sea", node: React.createElement("p", null, "card A") }, { key: "b", title: "Sky Forge", product: null, node: React.createElement("p", null, "card B") }] }));
    expect(out).toContain(`maxLength="${FIND_SEARCH_MAX}"`);
    expect(out).toContain(`placeholder="${YOUR_TESTS_SEARCH_LABEL}"`);
    expect(out).toContain('aria-label="Search your tests by test or product name"');
    expect(out).toContain('type="search"');
    expect(out.indexOf("data-your-tests-search")).toBeLessThan(out.indexOf('data-scroll-list="cards"'));
    expect(out).toContain("card A");
    expect(out).toContain("card B");
    expect(out).not.toContain("data-your-tests-none");
  });

  it("the dashboard renders the box over the developer's tests (product and test names on the cards)", async () => {
    const { dev } = await setup({ title: "Harbor Run", productName: "Sea Games" });
    const r = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ title: "Sky Forge", productName: "Cloud Works" }) })));
    expect(r.status).toBe(200);
    await settle();
    const out = await dashboard(dev.user.id);
    expect(out).toContain("data-your-tests-search");
    expect(out).toContain(`maxLength="${FIND_SEARCH_MAX}"`);
    expect(out.indexOf("Your tests</h2>")).toBeLessThan(out.indexOf("data-your-tests-search"));
    expect(out.indexOf("data-your-tests-search")).toBeLessThan(out.indexOf("Sky Forge"));
    expect((out.match(/data-test-card=/g) ?? []).length).toBe(2);
    // No developer's tests: no box (the "No tests yet" card).
    const empty = await makeUser({ dev: true, name: "Empty Dev" });
    expect(await dashboard(empty.user.id)).not.toContain("data-your-tests-search");
  });
});

describe("§204 the tester's Search by developer or test", () => {
  const rows = [
    { id: "1", title: "Harbor Run", developer: "Nora Lane", status: "Working on it", joinedAt: "2026-11-03", href: null },
    { id: "2", title: "Sky Forge", developer: "Ben Okafor", status: "Working on it", joinedAt: "2026-11-04", href: null },
    { id: "3", title: "Moss Maze", developer: "Cara Diaz", status: "Finished", joinedAt: "2026-11-01", href: null },
  ];
  it("the developer's name OR the test's name (the name-search rule), an exact name first; the lines", () => {
    expect(searchByDeveloper(rows, "nora").map((r) => r.id)).toEqual(["1"]); // developer
    expect(searchByDeveloper(rows, "FORGE").map((r) => r.id)).toEqual(["2"]); // test name, any case
    expect(searchByDeveloper(rows, "arbor").map((r) => r.id)).toEqual(["1"]); // any part from 3 characters
    expect(searchByDeveloper(rows, "ma").map((r) => r.id)).toEqual(["3"]); // 1-2 characters: a word's start ("Maze")
    expect(searchByDeveloper(rows, "ok").map((r) => r.id)).toEqual(["2"]);
    expect(searchByDeveloper(rows, "a").map((r) => r.id)).toEqual([]); // no word starts with "a"
    // Most recently joined first; an exact developer or test name first.
    expect(searchByDeveloper([...rows, { id: "4", title: "Nora", developer: "Zed", status: "Ended", joinedAt: "2026-10-01", href: null }], "nora").map((r) => r.id)).toEqual(["4", "1"]);
    expect(searchByDeveloper(rows, "  ")).toEqual([]);
    expect(devOrTestMatches({ title: "Harbor Run", developer: "Nora Lane" }, "run")).toBe(true);
    expect(devOrTestMatches({ title: "Harbor Run", developer: "Nora Lane" }, "lane")).toBe(true);
    expect(devOrTestMatches({ title: "Harbor Run", developer: "Nora Lane" }, "zed")).toBe(false);
    expect(DEV_SEARCH_LABEL).toBe("Search by developer or test");
    expect(noDevMatchLine(" zed ")).toBe("No tests match “zed”.");
    expect(noTodoMatchLine("zed")).toBe("No tests in To do match “zed”.");
  });

  it("the one box (no second box): its placeholder and label; To do passed in as `todo`, each row wrapped to be filtered", () => {
    const box = src("app/app/DevSearch.tsx");
    expect(box).toContain("placeholder={DEV_SEARCH_LABEL}");
    expect(box).toContain('<label htmlFor="devSearch" className="sr-only">{DEV_SEARCH_LABEL}</label>');
    expect(box).toMatch(/<\/section>\s*\{todo\}\s*\{!typed && children\}/);
    const dash = src("app/app/page.tsx");
    expect((dash.match(/<DevSearch /g) ?? []).length).toBe(1);
    const todo = dash.slice(dash.indexOf('id="to-do"'), dash.indexOf("</DevSearchList>"));
    expect((todo.match(/<DevSearchHit /g) ?? []).length).toBe(3); // answers, unsent parts, every part sent
    expect(todo).toContain("<DevSearchList rows=");
  });

  it("the dashboard: one search box, the To do rows under it with their tests", async () => {
    const { testId } = await setup({ title: "Harbor Run" });
    const tester = await makeUser({ tester: true, name: "Ana Silva" });
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect((await act(testId, "join", tester.cookie, { listingVersion: t.listingVersion })).status).toBe(200);
    const out = await dashboard(tester.user.id);
    expect((out.match(/type="search"/g) ?? []).length).toBe(2); // this box and History's own
    expect(out).toContain(`placeholder="${DEV_SEARCH_LABEL}"`);
    expect(out.indexOf('id="devSearch"')).toBeLessThan(out.indexOf('id="to-do"'));
    expect(out).toMatch(/data-todo-part="[^"]+:written"/);
    expect(out).not.toContain("data-todo-search-none");
  });
});
