import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { cutNamesIn } from "@/lib/cutNames";
import { NAME_CUT, cutTo } from "@/lib/rules";
import { NameLine, cutPieces } from "@/components/WholeLine";
import { joined, setup } from "./fixtures";

// (Owner, Nov 5, batch 35 §236) The tester's Terms history: the whole list in its own draggable scroll panel, and every name in a line cut at 20 (NAME_CUT) with
// "…" opening that name in place and the arrow opening the whole line (§220's WholeLine), server text with names baked in included.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/s", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;
const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const DEV = "Maximiliana Alexandrina Lopez-Whitfield";
const TEST = "Harbor Run: The Extended Lighthouse Edition";

describe("§236 cutNamesIn", () => {
  it("cuts each long name and each long quoted name at 20, and the cut line lines up with the whole one (each … opens its piece)", () => {
    const line = `Nov 5: ${DEV} renamed the test from “${TEST}” to “Short name”`;
    const x = cutNamesIn(line, [DEV, "Ana Silva"]);
    expect(NAME_CUT).toBe(20);
    expect(x.shown).toBe(`Nov 5: ${cutTo(DEV)} renamed the test from “${cutTo(TEST)}” to “Short name”`);
    expect(x.full).toBe(line);
    const pieces = cutPieces(x.shown, x.full!)!;
    expect(pieces.filter((p) => p.hidden != null)).toHaveLength(2);
    expect(pieces.map((p) => p.hidden ?? p.text).join("")).toBe(line);
    expect(cutNamesIn("Nov 5: Nora Lane moved your deadline", ["Nora Lane"])).toEqual({ shown: "Nov 5: Nora Lane moved your deadline", full: null });
  });

  it("NameLine: a cut line has a … per name and the arrow; an uncut one links the developer's name", () => {
    const x = cutNamesIn(`Nov 5: ${DEV} offered new terms (written $10 → $12)`, [DEV]);
    const cut = renderToStaticMarkup(h(NameLine, { shown: x.shown, full: x.full, name: DEV, href: "/app/developers/d1" }));
    expect(cut).toContain('data-name-toggle=""');
    expect(cut).toContain('data-whole-toggle=""');
    expect(cut.replace(/ title="[^"]*"/g, "")).not.toContain(DEV); // (§244) only the hover holds the whole line
    const plain = renderToStaticMarkup(h(NameLine, { shown: "Nov 5: Nora Lane offered new terms", full: null, name: "Nora Lane", href: "/app/developers/d1" }));
    expect(plain).toContain('<a href="/app/developers/d1" data-name-link="person">Nora Lane</a>');
    expect(plain).not.toContain("data-whole-toggle");
  });
});

describe("§236 the tester's Terms history on the session page", () => {
  it("in its own draggable panel; a long developer name and a long quoted test name in a contract note are cut with their … and the arrow", async () => {
    const { dev, testId } = await setup();
    const j = await joined(testId);
    await db.user.update({ where: { id: dev.user.id }, data: { name: DEV } });
    await db.contractNote.create({ data: { contractId: j.sessionId, kind: "renamed", text: `${DEV} renamed “${TEST}” to “Harbor Run”` } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: j.tester.user.id } });
    const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
    const page = unescape(renderToStaticMarkup(await SessionPage({ params: Promise.resolve({ id: j.sessionId }) })));
    const history = page.slice(page.indexOf('data-terms-history=""'));
    expect(history).toContain(`data-panel="terms-history-${j.sessionId}"`);
    expect(history).toContain('data-terms-history-list=""');
    const at = history.indexOf("renamed");
    const note = history.slice(history.lastIndexOf("<li", at), history.indexOf("</li>", at));
    expect(note).toContain('data-whole-toggle=""');
    expect(note.match(/data-name-toggle=""/g)).toHaveLength(2);
    expect(note.replace(/ title="[^"]*"/g, "")).not.toContain(TEST); // (§244) only the hover holds the whole line
  });
});
