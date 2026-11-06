import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { linksIn, personLink, splitLinks, testLink, type LineLink } from "@/lib/lineLinks";
import { withLineLinks } from "@/components/LineLinks";
import { forgetLinks, knownLinks, rememberReply } from "@/lib/lineLinkRegistry";
import { BellList } from "@/app/app/notifications/BellList";
import { BankToConfirmBox } from "@/app/app/BankToConfirm";
import { WhatLine } from "@/components/WholeLine";
import { ChangesBox } from "@/components/ChangesBox";
import { BankNotice } from "@/components/BankCheck";
import { Err } from "@/components/Err";
import { OwedBox } from "@/components/OwedBox";
import { DevPaidList } from "@/components/PaymentLists";
import { CONFIRM_ALL } from "@/lib/confirmAllText";
import { paidRows } from "@/lib/server/paymentRows";
import { lineLinks, linkPool, withLineLinksFor } from "@/lib/server/lineLinks";
import { bankToConfirm } from "@/lib/server/confirm";
import { joined, sact, setup } from "./fixtures";

// (Owner, Nov 5, §270) Green, clickable names and tests in every line; rows that link to the exact part.
(globalThis as unknown as { React: typeof React }).React = React;
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams() }));

const h = React.createElement;
const html = (n: React.ReactNode) => renderToStaticMarkup(h(React.Fragment, null, n));
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const ANA: LineLink = { text: "Ana Silva", href: "/app/testers/u-ana", kind: "person" };
const HARBOR: LineLink = { text: "Harbor Run", href: "/app/tests/t1", kind: "test" };
const NORA: LineLink = { text: "Nora Lane", href: "/app/developers/u-nora", kind: "person" };
const DAY = 86_400_000;

describe("§270 the generalized link builder", () => {
  it("a person opens their profile, a test the reader's page for it; a deleted account and the reader ('You') stay plain", () => {
    expect(personLink({ id: "u1", name: "Ana Silva" }, "tester")).toEqual({ text: "Ana Silva", href: "/app/testers/u1", kind: "person" });
    expect(personLink({ id: "u2", name: "Nora Lane" }, "developer")).toEqual({ text: "Nora Lane", href: "/app/developers/u2", kind: "person" });
    expect(personLink({ id: "u3", name: "Deleted account", deleted: true }, "tester")).toBeNull();
    expect(personLink({ id: "u1", name: "Ana Silva" }, "tester", "u1")).toBeNull(); // the reader themselves
    expect(personLink({ id: "u9", name: "You" }, "tester")).toBeNull();
    expect(testLink({ id: "t1", title: "Harbor Run" }, { developer: true })?.href).toBe("/app/tests/t1");
    expect(testLink({ id: "t1", title: "Harbor Run" }, { sessionId: "c1" })?.href).toBe("/app/sessions/c1");
    expect(testLink({ id: "t1", title: "Harbor Run" })?.href).toBe("/app/find/t1");
  });

  it("linksIn keeps the names a line holds, standing alone (never inside a longer word or an email); 'you' is never one", () => {
    const pool = [ANA, HARBOR, NORA, { text: "Ana", href: "/app/testers/u-a", kind: "person" as const }];
    expect(linksIn("You paid Ana Silva for her written answers on “Harbor Run”", pool).map((l) => l.text)).toEqual(["Ana Silva", "Harbor Run"]);
    expect(linksIn("Anabela wrote to ana@x.com", pool)).toEqual([]);
    expect(linksIn("Your bank wants you to confirm", pool)).toEqual([]);
  });

  it("splitLinks: whole names, and a name the 50 cut ended with '…' keeps its visible start linked", () => {
    expect(splitLinks("Ana Silva's written answers on “Harbor Run”", [ANA, HARBOR])).toEqual([
      { t: "Ana Silva", link: ANA }, { t: "'s written answers on “" }, { t: "Harbor Run", link: HARBOR }, { t: "”" },
    ]);
    // The coordinator's example: "Alexandra Montgomery's written answers on “Harbor…"
    const ALEX: LineLink = { text: "Alexandra Montgomery", href: "/app/testers/u-alex", kind: "person" };
    expect(splitLinks("Alexandra Montgomery's written answers on “Harbor…", [ALEX, HARBOR])).toEqual([
      { t: "Alexandra Montgomery", link: ALEX }, { t: "'s written answers on “" }, { t: "Harbor", link: HARBOR }, { t: "…" },
    ]);
    // A person's name cut too.
    expect(splitLinks("You paid Alexandra…", [ALEX])).toEqual([{ t: "You paid " }, { t: "Alexandra", link: ALEX }, { t: "…" }]);
    // Nothing named: one plain piece.
    expect(splitLinks("Your tests are running again", [ANA])).toEqual([{ t: "Your tests are running again" }]);
  });

  it("withLineLinks draws each name and test as its own green link (the same green), the rest beside them", () => {
    const out = html(withLineLinks("Ana Silva sent work on “Harbor Run”", [ANA, HARBOR]));
    expect(out).toBe('<a href="/app/testers/u-ana" class="text-volt-300 hover:underline" data-line-link="person">Ana Silva</a> sent work on “<a href="/app/tests/t1" class="text-volt-300 hover:underline" data-line-link="test">Harbor Run</a>”');
    // With `rest`: the other words link to the row's place, side by side (never nested).
    const rest = html(withLineLinks("Ana Silva sent work", [ANA], { rest: "/app/tests/t1#piece-s1", restClass: "hover:underline" }));
    expect(rest).toBe('<a href="/app/testers/u-ana" class="text-volt-300 hover:underline" data-line-link="person">Ana Silva</a><a href="/app/tests/t1#piece-s1" class="hover:underline" data-line-rest=""> sent work</a>');
    expect(rest).not.toMatch(/<a[^>]*>[^<]*<a/);
  });
});

describe("§270 a bell line in pieces", () => {
  it("name link, test link and the rest of the line linking to its place; each piece marks the line read", () => {
    const text = "Ana Silva sent her written answers on “Harbor Run”";
    const out = renderToStaticMarkup(h(BellList, { entries: [
      { key: "solo|1", lines: [{ id: "1", text, href: "/app/tests/t1#piece-s1", read: false, ago: "2m ago", test: "Harbor Run", links: [ANA, HARBOR] }] },
      { key: "t1|d", title: "Harbor Run", test: true, testHref: "/app/tests/t1", day: "today", lines: [
        { id: "2", text, href: "/app/tests/t1#piece-s1", read: false, ago: "1m ago", links: [ANA, HARBOR] },
        { id: "3", text: "Ana Silva asked for a call", href: "/app/tests/t1#calls", read: false, ago: "1m ago", links: [ANA] },
      ] },
    ] }));
    expect(out).toContain('data-bell-line="1" data-bell-pieces=""');
    expect(out).toContain('<a class="text-volt-300 hover:underline" data-line-link="person" href="/app/testers/u-ana">Ana Silva</a>');
    expect(out).toContain('<a class="text-volt-300 hover:underline" data-line-link="test" href="/app/tests/t1">Harbor Run</a>');
    expect(out).toContain('<a class="text-inherit no-underline hover:underline" data-line-rest="" href="/app/tests/t1#piece-s1"> sent her written answers on “</a>');
    // Never nested: no link opens inside another.
    expect(out).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*<a /);
    // The stack's title names its test: its own green link (the heading toggles as a role="button", which can hold it).
    expect(out).toContain('role="button"');
    expect(out).toMatch(/<a class="text-volt-300 hover:underline \[overflow-wrap:anywhere\]" data-line-link="test" href="\/app\/tests\/t1">Harbor Run<\/a> · 2 updates today/);
    // Mark-as-read on every piece (each link carries the line's onClick).
    const list = src("app/app/notifications/BellList.tsx");
    expect(list).toContain('withLineLinks(short ?? l.text, l.links, { rest: l.href || null, restClass: "text-inherit no-underline hover:underline", onClick: () => markRead([l]), Anchor: Link })');
    expect(list).toContain("withLineLinks(l.text, l.links, { onClick: () => markRead([l]), Anchor: Link })");
    const pieces = withLineLinks(text, [ANA, HARBOR], { rest: "/x", onClick: () => null }) as React.ReactElement<{ children: React.ReactElement<{ onClick?: unknown }>[] }>;
    expect(pieces.props.children.every((c) => typeof c.props.onClick === "function")).toBe(true);
  });

  it("the notifications page sends each line its links (the reader's pool, its own test's people first)", () => {
    const page = src("app/app/notifications/page.tsx");
    expect(page).toContain("const pool = await linkPool(u.id, items.map((n) => n.testId));");
    expect(page).toContain("links: lineLinks(pool, n.text, n.testId)");
  });
});

describe("§270 payment rows, confirm rows, owed lines (with the database)", () => {
  beforeEach(() => forgetLinks());

  it("the developer's payment row: the tester and test are green links; the other words open the exact part (#piece-<sent work>)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Ana Silva");
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const p = await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 1000, status: "charged" } });
    const rows = await paidRows([{ ...p, note: p.note ?? "" }], "developer");
    const row = rows.get(p.id)!;
    expect(row.href).toBe(`/app/tests/${testId}#piece-${sub.id}`);
    expect(row.links).toEqual([{ text: "Ana Silva", href: `/app/testers/${tester.user.id}`, kind: "person" }, { text: "Harbor Run", href: `/app/tests/${testId}`, kind: "test" }]);
    const out = renderToStaticMarkup(h(DevPaidList, { paid: { list: [{ ...p, createdAt: p.createdAt }] as never, rows, totalCents: 1000 }, fmtDateTime: () => "Nov 5" }));
    expect(out).toContain(`<a href="/app/testers/${tester.user.id}" class="text-volt-300 hover:underline" data-line-link="person">Ana Silva</a>`);
    expect(out).toContain(`<a href="/app/tests/${testId}#piece-${sub.id}" class="hover:underline" data-line-rest="">&#x27;s written answers on “</a>`);
    expect(out).toContain(`<a href="/app/tests/${testId}" class="text-volt-300 hover:underline" data-line-link="test">Harbor Run</a>`);
    // The tester's own row: the developer's profile and the tester's session page.
    const theirs = (await paidRows([{ ...p, note: p.note ?? "" }], "tester")).get(p.id)!;
    expect(theirs.links).toEqual([{ text: "Nora Lane", href: `/app/developers/${dev.user.id}`, kind: "person" }, { text: "Harbor Run", href: `/app/sessions/${sessionId}`, kind: "test" }]);
    // The reader's pool: the tester's view of the same names; the reader never in it.
    const pool = await linkPool(tester.user.id);
    expect(lineLinks(pool, "Nora Lane changed “Harbor Run”").map((l) => l.href)).toEqual([`/app/developers/${dev.user.id}`, `/app/sessions/${sessionId}`]);
    expect(lineLinks(pool, "Ana Silva")).toEqual([]);
  });

  it("the confirm row ('Your bank wants you to confirm'): the name and the test cut by the 50 cut stay green links, closed and opened", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId, "Alexandra Montgomery");
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: sessionId, developerId: dev.user.id, testerId: tester.user.id, amountCents: 1000, feeCents: 0, testerCents: 0, status: "needs_confirmation", actionPi: "pi_" + randomUUID(), actionBy: new Date(Date.now() + 2 * DAY) } });
    const rows = await bankToConfirm(dev.user.id);
    expect(rows[0].links?.map((l) => l.text)).toEqual(["Alexandra Montgomery", "Harbor Run"]);
    const closed = renderToStaticMarkup(h(BankToConfirmBox, { rows }));
    // "$10.00 · Alexandra Montgomery's written answers on “Harbor… · confirm by …"
    expect(closed).toContain(`<a href="/app/testers/${tester.user.id}" class="text-volt-300 hover:underline" data-line-link="person">Alexandra Montgomery</a>&#x27;s written answers on “<a href="/app/tests/${testId}" class="text-volt-300 hover:underline" data-line-link="test" target="_blank" rel="noreferrer">Harbor</a>…`);
    // Opened (the whole "what"): the whole test name is the link.
    const open = renderToStaticMarkup(h(WhatLine, { text: "Alexandra Montgomery's written answers on “Harbor Run”", startOpen: true, links: rows[0].links }));
    expect(open).toContain(`data-line-link="test">Harbor Run</a>”`);
    expect(open).toContain(`data-line-link="person">Alexandra Montgomery</a>`);
  });

  it("Confirm all: its stop bullets and the lines in its bank window carry the names' green links", async () => {
    const { dev, testId } = await setup();
    const { tester } = await joined(testId, "Ana Silva");
    // A Confirm all stop as the server hands it back (handle() adds the reader's links to each line).
    const reply = await withLineLinksFor(dev.user.id, "Press again to go ahead.", { changes: [{ text: "Ana Silva charged $10.00 for her written answers on “Harbor Run”", at: new Date().toISOString() }], totalCents: 1000, ids: ["x"] });
    const changes = reply!.changes as { text: string; at: string; links: LineLink[] }[];
    expect(changes[0].links).toEqual([{ text: "Ana Silva", href: `/app/testers/${tester.user.id}`, kind: "person" }, { text: "Harbor Run", href: `/app/tests/${testId}`, kind: "test" }]);
    const box = renderToStaticMarkup(h(ChangesBox, { changes, press: CONFIRM_ALL }));
    expect(box).toContain("Your Confirm all didn&#x27;t go through.");
    expect(box).toContain(`<a href="/app/testers/${tester.user.id}" class="text-volt-300 hover:underline" data-line-link="person">Ana Silva</a> charged $10.00`);
    // The bank window's notice lines: the peek's reply carries `links`, kept for the lines drawn from it.
    rememberReply({ status: "waiting", changes: ["Ana Silva disputed the pay for her recording."], links: changes[0].links });
    const notice = renderToStaticMarkup(h(BankNotice, { notice: { lines: ["Ana Silva disputed the pay for her recording on “Harbor Run”."], still: "Complete still pays $10.00 as pressed; or press Close.", cancelled: "" } }));
    expect(notice).toContain(`data-bank-notice-line=""><a href="/app/testers/${tester.user.id}" class="text-volt-300 hover:underline" data-line-link="person">Ana Silva</a> disputed`);
    expect(notice).toContain(`data-line-link="test">Harbor Run</a>`);
    expect(src("app/api/payments/confirm/route.ts")).toContain("links: linksForTexts(await linkPool(u.id), changes.filter(");
    // The Confirm all row itself ("Confirm all (3) · $42.00", "Confirm all: $42.00 for 3 payments is waiting for your bank.") names no one.
  });
});

describe("§270 bell lines written before the change (links found when the bell is read)", () => {
  it("a stored old-format line ('Receipt: you paid $15.50 for bb's live call on “excerptexcer…” …') shows its person and test as green links", async () => {
    const { dev, testId } = await setup({ title: "excerptexcerpt run" });
    const { tester } = await joined(testId, "bb");
    // Written yesterday by the old code: only text, link and test are stored (no links); the test's name cut at 10 then.
    const old = "Receipt: you paid $15.50 for bb's live call on “excerptexcer…” (Tue, Oct 27, 7:15 AM)";
    const n = await db.notification.create({ data: { userId: dev.user.id, text: old, link: `/app/tests/${testId}#call-c1`, testId, side: "developer", createdAt: new Date(Date.now() - DAY) } });
    // As the notifications page reads it: the reader's pool (the test's developer and its contracts' testers), matched as written.
    const pool = await linkPool(dev.user.id, [n.testId]);
    const links = lineLinks(pool, n.text, n.testId);
    expect(links).toEqual([{ text: "bb", href: `/app/testers/${tester.user.id}`, kind: "person" }, { text: "excerptexcerpt run", href: `/app/tests/${testId}`, kind: "test" }]);
    const out = renderToStaticMarkup(h(BellList, { entries: [{ key: "solo|1", lines: [{ id: n.id, text: n.text, href: n.link, read: false, ago: "Nov 4", links }] }] }));
    expect(out).toContain(`<a class="text-volt-300 hover:underline" data-line-link="person" href="/app/testers/${tester.user.id}">bb</a>`);
    // Closed, the 50 cut ends before the test; opened (the whole line), the cut test name's visible start is its link.
    expect(out).toContain("&#x27;s live call on…</a>");
    expect(html(withLineLinks(n.text, links, { draw: (t) => t }))).toContain(`<a href="/app/tests/${testId}" class="text-volt-300 hover:underline" data-line-link="test">excerptexcer</a>…”`);
    // A name nobody in the pool has stays plain.
    expect(lineLinks(pool, "Receipt: you paid $4.00 for Zed Quinn's written answers")).toEqual([]);
  });
});

describe("§270 an owed line, a stop bullet, a blue notice", () => {
  beforeEach(() => forgetLinks());

  it("Pay what you owe: each line's names and tests are green links (closed at 50 and opened)", () => {
    const text = "Alexandra Montgomery's written answers on “Harbor Run”";
    const ALEX: LineLink = { text: "Alexandra Montgomery", href: "/app/testers/u-alex", kind: "person" };
    const out = renderToStaticMarkup(h(OwedBox, { onHold: true, owed: [{ id: "o1", retry: true, amountCents: 1000, until: null, text: `${text} $10.00 · failed`, full: `${text} $10.00 · failed`, what: text, rest: " $10.00 · failed", links: [ALEX, HARBOR] }] } as never));
    expect(out).toContain('data-owed-line="o1"');
    expect(out).toContain('<a href="/app/testers/u-alex" class="text-volt-300 hover:underline" data-line-link="person">Alexandra Montgomery</a>');
    expect(out).toContain('<a href="/app/tests/t1" class="text-volt-300 hover:underline" data-line-link="test">Harbor</a>…');
    expect(src("lib/server/holds.ts")).toContain("links: lineLinks(pool, o.full ?? o.text)");
  });

  it("a stop bullet: its names green links; a line that opens its place keeps the other words linked there", () => {
    const out = renderToStaticMarkup(h(ChangesBox, { changes: [
      { text: "Ana Silva asked for a call", at: new Date().toISOString(), links: [ANA] },
      { text: "Nora Lane edited “Harbor Run”", at: new Date().toISOString(), link: "/app/tests/t1#listing", links: [NORA, HARBOR] },
    ], press: "Pay" }));
    expect(out).toContain('<a href="/app/testers/u-ana" class="text-volt-300 hover:underline" data-line-link="person">Ana Silva</a> asked for a call');
    expect(out).toContain('<a href="/app/developers/u-nora" class="text-volt-300 hover:underline" data-line-link="person">Nora Lane</a><a href="/app/tests/t1#listing" data-line-rest=""> edited “</a>');
  });

  it("a blue notice (a refusal): the names its reply carried are green links; 'You' stays plain", () => {
    rememberReply({ code: "x", message: "Ana Silva withdrew this request.", links: [ANA] });
    expect(knownLinks()).toEqual([ANA]);
    const out = renderToStaticMarkup(h(Err, { text: "Ana Silva withdrew this request.", press: "Join call" }));
    expect(out).toContain('<a href="/app/testers/u-ana" class="text-volt-300 hover:underline" data-line-link="person">Ana Silva</a>');
    expect(out).toContain("Your Join call didn&#x27;t go through");
    expect(out).not.toMatch(/<a[^>]*>Your/);
    // The server adds them to every refusal and stop (handle()), for the request's reader.
    expect(src("lib/server/http.ts")).toContain("m.withLineLinksFor(await m.requestViewerId(), e.message, data)");
  });
});
