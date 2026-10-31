import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { AdminRich } from "@/app/admin/AdminRich";
import { withoutNote } from "@/app/admin/AccountActions";
import { coveredLine, gapSources, gapsUnseen, needsChangedLabel, profileUpdatedLabel, sameGaps, updateLabels } from "@/lib/gaps";
import { plainOf, quoted } from "@/lib/rich";
import { NO_PENDING_APPLICATION } from "@/lib/server/joining";
import { json, makeUser, req } from "./helpers";
import { act, seen, setup } from "./fixtures";

// Batch 35 §43-§48 (owner, Oct 31): admin reasons in the quoted box; the needs pop-up says where a change came from and follows the one-or-none rule; an admin's
// own actions in another tab stop once ("You … in another tab at …") and refusals say "You already …"; Invite's search rows with the redraw; Withdraw names why.

(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const T = "\\d{1,2}:\\d{2}\\s[AP]M";

type Res = { status: number; body: { error?: { code: string; message: string; changes?: { text: string }[]; press?: string; now?: string } } & Record<string, unknown> };
/** An admin press from one page load (`tab`, as every browser press sends it in x-tab). */
const aact = (cookie: string, action: string, body: Record<string, unknown>, tab?: string): Promise<Res> =>
  adminPOST(req(`/api/admin/${action}`, { cookie, body, headers: tab ? { "x-tab": tab } : {} }), { params: Promise.resolve({ action }) }).then(json);
async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test`, name: "Team Member" });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
const loaded = async () => {
  const at = seen();
  await new Promise((r) => setTimeout(r, 15));
  return at;
};
const again = (stop: Res) => ({ confirmed: true, boxAt: stop.body.error!.now });
function expectStop(r: Res, press: string, lines: RegExp[]) {
  expect(r.status).toBe(409);
  expect(r.body.error).toMatchObject({ code: "stop_once", press });
  expect(r.body.error!.changes!.map((c) => c.text)).toEqual(lines.map((l) => expect.stringMatching(l)));
}
const you = (what: string) => new RegExp(`^You ${esc(what)} in another tab at ${T}\\.$`);
const youAlready = (what: string) => new RegExp(`^You already ${esc(what)} in another tab at ${T}\\.$`);
const refused = (r: Res, message: RegExp) => {
  expect(r.status).toBe(409);
  expect(r.body.error!.code).not.toBe("stop_once");
  expect(r.body.error!.message).toMatch(message);
};

describe("batch 35 §45: an admin's own actions in another tab", () => {
  it("a test: Stop after this admin's own Pause in another tab stops once with the 'You' line; the second press stops the test", async () => {
    const a = await admin();
    const s = await setup();
    const since = await loaded();
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking" }, "tab-A")).status).toBe(200);
    const stop = await aact(a.cookie, "stop-test", { id: s.testId, note: "Spam", since }, "tab-B");
    expectStop(stop, "Stop (close)", [you("paused this test")]);
    expect((await aact(a.cookie, "stop-test", { id: s.testId, note: "Spam", since, ...again(stop) }, "tab-B")).status).toBe(200);
  });

  it("the page that made the change never stops itself (its own tab)", async () => {
    const a = await admin();
    const s = await setup();
    const since = await loaded();
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking" }, "tab-A")).status).toBe(200);
    expect((await aact(a.cookie, "stop-test", { id: s.testId, note: "Spam", since }, "tab-A")).status).toBe(200);
  });

  it("Pause ↔ Lift the pause, Close now ↔ Extend: own other-tab changes are listed in order, in the second person", async () => {
    const a = await admin();
    const s = await setup();
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking" }, "tab-A")).status).toBe(200);
    const since = await loaded();
    expect((await aact(a.cookie, "extend-pause", { id: s.testId, days: "7" }, "tab-A")).status).toBe(200);
    await new Promise((r) => setTimeout(r, 15));
    const stop = await aact(a.cookie, "close-paused", { id: s.testId, since }, "tab-B");
    expectStop(stop, "Close now", [you("extended this test's closing date")]);
    expect((await aact(a.cookie, "unpause-test", { id: s.testId }, "tab-A")).status).toBe(200);
    const stop2 = await aact(a.cookie, "pause-test", { id: s.testId, note: "Again", since }, "tab-B");
    expectStop(stop2, "Pause", [you("extended this test's closing date"), you("lifted the pause on this test")]);
  });

  it("refusals for presses no longer possible: 'You already …' instead of '(by you@… at …)'", async () => {
    const a = await admin();
    const s = await setup();
    const since = await loaded();
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking" }, "tab-A")).status).toBe(200);
    refused(await aact(a.cookie, "pause-test", { id: s.testId, note: "Again", since }, "tab-B"), youAlready("paused this test"));
    expect((await aact(a.cookie, "unpause-test", { id: s.testId }, "tab-A")).status).toBe(200);
    refused(await aact(a.cookie, "unpause-test", { id: s.testId, since }, "tab-B"), youAlready("lifted the pause on this test"));
    expect((await aact(a.cookie, "stop-test", { id: s.testId, note: "Spam" }, "tab-A")).status).toBe(200);
    refused(await aact(a.cookie, "stop-test", { id: s.testId, note: "Spam", since }, "tab-B"), youAlready("stopped this test"));
    refused(await aact(a.cookie, "pause-test", { id: s.testId, note: "Spam", since }, "tab-B"), youAlready("stopped this test"));
  });

  it("an account: Delete after this admin's own Suspend in another tab stops once; Suspend twice and Delete twice say 'You already …'", async () => {
    const a = await admin();
    const x = await makeUser({ name: "Nora Lane", dev: true, tester: true });
    const since = await loaded();
    expect((await aact(a.cookie, "suspend", { id: x.user.id, side: "developer", note: "Fraud reports" }, "tab-A")).status).toBe(200);
    refused(await aact(a.cookie, "suspend", { id: x.user.id, side: "developer", note: "Again", since, from: "page" }, "tab-B"), youAlready("suspended the developer side"));
    const stop = await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since }, "tab-B");
    expectStop(stop, "Delete account", [you("suspended the developer side")]);
    // The same page's own Suspend never stops its Delete.
    expect((await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since }, "tab-A")).status).toBe(200);
    refused(await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since }, "tab-B"), youAlready("deleted this account"));
  });

  it("Reinstate twice says 'You already reinstated …'; Mark replied twice says 'You already marked this replied …'", async () => {
    const a = await admin();
    const x = await makeUser({ name: "Nora Lane", dev: true, tester: true });
    expect((await aact(a.cookie, "suspend", { id: x.user.id, side: "tester", note: "Spam reports" }, "tab-A")).status).toBe(200);
    const since = await loaded();
    expect((await aact(a.cookie, "unsuspend", { id: x.user.id, side: "tester" }, "tab-A")).status).toBe(200);
    refused(await aact(a.cookie, "unsuspend", { id: x.user.id, side: "tester", since, from: "page" }, "tab-B"), youAlready("reinstated the tester side"));
    const m = await db.contactMessage.create({ data: { userId: x.user.id, topic: "Payments", message: "Where is my payout?" } });
    expect((await aact(a.cookie, "contact-replied", { id: m.id }, "tab-A")).status).toBe(200);
    refused(await aact(a.cookie, "contact-replied", { id: m.id, since }, "tab-B"), youAlready("marked this replied"));
  });

  it("other admins' wording is unchanged; a press that sends no tab counts only other admins (as before)", async () => {
    const a = await admin(), b = await admin();
    const s = await setup();
    const since = await loaded();
    expect((await aact(b.cookie, "pause-test", { id: s.testId, note: "Checking" }, "tab-X")).status).toBe(200);
    expect((await aact(a.cookie, "extend-pause", { id: s.testId, days: "7" }, "tab-A")).status).toBe(200);
    await new Promise((r) => setTimeout(r, 15));
    const stop = await aact(a.cookie, "stop-test", { id: s.testId, note: "Spam", since }, "tab-B");
    expectStop(stop, "Stop (close)", [new RegExp(`^${esc(b.user.email)} paused the test at ${T}\\.$`), you("extended this test's closing date")]);
    const noTab = await aact(a.cookie, "stop-test", { id: s.testId, note: "Spam", since });
    expectStop(noTab, "Stop (close)", [new RegExp(`^${esc(b.user.email)} paused the test at ${T}\\.$`)]);
    refused(await aact(a.cookie, "pause-test", { id: s.testId, note: "Again", since }, "tab-B"), new RegExp(`^That test was already paused \\(by ${esc(b.user.email)} at ${T}\\)\\.$`));
  });
});

describe("batch 35 §44 and §47: the needs pop-up", () => {
  it("names where a change came from: the tester's own profile, the developer's needs, or both", () => {
    const clock = (iso: string) => (iso.endsWith("T03:20:00.000Z") ? "3:20 AM" : "3:21 AM");
    const open = "2026-10-31T03:00:00.000Z";
    expect(gapSources({ profileAt: open, needsAt: open }, { profileAt: "2026-10-31T02:00:00.000Z", needsAt: "2026-10-31T01:00:00.000Z" })).toEqual({});
    const prof = gapSources({ profileAt: open, needsAt: open }, { profileAt: "2026-10-31T03:20:00.000Z", needsAt: "2026-10-31T01:00:00.000Z" });
    expect(prof).toEqual({ profileAt: "2026-10-31T03:20:00.000Z" });
    expect(profileUpdatedLabel("3:20 AM")).toBe("You updated your profile in another tab (3:20 AM):");
    expect(needsChangedLabel("Nora Lane", "3:20 AM")).toBe("Nora Lane changed what this test needs (3:20 AM):");
    expect(updateLabels(prof, "Nora Lane", clock, open)).toEqual(["You updated your profile in another tab (3:20 AM):"]);
    const both = gapSources({ profileAt: open, needsAt: open }, { profileAt: "2026-10-31T03:20:00.000Z", needsAt: "2026-10-31T03:21:00.000Z" });
    expect(updateLabels(both, "Nora Lane", clock, open)).toEqual(["You updated your profile in another tab (3:20 AM):", "Nora Lane changed what this test needs (3:21 AM):"]);
    expect(coveredLine(prof, "Nora Lane", clock, open, "join")).toBe("You updated your profile in another tab (3:20 AM): you now meet this test's needs. Press Join to join.");
    expect(coveredLine({ needsAt: "2026-10-31T03:20:00.000Z" }, "Nora Lane", clock, open, "apply")).toBe("Nora Lane changed what this test needs (3:20 AM): you now meet this test's needs. Press Apply to apply.");
  });

  it("one-or-none per kind: a second item within a kind is no news; a kind that flips is", () => {
    expect(sameGaps({ languages: ["Spanish"], devices: [] }, { languages: ["Spanish", "French"], devices: [] })).toBe(true);
    expect(sameGaps({ languages: ["Spanish"], devices: [] }, { languages: [], devices: [] })).toBe(false);
    expect(gapsUnseen({ languages: ["Spanish", "French"], devices: ["Mac"] }, { languages: ["Spanish"], devices: ["Mac"] })).toBe(false);
    expect(gapsUnseen({ languages: ["Spanish"], devices: ["Mac"] }, { languages: ["Spanish"], devices: [] })).toBe(true);
  });

  it("the server agrees: Join anyway goes ahead when the shown kinds are still the missing ones (items aside); a newly missing kind stops it", async () => {
    const { testId } = await setup({ devices: ["Mac"], languages: ["Spanish", "French"] });
    const ben = await makeUser({ tester: true });
    const first = await act(testId, "join", ben.cookie, {});
    expect(first.body.error).toMatchObject({ code: "needs", gaps: { languages: ["Spanish", "French"], devices: ["Mac"] } });
    expect(typeof first.body.error.now).toBe("string"); // the pop-up's open time
    const stale = await act(testId, "join", ben.cookie, { anyway: true, gapsShown: { languages: ["Spanish"], devices: [] } });
    expect(stale.body.error).toMatchObject({ code: "needs", changed: true });
    expect((await act(testId, "join", ben.cookie, { anyway: true, gapsShown: { languages: ["Spanish"], devices: ["Mac"] } })).status).toBe(200);
  });

  it("listing one needed item covers its kind; my-gaps says when the profile was saved", async () => {
    const { testId } = await setup({ languages: ["Spanish", "English"] });
    const ben = await makeUser({ tester: true }); // lists English
    const g = await act(testId, "my-gaps", ben.cookie, {});
    expect(g.body.gaps).toEqual({ languages: [], devices: [] });
    const p = await db.testerProfile.findUniqueOrThrow({ where: { userId: ben.user.id } });
    expect(g.body.profileAt).toBe(p.updatedAt.toISOString());
    expect(typeof g.body.now).toBe("string");
  });

  it("the pop-up and the page use the labels (source)", () => {
    const dialog = src("components/GapDialog.tsx");
    expect(dialog).toContain("const from = gapSources(times.current, now);");
    expect(dialog).toContain("if (sameGaps(r.gaps, shownRef.current)) {");
    expect(dialog).toContain("<UpdatedLabels at={changedAt} from={changedFrom} devName={p.devName} />");
    const box = src("app/app/find/[id]/JoinBox.tsx");
    expect(box).toContain("gapSources({ profileAt: seenAt, needsAt: seenAt }, { profileAt: now.profileAt, needsAt: now.needsSaveAt })");
    expect(box).toContain("<UpdatedLabels at={covered.at} from={covered.from} devName={p.devName} />");
  });
});

describe("batch 35 §48: Withdraw names why there's nothing to withdraw", () => {
  async function applied() {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ben = await makeUser({ tester: true, name: "Ben Ito" });
    expect((await act(testId, "apply", ben.cookie, { note: "Hi" })).status).toBe(200);
    return { dev, testId, ben };
  }
  const at = (m: string) => new RegExp(m.replace("<T>", T));

  it("accepted, declined, withdrawn in another tab, closed by a listing change; never applied keeps the plain line", async () => {
    const a = await applied();
    await db.application.updateMany({ where: { testId: a.testId }, data: { status: "accepted", decidedAt: new Date() } });
    expect((await act(a.testId, "withdraw-application", a.ben.cookie, {})).body.error.message).toMatch(at("^Nora Lane accepted your application at <T>, so you're in this test\\.$"));
    await db.application.updateMany({ where: { testId: a.testId }, data: { status: "declined" } });
    expect((await act(a.testId, "withdraw-application", a.ben.cookie, {})).body.error.message).toMatch(at("^Nora Lane declined your application at <T>\\.$"));
    await db.application.updateMany({ where: { testId: a.testId }, data: { status: "closed", closedReason: "listing" } });
    expect((await act(a.testId, "withdraw-application", a.ben.cookie, {})).body.error.message).toMatch(at("^It closed when Nora Lane changed the listing at <T>\\. You can apply again\\.$"));
    const b = await applied();
    expect((await act(b.testId, "withdraw-application", b.ben.cookie, {})).status).toBe(200);
    expect((await act(b.testId, "withdraw-application", b.ben.cookie, {})).body.error.message).toMatch(at("^You withdrew it in another tab at <T>\\.$"));
    const c = await setup({ joinMode: "apply" });
    const never = await makeUser({ tester: true });
    expect((await act(c.testId, "withdraw-application", never.cookie, {})).body.error.message).toBe(NO_PENDING_APPLICATION);
  });
});

describe("batch 35 §43: admin reasons in the quoted box", () => {
  it("a reason segment renders in the small quoted box (and reads in quotes as plain text)", () => {
    const parts = ["Ana Silva's reason:", quoted("averyveryverylongunbrokenword".repeat(20))];
    const html = renderToStaticMarkup(createElement(AdminRich, { parts }));
    expect(html).toContain("<blockquote");
    expect(html).toContain("data-reason");
    expect(plainOf(["Reported by Ben:", quoted("Rude in chat")])).toBe("Reported by Ben: “Rude in chat”");
    expect(withoutNote("Oct 28, 3:10 PM by a@playtest.test · “Fraud”", "Fraud", "suspended")).toBe("Oct 28, 3:10 PM by a@playtest.test");
    expect(withoutNote("Deleted Oct 28, 3:10 PM by a@playtest.test: Asked", "Asked", "deleted")).toBe("Deleted Oct 28, 3:10 PM by a@playtest.test");
  });

  it("long unbroken words wrap; every admin reason uses the quoted box; Contact us keeps its 8-line ScrollText", () => {
    const st = src("components/ScrollText.tsx");
    expect(st.match(/\[overflow-wrap:anywhere\]/g)?.length).toBe(2);
    expect(src("app/admin/DisputeDecision.tsx")).toContain(":<ReasonQuote text={side.text} className=\"mt-0.5\" /></div>");
    const list = src("app/admin/PagedList.tsx");
    expect(list).toContain("<ReasonQuote text={r.note} className=\"text-slate-300\" />");
    expect(list).toContain("Developer&apos;s side:<ReasonQuote text={d.devSide} className=\"mt-0.5\" />");
    expect(list).toContain("{d.decisionNote && <ReasonQuote text={d.decisionNote} className=\"mt-0.5\" />}");
    expect(list).toContain("{t.em && <ReasonQuote text={t.em} className=\"mt-0.5\" />}");
    expect(list).toContain("<ScrollText text={m.message} lines={8} className=\"text-slate-300\" />");
    expect(list).not.toMatch(/“\{r\.note\}”|“\{d\.devSide\}”/);
    const lists = src("lib/server/adminLists.ts");
    expect(lists).toContain("`'s reason:`, quoted(d.reason)");
    expect(lists).toContain("\":\", quoted(r.note)");
    expect(lists).toContain("quoted(x.noShowNote ?? \"\")");
    expect(lists).not.toMatch(/: “\$\{(d\.reason|r\.note|c\.noShowNote|x\.noShowNote|d\.decisionNote)\}”/);
    const acct = src("app/admin/AccountActions.tsx");
    expect(acct).toContain("<ReasonQuote text={acct.notes[s]} className=\"basis-full text-sm\" />");
    expect(src("app/admin/AdminRich.tsx")).toContain("<ReasonQuote key={i} text={s.q}");
  });

  it("the team's pause / stop reasons and a close-out's reason end the timeline line in the quoted box", async () => {
    const a = await admin();
    const s = await setup();
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking reports" }, "tab-A")).status).toBe(200);
    const { adminPage } = await import("@/lib/server/adminLists");
    const page = await adminPage("t-timeline", a.user.id, null, s.testId);
    const row = (page.rows as { text: string; parts?: unknown[] }[]).find((r) => r.text.includes("paused this test"))!;
    expect(row.text).toMatch(/paused this test: “Checking reports”$/);
    expect(row.parts!.some((p) => typeof p === "object" && p !== null && "q" in p && (p as { q: string }).q === "Checking reports")).toBe(true);
  });
});

describe("batch 35 §46: Invite's found rows with the redraw", () => {
  it("a search asked again for the page's redraw goes at once (no typing pause)", () => {
    const panel = src("app/app/tests/[id]/InvitePanel.tsx");
    expect(panel).toContain("forRedraw.current = true;");
    expect(panel).toMatch(/if \(redraw\) \{\s+ask\(\); \/\/ \(batch 35 §46\) at once, with the redraw\s+return;\s+\}/);
    expect(panel).toContain("const t = setTimeout(ask, SEARCH_PAUSE);");
  });
});
