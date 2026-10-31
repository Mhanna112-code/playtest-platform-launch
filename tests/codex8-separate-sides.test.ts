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

vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: vi.fn(), requireOpenPage: vi.fn(), requireOpenDevPage: vi.fn(), adminAway: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-path": "/app/tests/example" })) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); }, useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/app", useSearchParams: () => new URLSearchParams() }));
import { requireOpenDevPage, requireOpenPage, requirePageUser } from "@/lib/server/page-auth";
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
  vi.mocked(requireOpenPage).mockResolvedValue(b.user);
  vi.mocked(requireOpenDevPage).mockResolvedValue(b.user);
  return b;
}
const sideOf = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id } })).side;
const switchRequest = (cookie: string, to: string) => new Request("http://localhost:3400/app/switch", { method: "POST", headers: { cookie, origin: "http://localhost:3400", "content-type": "application/x-www-form-urlencoded" }, body: `to=${to}&next=/app` });

describe("Task 8: only explicit switches change sides", () => {
  it.each(["developer", "tester"] as const)("an opposite page on the %s side shows only the switch notice and retains that side", async (side) => {
    const b = await both(side);
    const target = side === "developer" ? "tester" : "developer";
    vi.mocked(headers).mockResolvedValue(new Headers({ "x-path": target === "developer" ? "/app/tests/new" : "/app/find" }) as never);
    // The page itself renders only the notice (a move inside the app keeps the layout; a full load is the same page).
    const page = target === "developer" ? await (await import("@/app/app/tests/new/page")).default({ searchParams: Promise.resolve({}) }) : await (await import("@/app/app/find/page")).default({ searchParams: Promise.resolve({}) } as never);
    const html = renderToStaticMarkup(page as ReactElement);
    expect(html).toContain(`This page is on your ${target} side.`);
    expect(html).toContain(`Switch to your ${target} side`);
    expect(html).toContain('method="post"');
    expect(html).not.toMatch(target === "developer" ? /Post a test</ : /Find tests</);
    // The layout around it stays on the side in use (no redirect, the header's side) and keeps the page's slot.
    const tree = await AppLayout({ children: page as ReactElement });
    const main = find(tree, (e) => e.type === "main")!;
    expect(renderToStaticMarkup(React.createElement(React.Fragment, null, main.props.children as React.ReactNode))).toContain(`This page is on your ${target} side.`);
    expect(renderToStaticMarkup(find(tree, (e) => e.type === "header")!)).toContain(`· ${side === "developer" ? "Developer" : "Tester"}`);
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
    await db.contract.create({ data: { testerId: b.user.id, testId: t2.id, title: "Other", dueAt: new Date(), questions: [], listingVersion: 1, buildUrl: "", description: "", deadlineDays: 7 } });
    const made = [];
    for (const [text, link, groupKey] of examples) made.push(await db.notification.create({ data: { userId: b.user.id, text, link, groupKey, testId: text === "Developer rating" ? t.id : text === "Tester rating" ? t2.id : null } }));
    const sql = readFileSync("prisma/migrations/20261109090000_notification_sides/migration.sql", "utf8");
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
    expect(html).toMatch(side === "tester" ? /payout account/i : /Your card/);
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

// ---------- Added when finishing Task 8 (Claude) ----------

const asUser = async (id: string, side: "developer" | "tester") => {
  const u = await db.user.update({ where: { id }, data: { side } });
  vi.mocked(requirePageUser).mockResolvedValue(u);
  vi.mocked(requireOpenPage).mockResolvedValue(u);
  return u;
};
const at = (path: string) => vi.mocked(headers).mockResolvedValue(new Headers({ "x-path": path }) as never);
const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("Task 8 (finish): a page of the other side never runs, and never changes the side", () => {
  it("every side page returns only the notice on the other side, before reading anything; your own public profile is the side it shows", async () => {
    const { otherSideHere } = await import("@/lib/server/sidePage");
    const b = await both("tester");
    for (const p of ["/app/tests/x", "/app/tests/new", "/app/tests/x/edit", "/app/testers/someone"]) { at(p); expect(await otherSideHere(b.user), p).toBe("developer"); }
    for (const p of ["/app/find", "/app/find/x", "/app/sessions/x", "/app/developers/someone", "/app/payments", "/app", `/app/testers/${b.user.id}`]) { at(p); expect(await otherSideHere(b.user), p).toBeNull(); }
    at(`/app/developers/${b.user.id}`);
    expect(await otherSideHere(b.user)).toBe("developer");
    // A chat or a call goes by the person's role in that test.
    expect(await otherSideHere(b.user, "developer")).toBe("developer");
    expect(await otherSideHere(b.user, "tester")).toBeNull();
    // One side only: never a notice.
    const one = await makeUser({ tester: true });
    at("/app/tests/x");
    expect(await otherSideHere(one.user)).toBeNull();
    expect(await sideOf(b.user.id)).toBe("tester");
    // Each side page checks it right after signing in, before reading anything (a join-page visit isn't recorded, nothing is marked read).
    // Every page under the side folders (today's and any added later).
    const { readdirSync } = await import("node:fs");
    const pages = ["tests", "testers", "find", "sessions", "developers"].flatMap((d) => (readdirSync(`src/app/app/${d}`, { recursive: true }) as string[]).filter((x) => /(^|[\\/])page\.tsx$/.test(x)).map((x) => `${d}/${x}`));
    expect(pages.length).toBeGreaterThanOrEqual(8);
    for (const page of pages) expect(readFileSync(`src/app/app/${page}`, "utf8"), page).toMatch(/const otherSide = await otherSideNotice\((u|viewer)\);.*\n\s*if \(otherSide\) return otherSide;/);
    for (const page of ["chat/[id]/page.tsx", "calls/[id]/page.tsx"]) expect(readFileSync(`src/app/app/${page}`, "utf8"), page).toMatch(/const otherSide = await otherSideNotice\(u, .*\);\n\s*if \(otherSide\) return otherSide;/);
    // The notice's button is the switch POST, back to the page itself (Next's internal _rsc parameter left out).
    const { otherSideNotice } = await import("@/components/OtherSideNotice");
    const b2 = await both("developer");
    at("/app/find/abc?from=bell&_rsc=x1");
    const html = renderToStaticMarkup((await otherSideNotice(b2.user))!);
    expect(html).toContain('action="/app/switch"');
    expect(html).toContain('name="to" value="tester"');
    expect(html).toContain('name="next" value="/app/find/abc?from=bell"');
    expect(await sideOf(b2.user.id)).toBe("developer");
  });

  it("a restricted side doesn't send a page of the other side away: it shows the notice (the restriction applies once switched)", async () => {
    const b = await both("tester");
    vi.mocked(requirePageUser).mockResolvedValue(await db.user.update({ where: { id: b.user.id }, data: { testerSuspendedAt: new Date() } }));
    at("/app/tests/x");
    const { otherSideNotice } = await import("@/components/OtherSideNotice");
    const page = (await otherSideNotice(await db.user.findUniqueOrThrow({ where: { id: b.user.id } })))!;
    const main = find(await AppLayout({ children: page }), (e) => e.type === "main")!; // no redirect to the dashboard
    expect(renderToStaticMarkup(React.createElement(React.Fragment, null, main.props.children as React.ReactNode))).toContain("This page is on your developer side.");
    // A page of its own side still goes to the dashboard.
    at("/app/find");
    await expect(AppLayout({ children: null })).rejects.toThrow("redirect:/app");
  });

  it("back from Stripe on the other side: the notice, not the other side's banner, and the side stays", async () => {
    const b = await both("tester");
    const html = renderToStaticMarkup(await Payments({ searchParams: Promise.resolve({ saved: "card" }) }));
    expect(html).toContain("This page is on your developer side.");
    expect(html).not.toContain("Card saved.");
    expect(html).toContain('name="next" value="/app/payments?saved=card"');
    await asUser(b.user.id, "developer");
    const back = renderToStaticMarkup(await Payments({ searchParams: Promise.resolve({ saved: "payout" }) }));
    expect(back).toContain("This page is on your tester side.");
    expect(back).not.toContain("Your payout account is connected.");
    expect(renderToStaticMarkup(await Payments({ searchParams: Promise.resolve({ saved: "card" }) }))).toContain("Card saved.");
    expect(await sideOf(b.user.id)).toBe("developer");
  });

  it("an account with one side sees all its lines, with no headings in the email", async () => {
    const t = await makeUser({ tester: true });
    vi.mocked(requirePageUser).mockResolvedValue(t.user);
    await bell(t.user.id, "INVITE LINE", "/app/find/x");
    await bell(t.user.id, "ODD DEV LINE", "/app/payments", undefined, { side: "developer", own: true });
    expect(await unreadEntryCount(t.user.id)).toBe(2);
    await notify(t.user.email, "TESTER PAY", [], "/app/payments", { side: "tester", payment: true });
    await sendSummaries(new Date(), [t.user.id]);
    const mail = await db.outboxEmail.findFirstOrThrow({ where: { to: t.user.email } });
    expect(mail.text).toContain("TESTER PAY");
    expect(mail.text).not.toMatch(/As a developer|As a tester|Your account/);
  });

  it("a team $0 close is the tester's line, on the tester side (it was filed under developer)", () => {
    expect(readFileSync("src/lib/server/teamClose.ts", "utf8")).toContain('`/app/sessions/${p.contractId}#${anchor}`, { side: "tester", payment: true, group: "tpaid" }');
  });

  it("the delete warning: both sides on either side; what's owed only when the developer side owes; one side reads only its part", async () => {
    const b = await both("tester");
    vi.mocked(requirePageUser).mockResolvedValue(await db.user.update({ where: { id: b.user.id }, data: { holdStartedAt: new Date(), holdReason: "unpaid" } }));
    const tree = await Account();
    expect(find(tree, (e) => e.type === DeleteAccount)!.props.owes).toBe(true);
    const tester = renderToStaticMarkup(React.createElement(DeleteAccount, { sides: "tester" }));
    expect(tester).toContain("Your applications are cancelled, and you leave the tests you are in.");
    expect(tester).not.toMatch(/Your tests stop|both your developer side|anything you owe/);
    const dev = renderToStaticMarkup(React.createElement(DeleteAccount, { sides: "developer", owes: true }));
    expect(dev).toContain("Your tests stop and your invites are cancelled.");
    expect(dev).toContain("anything you owe (a payment hold, a chargeback) stays with it");
    // The confirm repeats the both-sides line.
    expect(readFileSync("src/app/app/account/DeleteAccount.tsx", "utf8")).toContain('{both && <p className="font-medium text-white" data-delete-both="">{BOTH_SIDES_LINE}</p>}');
  });
});

describe("Task 8 (finish), the owner's proof: nothing of the other side leaks", () => {
  it("an account with both sides and money on both: Payments, Account, Notifications, Messages and the bell of each side, and one email with both headings", async () => {
    const { POST: testsPOST } = await import("@/app/api/tests/route");
    const { POST: reviewPOST } = await import("@/app/api/review/route");
    const { randomUUID } = await import("node:crypto");
    const { json } = await import("./helpers");
    const { act, joined, sact, seen, settle, setup, listingBody } = await import("./fixtures");
    const { bellKey } = await import("@/lib/bell");
    const Messages = (await import("@/app/app/messages/page")).default;
    const pay = (cookie: string, id: string) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), kind: "submission", id, amount: "10.00", tickedCents: 1000 } })).then(json);
    // Bo has both sides: their own test "Owned Harbor" (Ana sends work, Bo pays) and Lagoon's test "Joined Lagoon" (Bo sends work, its developer pays).
    const bo = await makeUser({ dev: true, tester: true, name: "Bo Both" });
    const own = await json(await testsPOST(req("/api/tests", { cookie: bo.cookie, body: listingBody({ title: "Owned Harbor", productName: "Owned Harbor" }) })));
    expect(own.status).toBe(200);
    await settle();
    const ana = await joined(own.body.id, "Ana Silva");
    await sact(ana.sessionId, "written", ana.tester.cookie, { answers: ["a", "b"] });
    await settle();
    expect((await pay(bo.cookie, (await db.submission.findFirstOrThrow({ where: { contractId: ana.sessionId } })).id)).status).toBe(200);
    const lagoon = await setup({ title: "Joined Lagoon", productName: "Joined Lagoon" });
    const t2 = await db.test.findUniqueOrThrow({ where: { id: lagoon.testId } });
    const j = await act(lagoon.testId, "join", bo.cookie, { listingVersion: t2.listingVersion });
    expect(j.status).toBe(200);
    await settle();
    await sact(j.body.sessionId, "written", bo.cookie, { answers: ["c", "d"] });
    await settle();
    expect((await pay(lagoon.dev.cookie, (await db.submission.findFirstOrThrow({ where: { contractId: j.body.sessionId } })).id)).status).toBe(200);
    const lines = await db.notification.findMany({ where: { userId: bo.user.id } });
    expect(lines.filter((n) => n.side === "developer").length).toBeGreaterThan(0);
    expect(lines.filter((n) => n.side === "tester").length).toBeGreaterThan(0);

    const words = {
      developer: ["Owned Harbor", "Receipt:", "What you've paid", "Your card", "Ana Silva"],
      tester: ["Joined Lagoon", "paid you", "Everything you sent", "Your earnings", "Where your money goes"],
    };
    for (const side of ["developer", "tester"] as const) {
      const other = side === "developer" ? "tester" : "developer";
      await asUser(bo.user.id, side);
      at("/app/payments");
      const pages = {
        payments: visible(renderToStaticMarkup(await Payments({ searchParams: Promise.resolve({}) }))),
        account: visible(renderToStaticMarkup(await Account())),
        notifications: JSON.stringify(find(await Notifications(), (e) => Array.isArray(e.props.entries))!.props.entries),
        messages: visible(renderToStaticMarkup(await Messages())),
      };
      for (const [page, text] of Object.entries(pages)) for (const w of words[other]) expect(text, `${side} ${page}: "${w}"`).not.toContain(w);
      expect(pages.notifications, side).toContain(side === "developer" ? "Receipt:" : "paid you");
      expect(pages.messages, side).toContain(side === "developer" ? "Owned Harbor" : "Joined Lagoon");
      // The bell's number is this side's (plus the account's) only.
      const mine = await db.notification.findMany({ where: { userId: bo.user.id, readAt: null, OR: [{ side }, { side: null }] } });
      expect(await unreadEntryCount(bo.user.id), side).toBe(new Set(mine.map(bellKey)).size);
    }
    expect(await sideOf(bo.user.id)).toBe("tester");
    await sendSummaries(new Date(), [bo.user.id]);
    const mail = await db.outboxEmail.findFirstOrThrow({ where: { to: bo.user.email }, orderBy: { createdAt: "desc" } });
    expect(mail.text).toContain("As a developer");
    expect(mail.text).toContain("As a tester");
    const dev = mail.text.slice(mail.text.indexOf("As a developer"), mail.text.indexOf("As a tester"));
    const tester = mail.text.slice(mail.text.indexOf("As a tester"));
    expect(dev).toContain("Receipt: you paid $10.00 for Ana Silva's written answers");
    expect(dev).not.toContain("Joined Lagoon");
    expect(tester).toContain("Joined Lagoon");
    expect(tester).not.toContain("Owned Harbor");
  });
});
