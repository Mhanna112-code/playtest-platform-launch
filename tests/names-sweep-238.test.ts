import React, { cloneElement, createElement as h, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { DIFF_CUT, cutNamesIn, offerLine } from "@/lib/cutNames";
import { NAME_CUT, cutEmail, cutTo } from "@/lib/rules";
import { WholeLine, cutPieces } from "@/components/WholeLine";
import { PagedList } from "@/app/admin/PagedList";
import type { ReportVM } from "@/lib/server/adminLists";
import { act, joined, seen, settle, setup } from "./fixtures";

// (Owner, Nov 5, batch 35 §238) The names sweep: names cut at 20 with "…" and the arrow (§220) on the tester dashboard's To do and Waiting rows, Ratings to give,
// the join page's developer lines and the admin's Reports rows (names cut, emails cut in the middle, links kept).

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, requireOpenPage: async () => auth.user, adminAway: () => {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), redirect: () => { throw Error("redirect"); }, notFound: () => { throw Error("not found"); } }));
(globalThis as unknown as { React: typeof React }).React = React;
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

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
async function dashboard(user: User) {
  auth.user = user;
  const { default: Page } = await import("@/app/app/page");
  return unescape(renderToStaticMarkup(await serverTree(await Page({ searchParams: Promise.resolve({}) }))));
}
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");
/** The element starting at the attribute `attr` (its opening tag back to its closing `</tag>`). */
const block = (html: string, attr: string, tag = "li") => { const at = html.indexOf(attr); expect(at, attr).toBeGreaterThan(-1); const start = html.lastIndexOf(`<${tag}`, at); return html.slice(start, html.indexOf(`</${tag}>`, at)); };

const DEV = "Maximiliana Alexandrina Lopez-Whitfield";
const DIFF = "written $8 → $12, added a recording ($15), 7 → 10 days, questions changed";

describe("§238 offerLine (the To do row's new terms)", () => {
  it("cuts the developer's name at 20 and a long diff at 40; each … lines up with the whole line; nothing long: no cut", () => {
    expect([NAME_CUT, DIFF_CUT]).toEqual([20, 40]);
    const x = offerLine(DEV, DIFF);
    expect(x.shown).toBe(`${cutTo(DEV)} offered new terms: ${cutTo(DIFF, 40)}`);
    expect(x.full).toBe(`${DEV} offered new terms: ${DIFF}`);
    const pieces = cutPieces(x.shown, x.full!)!;
    expect(pieces.filter((p) => p.hidden != null)).toHaveLength(2);
    expect(pieces.map((p) => p.hidden ?? p.text).join("")).toBe(x.full);
    expect(offerLine("Nora Lane", "written $8 → $10")).toEqual({ shown: "Nora Lane offered new terms: written $8 → $10", full: null });
  });
});

describe("§238 the tester dashboard", () => {
  it("To do: the offer row and the live-call row cut the developer's name (… and the arrow), the row opening through a link laid over the card", async () => {
    const s = await setup();
    const j = await joined(s.testId, "Ana Silva", "she");
    const v = (await db.test.findUniqueOrThrow({ where: { id: s.testId } })).version;
    expect((await act(s.testId, "edit", s.dev.cookie, { version: v, fields: { writtenCents: "12.00" }, seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: j.sessionId, status: "open" } });
    await db.termsOffer.update({ where: { id: offer.id }, data: { diff: DIFF } });
    await db.user.update({ where: { id: s.dev.user.id }, data: { name: DEV } });
    const html = await dashboard(j.tester.user);
    const row = block(html, `data-todo-answer="offer-${offer.id}"`);
    // The row's own link lies over the card (no <a> around the line's buttons); the test's name is its own link above it.
    expect(row).toMatch(/<a [^>]*class="absolute inset-0[^"]*"/);
    expect(row).toContain('data-name-link="test"');
    const line = block(row, 'data-todo-answer-line=""', "div");
    expect(line).toContain(`<span>${cutTo(DEV).slice(0, -1)}</span><button`);
    expect(line).toContain(`title="${DEV}`); // (§244) the hover shows the whole line
    expect(line).not.toContain(`>${DIFF}`);
    expect(line.match(/data-name-toggle=""/g)).toHaveLength(2);
    expect(line).toContain('data-whole-toggle=""');
    expect(line).toContain("title="); // (§244) the hover shows the whole line too
    expect(src("app/app/page.tsx")).toContain("...cutNamesIn(`${displayName(c.test.developer)} asked for a live call`, [displayName(c.test.developer)])");
  });

  it("Waiting for the developer: the application and invite-only cards show the test's name whole and green (§245, TestName), with no truncate or title hover", () => {
    const page = src("app/app/page.tsx");
    expect(page).toContain('data-app-waiting-title=""><TestName text={appTests.get(a.testId)?.title ?? "A test"} />');
    expect(page).toContain('data-invite-only-title=""><TestName text={appTests.get(a.testId)?.title ?? "A test"} /></p>');
    expect(page).not.toContain('truncate font-medium text-white" title={appTests.get(a.testId)');
    expect(page).not.toContain('<span className="truncate" title={a.c.title}>');
  });
});

describe("§238 Ratings to give", () => {
  it("each row is a WholeLine of its names cut at 20 (no truncate, no hover), the row's link laid over it", () => {
    const rtg = src("app/app/RatingsToGive.tsx");
    expect(rtg).toContain("const x = cutNamesIn(r.text, r.names); return <WholeLine shown={x.shown} full={x.full} />;");
    expect(rtg).not.toContain("title={r.text}");
    expect(rtg).toContain('className="absolute inset-0 rounded-lg');
    expect(src("lib/server/ratings.ts")).toContain("names: [displayName(c.test.developer), c.test.title]"); // (§342)
    expect(src("lib/server/ratings.ts")).toContain("names: [displayName(c.tester), c.test.title]"); // (Owner, Nov 9, §342) the current title
    const TITLE = "Harbor Run: The Extended Lighthouse Edition";
    const x = cutNamesIn(`Rate ${DEV} on “${TITLE}”`, [DEV, TITLE]);
    expect(x.shown).toBe(`Rate ${cutTo(DEV)} on “${cutTo(TITLE)}”`);
    const html = unescape(renderToStaticMarkup(h(WholeLine, { shown: x.shown, full: x.full })));
    expect(html.match(/data-name-toggle=""/g)).toHaveLength(2);
    expect(html).toContain('data-whole-toggle=""');
  });
});

describe("§238 the join page", () => {
  it("'<dev> approves each tester' and '<dev> invited you' cut the developer's name with … (NameLine)", () => {
    const page = src("app/app/find/[id]/page.tsx");
    expect(page).toContain("const x = cutNamesIn(text, [dev]); return <NameLine shown={x.shown} full={x.full}");
    expect(page).toContain("{devLine(`${dev} approves each tester`, false)}");
    expect(page).toContain("{devLine(`${dev} invited you`)}");
    expect(page).not.toContain(">{dev} approves each tester");
    expect(page).not.toContain(">{dev} invited you");
  });
});

describe("§238 the admin's Reports list", () => {
  it("each name whole (§245: never cut; its profile link kept), each email cut in the middle, the label after the email", () => {
    const EMAIL = "maximiliana.alexandrina.lopez@playtest.test";
    const row: ReportVM = { id: "r1", at: new Date().toISOString(), reporter: `${DEV} (Reported more than 3 times)`, reporterName: DEV, reporterHref: "/app/developers/d1", reporterEmail: EMAIL, reported: "Ana Silva", reportedName: "Ana Silva", reportedHref: "/app/testers/t1", reportedEmail: "ana@playtest.test", when: "Nov 5", note: "Rude" };
    const html = unescape(renderToStaticMarkup(h(PagedList, { kind: "reports", initial: { rows: [row], next: null, total: 1 } as never, fixed: true })));
    const p = block(html, 'data-report-row="r1"', "div");
    expect(p).toContain(`<a href="/app/developers/d1" data-report-name="">${DEV}</a>`);
    expect(p).not.toContain(`>${cutTo(DEV)}</span>`);
    expect(p).toContain(`>${cutEmail(EMAIL)}</span>`);
    expect(p).toContain("</span>) (Reported more than 3 times) reported ");
    expect(p).toContain('<a href="/app/testers/t1" data-report-name="">Ana Silva</a> (ana@playtest.test) · Nov 5');
  });

  it("the rest of the console: the failed emails, the admin box's heading and the decide tick cut their name or email", () => {
    expect(src("app/admin/page.tsx")).toContain("To <Cut text={m.to} kind=\"email\" />");
    expect(src("app/admin/AdminBoxes.tsx")).toContain("Payments as <Cut text={name} /> sees them");
    expect(src("app/admin/DisputeDecision.tsx")).toContain("{nameCut(decideTickLabel(dev, extra, typed!), dev)}");
  });
});
