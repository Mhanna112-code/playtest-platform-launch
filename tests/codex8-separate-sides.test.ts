import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { sideFor, sideLink } from "@/lib/sides";
import { bell, notify, sendSummaries, unreadEntryCount } from "@/lib/server/notify";
import { GET, POST } from "@/app/app/switch/route";
import { POST as readPOST } from "@/app/api/notifications/read/route";
import { POST as sidePOST } from "@/app/api/account/side/route";
import { makeUser, req } from "./helpers";

vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: vi.fn(), adminAway: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-path": "/app/tests/example" })) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/app", useSearchParams: () => new URLSearchParams() }));
import { requirePageUser } from "@/lib/server/page-auth";
import { headers } from "next/headers";
import AppLayout from "@/app/app/layout";
import Notifications from "@/app/app/notifications/page";
import Account from "@/app/app/account/page";
import Payments from "@/app/app/payments/page";
import { AlertSettings } from "@/app/app/notifications/AlertSettings";
import { DeleteAccount } from "@/app/app/account/DeleteAccount";

const oldReact = globalThis.React;
vi.stubGlobal("React", React);
afterAll(() => { vi.stubGlobal("React", oldReact); });
function find(node: React.ReactNode, predicate: (el: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) { for (const x of node) { const found = find(x, predicate); if (found) return found; } }
  if (React.isValidElement<Record<string, unknown>>(node)) {
    if (predicate(node)) return node;
    return find(node.props.children as React.ReactNode, predicate);
  }
}
async function both(side: "developer" | "tester") {
  const b = await makeUser({ dev: true, tester: true });
  b.user = await db.user.update({ where: { id: b.user.id }, data: { side } });
  vi.mocked(requirePageUser).mockResolvedValue(b.user);
  return b;
}
const sideOf = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id } })).side;
const switchRequest = (cookie: string, to: string) => new Request("http://localhost:3400/app/switch", { method: "POST", headers: { cookie, origin: "http://localhost:3400", "content-type": "application/x-www-form-urlencoded" }, body: `to=${to}&next=/app` });

describe("Task 8: only explicit switches change sides", () => {
  it.each(["developer", "tester"] as const)("an opposite page on the %s side shows only the switch notice and retains that side", async (side) => {
    const b = await both(side);
    const target = side === "developer" ? "tester" : "developer";
    vi.mocked(headers).mockResolvedValue(new Headers({ "x-path": target === "developer" ? "/app/tests/example" : "/app/find/example" }) as never);
    const tree = await AppLayout({ children: React.createElement("div", null, "PRIVATE OPPOSITE PAGE") });
    const main = find(tree, (e) => e.type === "main")!;
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null, main.props.children as React.ReactNode));
    expect(html).toContain(`This page is on your ${target} side.`);
    expect(html).toContain(`Switch to your ${target} side`);
    expect(html).toContain('method="post"');
    expect(html).not.toContain("PRIVATE OPPOSITE PAGE");
    expect(sideFor(b.user, "/app/tests/example")).toBe(side);
    expect(await sideOf(b.user.id)).toBe(side);
  });
  it("shows the page normally on the current side", async () => {
    await both("developer");
    vi.mocked(headers).mockResolvedValue(new Headers({ "x-path": "/app/tests/example" }) as never);
    const main = find(await AppLayout({ children: React.createElement("div", null, "MY PAGE") }), (e) => e.type === "main")!;
    expect(renderToStaticMarkup(React.createElement(React.Fragment, null, main.props.children as React.ReactNode))).toContain("MY PAGE");
  });
  it("links go directly to pages and old GET switch links only redirect, for every request origin", async () => {
    const b = await both("developer");
    expect(sideLink(b.user, "/app/find/example")).toBe("/app/find/example");
    for (const site of ["same-origin", "same-site", "none", "cross-site", ""]) {
      const r = await GET(req("/app/switch?to=tester&next=/app/find/example", { cookie: b.cookie, headers: site ? { "sec-fetch-site": site } : {} }));
      expect(r.headers.get("location")).toBe("http://localhost:3400/app/find/example");
      expect(await r.text()).not.toContain("<form");
      expect(await sideOf(b.user.id)).toBe("developer");
    }
    const safe = await GET(req("/app/switch?next=//evil.example", { cookie: b.cookie }));
    expect(safe.headers.get("location")).toBe("http://localhost:3400/app");
  });
  it("the switch POST and Account switch API change sides", async () => {
    const b = await both("developer");
    expect((await POST(switchRequest(b.cookie, "tester"))).status).toBe(303);
    expect(await sideOf(b.user.id)).toBe("tester");
    expect((await sidePOST(req("/api/account/side", { cookie: b.cookie, body: { side: "developer" } }))).status).toBe(200);
    expect(await sideOf(b.user.id)).toBe("developer");
  });
  it("Stripe return routes contain no side write", () => {
    for (const route of ["card-saved", "payout-return"]) {
      const source = readFileSync(`src/app/api/payments/${route}/route.ts`, "utf8");
      expect(source).not.toContain("side:");
      expect(source).not.toContain("user.update");
    }
  });
});

describe("Task 8: notifications are separated by side", () => {
  it("derives path sides, accepts explicit shared-page sides, and keeps account lines neutral", async () => {
    const b = await both("tester");
    await bell(b.user.id, "Developer work", "/app/tests/x");
    await bell(b.user.id, "Tester work", "/app/sessions/y");
    await notify(b.user.email, "Receipt", [], "/app/payments", { payment: true, side: "developer" });
    await notify(b.user.email, "Payout", [], "/app/payments", { payment: true, side: "tester" });
    await bell(b.user.id, "Password", "/app/account#password");
    await bell(b.user.id, "Your excerpt", `/app/testers/${b.user.id}#excerpts`, undefined, { side: "tester" });
    const rows = await db.notification.findMany({ where: { userId: b.user.id } });
    expect(Object.fromEntries(rows.map((n) => [n.text, n.side]))).toEqual({ "Developer work": "developer", "Tester work": "tester", Receipt: "developer", Payout: "tester", Password: null, "Your excerpt": "tester" });
  });
  it.each(["developer", "tester"] as const)("the %s bell count, page list and read endpoint include only that side plus account lines", async (side) => {
    const b = await both(side);
    await bell(b.user.id, "DEVELOPER ONLY", "/app/payments", undefined, { side: "developer", own: true });
    await bell(b.user.id, "TESTER ONLY", "/app/payments", undefined, { side: "tester", own: true });
    await bell(b.user.id, "ACCOUNT ONLY", "/app/account", undefined, { own: true });
    expect(await unreadEntryCount(b.user.id)).toBe(2);
    const tree = await Notifications();
    const list = find(tree, (e) => Array.isArray(e.props.entries))!;
    const text = JSON.stringify(list.props.entries);
    expect(text).toContain(side === "developer" ? "DEVELOPER ONLY" : "TESTER ONLY");
    expect(text).not.toContain(side === "developer" ? "TESTER ONLY" : "DEVELOPER ONLY");
    expect(text).toContain("ACCOUNT ONLY");
    const all = await db.notification.findMany({ where: { userId: b.user.id } });
    await readPOST(req("/api/notifications/read", { cookie: b.cookie, body: { ids: all.map((n) => n.id) } }));
    const unread = await db.notification.findMany({ where: { userId: b.user.id, readAt: null } });
    expect(unread).toHaveLength(1);
    expect(unread[0].side).toBe(side === "developer" ? "tester" : "developer");
  });
  it("one email contains both headings and account notices, and sends each line only once", async () => {
    const b = await both("tester");
    await notify(b.user.email, "DEV PAYMENT", [], "/app/payments", { side: "developer", payment: true });
    await notify(b.user.email, "TESTER PAYMENT", [], "/app/payments", { side: "tester", payment: true });
    await notify(b.user.email, "ACCOUNT TERMS", [], "/app/account", { always: true });
    await sendSummaries(new Date(), [b.user.id]);
    const emails = await db.outboxEmail.findMany({ where: { to: b.user.email } });
    expect(emails).toHaveLength(1);
    expect(emails[0].text).toMatch(/Your account[\s\S]*ACCOUNT TERMS[\s\S]*As a developer[\s\S]*DEV PAYMENT[\s\S]*As a tester[\s\S]*TESTER PAYMENT/);
    await sendSummaries(new Date(), [b.user.id]);
    expect(await db.outboxEmail.count({ where: { to: b.user.email } })).toBe(1);
  });
  it("backfills old path, payment, rating and account notices without losing rows", async () => {
    const b = await both("tester");
    const examples = [
      ["Own test", "/app/tests/x", null, "developer"],
      ["Session", "/app/sessions/x", null, "tester"],
      ["Receipt", "/app/payments", null, "developer"],
      ["Your payout setup is done: $8.00 on its way.", "/app/payments", null, "tester"],
      ["Payout reminder", "/app/payments#payout", "payout", "tester"],
      ["Your developer account is active again", "/app", "admindecision", "developer"],
      ["Your tester account is active again", "/app", "admindecision", "tester"],
      ["Terms changed", "/app/account", null, null],
      ["Excerpt", "/app/testers/x#excerpts", "excerpts", "tester"],
      ["Developer rating", "/app#ratings-to-give", null, "developer"],
      ["Tester rating", "/app#ratings-to-give", null, "tester"],
    ] as const;
    // The test's owner identifies historical rating prompts even on shared dashboard links.
    const { listingBody } = await import("./fixtures");
    const { createTest } = await import("@/lib/server/tests");
    const t = await createTest(b.user, listingBody());
    const other = await makeUser({ dev: true });
    const t2 = await createTest(other.user, listingBody());
    await db.contract.create({ data: { testerId: b.user.id, testId: t2.id, title: "Other", dueAt: new Date(), questions: [] } });
    const made = [];
    for (const [text, link, groupKey] of examples) made.push(await db.notification.create({ data: { userId: b.user.id, text, link, groupKey, testId: text === "Developer rating" ? t.id : text === "Tester rating" ? t2.id : null } }));
    const sql = readFileSync("prisma/migrations/20261030180000_notification_sides/migration.sql", "utf8");
    await db.$executeRawUnsafe(sql.slice(sql.indexOf('UPDATE "Notification"')));
    const rows = await db.notification.findMany({ where: { id: { in: made.map((n) => n.id) } } });
    expect(rows).toHaveLength(examples.length);
    for (const [text, , , expected] of examples) expect(rows.find((n) => n.text === text)?.side, text).toBe(expected);
  });
});

describe("Task 8: shared pages show the current side", () => {
  it.each(["developer", "tester"] as const)("Payments and Account on the %s side keep the other side's settings out", async (side) => {
    const b = await both(side);
    const paymentTree = await Payments({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(paymentTree);
    expect(html).not.toContain(side === "tester" ? "Pay what you owe" : "Everything you sent");
    expect(html).toContain(side === "tester" ? "Payout" : "card");
    const accountTree = await Account();
    const accountHtml = renderToStaticMarkup(accountTree);
    expect(accountHtml).toContain(side === "tester" ? "Tester profile" : "Developer profile");
    expect(accountHtml).not.toContain(side === "tester" ? "Developer profile" : "Tester profile");
    expect(accountHtml).toContain("This deletes your whole account: both your developer side and your tester side.");
    expect(accountHtml).not.toContain("anything you owe");
    const warning = find(accountTree, (e) => e.type === DeleteAccount)!;
    expect(warning.props.both).toBe(true);
    expect(warning.props.owes).toBe(false);
    expect(await sideOf(b.user.id)).toBe(side);
  });
  it("notification help names only the current side's payment kinds", () => {
    const dev = renderToStaticMarkup(React.createElement(AlertSettings, { emailPref: "daily", side: "developer" }));
    const tester = renderToStaticMarkup(React.createElement(AlertSettings, { emailPref: "daily", side: "tester" }));
    expect(dev).toContain("receipts, failures, holds, retries and chargebacks");
    expect(dev).not.toContain("payouts");
    expect(tester).toContain("payments, delays and payouts");
    expect(tester).not.toMatch(/failures|holds|chargebacks/);
  });
});
