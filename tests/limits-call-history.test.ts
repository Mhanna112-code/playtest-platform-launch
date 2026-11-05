import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { LIMITS } from "@/lib/limits";
import { WRITTEN_MAX_CHARS, additionTooLongLine, checkAdditionLength, checkWrittenLength } from "@/lib/rules";
import { ADDITION_CUT_WHAT, additionRule, cutToLine, limitEdit } from "@/lib/typingLimit";
import { ADDITIONS_FULL, questionKeys } from "@/lib/additions";
import { POST as helpPOST } from "@/app/api/help/route";
import { WrittenAddForm } from "@/app/app/sessions/[id]/SessionActions";
import { joined, sact, seen, setup } from "./fixtures";
import { json, req } from "./helpers";

// (Owner, Nov 4, §186) Every 50,000-character limit is 20,000; an addition ("Add to this answer") has the same limit as the answers sent first, on its own. The
// call history on both sides (two drop-downs, "Booked (N)" and "Cancelled (N)") was replaced by §209 (tests/calls-had-cancelled-209.test.ts).

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, getPageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/tests/test", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const unescape = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const Q1 = "What did you like?", Q2 = "Where did you get stuck?";

describe("§186 text limits: 20,000 (was 50,000)", () => {
  it("the written part and Contact us", () => {
    expect(WRITTEN_MAX_CHARS).toBe(20_000);
    expect(LIMITS.contact).toEqual({ min: 10, max: 20_000 });
    expect(checkWrittenLength(["a".repeat(20_000)]).ok).toBe(true);
    expect(checkWrittenLength(["a".repeat(12_000), "b".repeat(8_001)])).toMatchObject({ ok: false, message: "Your written answers can be at most 20,000 characters in all (now 20,001)." });
    // No 50,000 left in the code.
    for (const f of ["lib/limits.ts", "lib/rules.ts", "app/app/sessions/[id]/SessionActions.tsx", "lib/typingLimit.ts"]) expect(src(f), f).not.toMatch(/50_000|50000|(?<!was )50,000/);
  });

  it("an addition: 20,000 of its own (markers not counted), whatever the rest holds", () => {
    expect(checkAdditionLength("a".repeat(20_000)).ok).toBe(true);
    expect(checkAdditionLength("a".repeat(20_001))).toMatchObject({ ok: false, message: "Your addition can be at most 20,000 characters (now 20,001)." });
    expect(additionTooLongLine(25_000)).toBe("Your addition can be at most 20,000 characters (now 25,000).");
    expect(checkAdditionLength("a".repeat(20_000) + "[📎 picture.png #abcd]").ok).toBe(true);
    const rule = additionRule();
    expect(rule.max).toBe(20_000);
    expect(rule.cutNote).toBe(cutToLine(20_000, ADDITION_CUT_WHAT));
    expect(rule.cutNote).toBe("Cut to the 20,000-character limit for this addition.");
    // A paste is cut at 20,000; an older draft already longer is never cut: it may only shrink.
    expect(limitEdit("", "x".repeat(20_005), rule).value).toHaveLength(20_000);
    const old = "y".repeat(25_000);
    expect(limitEdit(old, old + "z", rule).value).toBe(old);
    expect(limitEdit(old, old.slice(1), rule).value).toHaveLength(24_999);
  });

  it("the add form counts only its own text: 'N / 20,000', and a read-only draft keeps maxLength 20,000", () => {
    const f = src("app/app/sessions/[id]/SessionActions.tsx");
    expect(f).toContain("const length = writtenLength([text]);");
    expect(f).toContain("return setErr(FIELD + additionTooLongLine(length));");
    expect(f).toContain("total={length} alone value={text} onChange={setText} />");
    expect(f).toContain("readOnly value={text} maxLength={WRITTEN_MAX_CHARS} data-add-readonly");
    expect(f).not.toContain("used: number");
    expect(src("app/app/sessions/[id]/page.tsx")).not.toContain("used={writtenLength(");
    // (Owner, Nov 5, §222) At the question's 5: its own row's note, no button.
    const html = render(h(WrittenAddForm, { sessionId: "s1", seenAt: seen(), questionKey: "qabc", question: Q1, made: 5 }));
    expect(html).toContain("data-additions-full");
    expect(html).not.toContain("data-add-more");
  });

  it("(Owner, Nov 5, §222; replaces §186's one note for the part's 10) a question at its 5: only its row closes, with its note; the other rows stay open", async () => {
    const { testId } = await setup({ questions: [Q1, Q2] });
    const j = await joined(testId);
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["first", "second"], seenAt: seen(), confirmed: true })).status).toBe(200);
    const [k1, k2] = questionKeys([{ question: Q1 }, { question: Q2 }]);
    const sub = await db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: j.sessionId, kind: "written" } } });
    const adds = Array.from({ length: 6 }, (_, i) => ({ at: new Date(Date.now() - 60_000 + i).toISOString(), text: `more ${i}`, files: [], questionKey: i < 5 ? k1 : k2 }));
    await db.submission.update({ where: { id: sub.id }, data: { additions: adds } });
    auth.user = await db.user.findUniqueOrThrow({ where: { id: j.tester.user.id } });
    const { default: SessionPage } = await import("@/app/app/sessions/[id]/page");
    const page = unescape(render(await SessionPage({ params: Promise.resolve({ id: j.sessionId }) })));
    expect(page.match(/data-additions-full=""/g)).toHaveLength(1);
    expect(page).toContain(`data-additions-full="">${ADDITIONS_FULL}</p>`);
    const rows = page.slice(page.indexOf("data-add-buttons"));
    expect(rows.indexOf(`data-add-for="${k1}"`)).toBeLessThan(rows.indexOf("data-additions-full"));
    expect(rows.indexOf("data-additions-full")).toBeLessThan(rows.indexOf(`data-add-for="${k2}"`));
    // Q2 and Anything else keep their button; Q2 says how many are left.
    expect(rows.match(/data-add-more="written"/g)).toHaveLength(2);
    expect(rows).toContain("4 of 5 additions left");
    // The developer's side never shows the note.
    expect(src("app/app/tests/[id]/page.tsx")).not.toContain("ADDITIONS_FULL");
  });

  it("Contact us refuses 20,001 characters (never cut)", async () => {
    const { dev } = await setup();
    const r = await json(await helpPOST(req("/api/help", { cookie: dev.cookie, body: { topic: "Payments", message: "x".repeat(20_001) } })));
    expect(r.status).toBe(400);
    expect(await db.contactMessage.count({ where: { userId: dev.user.id } })).toBe(0);
  });

  it("on the server: an addition at 20,000 goes through and 20,001 is refused on the first press, independent of the other answers' length", async () => {
    const { testId } = await setup({ questions: [Q1, Q2] });
    const j = await joined(testId);
    // The answers sent first fill their own 20,000 (19,990 + 10).
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a".repeat(19_940), "b".repeat(50)], notes: "c".repeat(10), seenAt: seen(), confirmed: true })).status).toBe(200);
    const [k1, k2] = questionKeys([{ question: Q1 }, { question: Q2 }]);
    // No `confirmed`: a too-long addition is refused at once, never a stop box first.
    const long = await sact(j.sessionId, "written-add", j.tester.cookie, { text: "x".repeat(20_001), question: k1, seenAt: seen() });
    expect(long.status).toBe(400);
    expect(long.body.error).toMatchObject({ code: "too_long", message: "Your addition can be at most 20,000 characters (now 20,001)." });
    const add = (text: string, question: string) => sact(j.sessionId, "written-add", j.tester.cookie, { text, question, seenAt: seen(), confirmed: true });
    expect((await add("x".repeat(20_000), k1)).status).toBe(200);
    // A second one at 20,000: the part now holds 60,000 characters, and that's fine.
    expect((await add("y".repeat(20_000), k2)).status).toBe(200);
    expect((await add("z".repeat(20_001), k2)).body.error.message).toBe("Your addition can be at most 20,000 characters (now 20,001).");
    const sub = await db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: j.sessionId, kind: "written" } } });
    expect((sub.additions as { text: string }[]).map((a) => a.text.length)).toEqual([20_000, 20_000]);
  });
});

// (Owner, Nov 5, §209) §186's call history (Booked / Cancelled, the tester's Call history card) was replaced: tests/calls-had-cancelled-209.test.ts.
