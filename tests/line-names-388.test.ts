import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { bell, notify, sendSummaries } from "@/lib/server/notify";
import { markNames, renderNames } from "@/lib/server/lineNames";
import { displayName } from "@/lib/format";
import { joined, setup } from "./fixtures";

// (Owner, Nov 11, §388; recording round c17a case 1) Bell lines and their email lines show people's and tests' CURRENT names. A line keeps its stored text and
// where it named a person or a test (Notification.names); the bell (Notifications page) and the summary / morning emails read the current names there. A line
// written before (no names) keeps its text.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requireOpenPage: async () => auth.user, requirePageUser: async () => auth.user, adminAway() {}, leaveIfClosed() {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/notifications", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

/** The Notifications page's text. */
const bellPage = async (userId: string) => {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const { default: Notifications } = await import("@/app/app/notifications/page");
  // Tags stripped (each name is a green link now); a collapsed stack shows its newest line, shortened ("… on “Gullwing…").
  return render(await Notifications()).replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
};
/** The next summary email's body for this person (the clock is the test's own: a day after now). */
async function nextEmail(userId: string, at = new Date(Date.now() + 86_400_000)) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  await db.user.update({ where: { id: userId }, data: { emailPref: "daily", lastSummaryAt: null } });
  await sendSummaries(at, [userId]);
  const m = await db.outboxEmail.findFirst({ where: { to: u.email }, orderBy: { createdAt: "desc" } });
  return m?.text ?? "";
}

/** Nora Lane's “Harbor Run” with Ana Silva in it; a line to each naming the other and the test. */
async function world() {
  const s = await setup();
  const j = await joined(s.testId);
  await notify(s.dev.user.email, `Ana Silva sent her written answers on “Harbor Run”`, [], `/app/tests/${s.testId}`, { recipientId: s.dev.user.id });
  await bell(j.tester.user.id, `Nora Lane paid you $10.00 for your written answers on “Harbor Run”`, `/app/sessions/${j.sessionId}`);
  return { ...s, ...j };
}

describe("§388: bell lines read people's and tests' current names", () => {
  it("the marks: whole words only, longer names first, never overlapping; the line's own people before others of the same name", () => {
    const line = "Ana Silva paid Anna on “Ana Silva's Game”";
    const m = markNames(line, [{ k: "u", id: "ana", name: "Ana Silva" }, { k: "u", id: "anna", name: "Anna" }, { k: "t", id: "game", name: "Ana Silva's Game" }, { k: "u", id: "an", name: "An" }]);
    expect(m).toEqual([
      { k: "u", id: "ana", at: 0, name: "Ana Silva" },
      { k: "u", id: "anna", at: 15, name: "Anna" },
      { k: "t", id: "game", at: 24, name: "Ana Silva's Game" },
    ]);
    expect(markNames("Ana Silva rated you", [{ k: "u", id: "first", name: "Ana Silva" }, { k: "u", id: "second", name: "Ana Silva" }])).toEqual([{ k: "u", id: "first", at: 0, name: "Ana Silva" }]);
    expect(markNames("A Deleted account left", [{ k: "u", id: "x", name: "Deleted account" }])).toEqual([]);
    // A person named like the line's own words (an email's first part) is never marked: a rename never changes "your test".
    expect(markNames("Ben paid for your test", [{ k: "u", id: "t", name: "test" }, { k: "u", id: "b", name: "Ben" }])).toEqual([{ k: "u", id: "b", at: 0, name: "Ben" }]);
  });

  it("rename the test, the developer and the tester: an old line shows the new names in the bell and in the next morning email", async () => {
    const w = await world();
    const devLine = await db.notification.findFirstOrThrow({ where: { userId: w.dev.user.id, text: "Ana Silva sent her written answers on “Harbor Run”" } });
    expect(devLine.names).toEqual([{ k: "u", id: w.tester.user.id, at: 0, name: "Ana Silva" }, { k: "t", id: w.testId, at: 39, name: "Harbor Run" }]);
    await db.test.update({ where: { id: w.testId }, data: { title: "Gullwing Bay" } });
    await db.user.update({ where: { id: w.dev.user.id }, data: { name: "Nora Vance" } });
    await db.user.update({ where: { id: w.tester.user.id }, data: { name: "Ana Reyes" } });
    // The stored text is unchanged (search and every reader of the row keep working); the bell and the email read the current names.
    expect((await db.notification.findUniqueOrThrow({ where: { id: devLine.id } })).text).toBe("Ana Silva sent her written answers on “Harbor Run”");
    const devBell = await bellPage(w.dev.user.id);
    expect(devBell).toContain("Ana Reyes sent her written answers on “Gullwing");
    expect(devBell).not.toContain("Ana Silva");
    expect(devBell).not.toContain("Harbor Run");
    const testerBell = await bellPage(w.tester.user.id);
    expect(testerBell).toContain("Nora Vance paid you $10.00");
    expect(testerBell).not.toMatch(/Nora Lane|Harbor Run/);
    const devMail = await nextEmail(w.dev.user.id);
    expect(devMail).toContain("Ana Reyes sent her written answers on “Gullwing Bay”");
    expect(devMail).not.toMatch(/Ana Silva|Harbor Run/);
    const testerMail = await nextEmail(w.tester.user.id);
    expect(testerMail).toContain("Nora Vance paid you $10.00 for your written answers on “Gullwing Bay”");
    expect(testerMail).not.toMatch(/Nora Lane|Harbor Run/);
  });

  it("a deleted account's name reads as the current rules say (Deleted account)", async () => {
    const w = await world();
    await db.user.update({ where: { id: w.tester.user.id }, data: { deletedAt: new Date() } });
    expect(displayName({ email: "x@y.z", deletedAt: new Date() })).toBe("Deleted account");
    const bellNow = await bellPage(w.dev.user.id);
    expect(bellNow).toContain("Deleted account sent her written answers");
    expect(bellNow).not.toContain("Ana Silva");
  });

  it("a line written before (no marks) keeps its stored text; a mark whose place was rewritten is left alone", async () => {
    const w = await world();
    await db.test.update({ where: { id: w.testId }, data: { title: "Gullwing Bay" } });
    const rows = await renderNames([
      { text: "Ana Silva sent her written answers on “Harbor Run”", names: null },
      { text: "The site was down on “Harbor Run”", names: [{ k: "t", id: w.testId, at: 0, name: "Harbor Run" }] },
      { text: "On “Harbor Run”", names: [{ k: "t", id: w.testId, at: 4, name: "Harbor Run" }] },
    ]);
    expect(rows.map((r) => r.text)).toEqual(["Ana Silva sent her written answers on “Harbor Run”", "The site was down on “Harbor Run”", "On “Gullwing Bay”"]);
  });
});
