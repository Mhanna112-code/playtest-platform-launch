import React, { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import AppHome from "@/app/app/page";
import { StatusPill } from "@/components/Ui";
import { joined, setup } from "./fixtures";

// (Owner, Nov 2026) An open test whose Open until has passed (testers still working) never reads "Accepting testers": its pill reads "Joining closed" (grey, like
// "Full"), beside the amber "Joining closed · testers working until …" badge, on the developer's dashboard card and the test page's top panel.

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
const dashboard = async (id: string) => {
  page.user = await db.user.findUniqueOrThrow({ where: { id } });
  return renderToStaticMarkup(await serverTree(await AppHome({ searchParams: Promise.resolve({}) })));
};
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const pill = (p: { status: string; full?: boolean; joiningClosed?: boolean }) => renderToStaticMarkup(createElement(StatusPill, p));

describe("Owner, Nov 2026: the status pill after Open until", () => {
  it("open past Open until: 'Joining closed' (grey), never 'Accepting testers'; it wins over Full; other states unchanged", () => {
    expect(pill({ status: "open", joiningClosed: true })).toContain("Joining closed");
    expect(pill({ status: "open", joiningClosed: true })).toContain('data-status-pill="joining-closed"');
    expect(pill({ status: "open", joiningClosed: true })).not.toContain("Accepting");
    expect(pill({ status: "open", joiningClosed: true })).not.toContain("emerald");
    expect(pill({ status: "open", full: true, joiningClosed: true })).toContain("Joining closed");
    expect(pill({ status: "open", full: true, joiningClosed: true })).not.toContain("Full");
    expect(pill({ status: "open" })).toContain("Accepting testers");
    expect(pill({ status: "stopped", joiningClosed: true })).toContain("Stopped");
    expect(pill({ status: "closed", joiningClosed: true })).toContain("Not accepting testers");
  });

  it("the developer's dashboard: a running test past Open until shows the grey 'Joining closed' pill and the amber badge, no 'Accepting testers'", async () => {
    const { dev, testId } = await setup({ title: "Harbor Run" });
    await joined(testId);
    let out = await dashboard(dev.user.id);
    expect(out).toContain("Accepting testers"); // before Open until
    expect(out).not.toContain('data-status-pill="joining-closed"');
    await db.test.update({ where: { id: testId }, data: { openUntil: new Date(Date.now() - 86_400_000) } });
    out = await dashboard(dev.user.id);
    expect(out).toContain('data-status-pill="joining-closed"');
    expect(out).toContain("data-joining-closed");
    expect(out).toContain("Joining closed · testers working until");
    expect(out).not.toContain("Accepting testers");
  });

  it("the test page's top panel: the pill reads 'Joining closed' beside its joinClosedLine; both TopPanels on the page pass joiningClosed", async () => {
    const { TopPanel } = await import("@/app/app/tests/[id]/TopPanel");
    const props = { id: "example", title: "Example", status: "open", terms: "", spotsLine: "1 of 3 spots used", seenAt: new Date().toISOString(), working: [], joinMode: "anyone", openUntil: new Date(Date.now() - 86_400_000).toISOString() };
    const closed = renderToStaticMarkup(createElement(TopPanel, { ...props, joiningClosed: true, joinClosedLine: "Joining closed · testers working until Dec 3" }));
    expect(closed).toContain('data-status-pill="joining-closed"');
    expect(closed).toContain("Joining closed · testers working until Dec 3");
    expect(closed).not.toContain("Accepting testers");
    expect(renderToStaticMarkup(createElement(TopPanel, props))).toContain("Accepting testers");
    expect(src("app/app/tests/[id]/page.tsx").match(/joiningClosed=\{!!t\.openUntil && t\.openUntil < new Date\(\)\}/g)).toHaveLength(2);
    expect(src("app/app/tests/[id]/TopPanel.tsx")).toContain("joiningClosed={p.joiningClosed}");
  });
});
