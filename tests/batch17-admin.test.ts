import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { GET as moreGET } from "@/app/api/admin/more/route";
import { adminPage, type Page } from "@/lib/server/adminLists";
import { ACCOUNT_DELETED, changedSinceLine, deletedSinceLine } from "@/lib/server/restrictions";
import { LOADING_LINE, SEARCHABLE, TEST_TICKS, USER_TICKS, endLine, headingText, mergeTop, nearEnd, newRowsAhead, newRowsPill, searchOf, ticksOf } from "@/lib/adminScroll";
import { json, makeUser, req } from "./helpers";

// Batch 17 §5 (admin search on Accounts and Tests), §6 (Suspend / Reinstate / Delete on a profile's admin view, with the Preview check) and §7 (every admin list is
// a scroll box that loads as you scroll).

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);
const more = (cookie: string, qs: string) => moreGET(req(`/api/admin/more?${qs}`, { cookie })).then(json);
const tick = () => new Promise((r) => setTimeout(r, 15));
type Row = { id: string; at: string };

describe("§5 admin search: Accounts", () => {
  it("name or email, any part, case-insensitive, over every account (server-side); ticks narrow it; clearing brings the full list back", async () => {
    const a = await admin();
    const tag = `zq${randomUUID().slice(0, 6)}`;
    const dev = await makeUser({ dev: true, name: `Nora ${tag.toUpperCase()}` });
    const tester = await makeUser({ tester: true, email: `ana-${tag}@test.playtest.test` });
    const both = await makeUser({ dev: true, tester: true, email: `both-${tag}@test.playtest.test` });
    const gone = await makeUser({ tester: true, email: `gone-${tag}@test.playtest.test` });
    await db.user.update({ where: { id: gone.user.id }, data: { deletedAt: new Date(), deletedBy: "self" } });
    await db.user.update({ where: { id: dev.user.id }, data: { holdStartedAt: new Date(), holdReason: "failed" } });
    await db.user.update({ where: { id: both.user.id }, data: { testerSuspendedAt: new Date() } });
    const ids = (p: Page<unknown>) => (p.rows as Row[]).map((r) => r.id).sort();
    const sorted = (...xs: string[]) => xs.sort();
    // Any part, any case: the name (upper case stored, lower case typed) and the email.
    const all = await adminPage("users", a.user.id, null, "", { q: tag });
    expect(ids(all)).toEqual(sorted(dev.user.id, tester.user.id, both.user.id, gone.user.id));
    expect(all.total).toBe(4);
    expect(ids(await adminPage("users", a.user.id, null, "", { q: tag.toUpperCase().slice(1, 6) }))).toEqual(ids(all));
    // Ticks: roles match ANY ticked role; states match ANY ticked state; the two groups both apply.
    expect(ids(await adminPage("users", a.user.id, null, "", { q: tag, ticks: ["developer"] }))).toEqual(sorted(dev.user.id, both.user.id));
    expect(ids(await adminPage("users", a.user.id, null, "", { q: tag, ticks: ["tester"] }))).toEqual(sorted(tester.user.id, both.user.id, gone.user.id));
    expect(ids(await adminPage("users", a.user.id, null, "", { q: tag, ticks: ["suspended"] }))).toEqual([both.user.id]);
    expect(ids(await adminPage("users", a.user.id, null, "", { q: tag, ticks: ["hold"] }))).toEqual([dev.user.id]);
    expect(ids(await adminPage("users", a.user.id, null, "", { q: tag, ticks: ["deleted"] }))).toEqual([gone.user.id]);
    expect(ids(await adminPage("users", a.user.id, null, "", { q: tag, ticks: ["suspended", "hold"] }))).toEqual(sorted(dev.user.id, both.user.id));
    expect(ids(await adminPage("users", a.user.id, null, "", { q: tag, ticks: ["tester", "deleted"] }))).toEqual([gone.user.id]);
    // Through the route (what the box asks for): q and f; an unknown tick is dropped; only admins.
    const r = await more(a.cookie, `kind=users&after=&q=${encodeURIComponent(tag.toUpperCase())}&f=developer,nonsense`);
    expect(r.status).toBe(200);
    expect((r.body.rows as Row[]).map((x) => x.id).sort()).toEqual(sorted(dev.user.id, both.user.id));
    expect(r.body.total).toBe(2);
    expect((await more(tester.cookie, `kind=users&q=${tag}`)).status).toBe(403);
    // Cleared: the full list again (every account).
    const full = await more(a.cookie, "kind=users&after=&q=");
    expect(full.body.total).toBe(await db.user.count());
    // Each row carries its account state for Suspend / Reinstate / Delete.
    const row = (all.rows as { id: string; acct: { suspended: { tester: string }; deleted: string } }[]).find((x) => x.id === both.user.id)!;
    expect(row.acct.suspended.tester).not.toBe("");
    expect((all.rows as { id: string; acct: { deleted: string } }[]).find((x) => x.id === gone.user.id)!.acct.deleted).toMatch(/^Deleted .* by the owner of the account/);
  });

  it("the tick boxes and the shared wording", () => {
    expect(USER_TICKS.map((t) => t.label)).toEqual(["Developer", "Tester", "Suspended", "On a hold", "Deleted"]);
    expect(TEST_TICKS.map((t) => t.label)).toEqual(["Open", "Joining closed", "Paused", "Stopped / closed", "Draft"]);
    expect(ticksOf("users", "developer,deleted,open,,developer")).toEqual(["developer", "deleted"]);
    expect(ticksOf("tests", "open,draft,hold")).toEqual(["open", "draft"]);
    expect(ticksOf("payments", "open")).toEqual([]);
    expect(searchOf("  a".padEnd(400, "x")).length).toBe(200);
    expect(SEARCHABLE.users.none).toBe("No accounts match.");
    expect(SEARCHABLE.tests.none).toBe("No tests match.");
  });
});

describe("§5 admin search: Tests", () => {
  it("test name, product name or developer name/email, any part; ticks Open, Joining closed, Paused, Stopped / closed, Draft", async () => {
    const a = await admin();
    const tag = `tq${randomUUID().slice(0, 6)}`;
    const dev = await makeUser({ dev: true, name: `Dev ${tag}` });
    const other = await makeUser({ dev: true, email: `other-${tag}@test.playtest.test` });
    const mk = (developerId: string, data: Record<string, unknown>) =>
      db.test.create({ data: { developerId, title: "A test", spots: 3, deadlineDays: 7, devices: [], languages: [], ...data } });
    const open = await mk(other.user.id, { title: `Open ${tag.toUpperCase()}` });
    const product = await mk(other.user.id, { productName: `Game ${tag}`, status: "closed" });
    const late = await mk(dev.user.id, { openUntil: new Date(Date.now() - 86_400_000) });
    const paused = await mk(dev.user.id, { pausedSince: new Date(), adminPausedAt: new Date() });
    const stopped = await mk(dev.user.id, { status: "stopped", stoppedAt: new Date() });
    const draft = await mk(dev.user.id, { status: "draft" });
    const ids = async (ticks: string[], q = tag) => ((await adminPage("tests", a.user.id, null, "", { q, ticks })).rows as Row[]).map((r) => r.id).sort();
    const sorted = (...xs: { id: string }[]) => xs.map((x) => x.id).sort();
    expect(await ids([])).toEqual(sorted(open, product, late, paused, stopped, draft)); // the developer's name and email match their tests
    expect(await ids([], `other-${tag}`)).toEqual(sorted(open, product));
    expect(await ids([], `game ${tag}`.toUpperCase())).toEqual(sorted(product));
    expect(await ids(["open"])).toEqual(sorted(open));
    expect(await ids(["joining-closed"])).toEqual(sorted(product, late));
    expect(await ids(["paused"])).toEqual(sorted(paused));
    expect(await ids(["stopped"])).toEqual(sorted(stopped));
    expect(await ids(["draft"])).toEqual(sorted(draft));
    expect(await ids(["open", "draft"])).toEqual(sorted(open, draft));
    const r = await more(a.cookie, `kind=tests&after=&q=${tag}&f=paused,stopped`);
    expect(r.body.total).toBe(2);
  });
});

describe("§7 the scroll box: load past 25, the end line, filters reset, the new-rows pill", () => {
  it("loads the next 25 after the last row (the existing cursors) until the end; the search applies to every next 25", async () => {
    const a = await admin();
    const tag = `lp${randomUUID().slice(0, 6)}`;
    for (let i = 0; i < 30; i++) await db.user.create({ data: { email: `p${i}-${tag}@test.playtest.test`, createdAt: new Date(Date.now() - i * 1000) } });
    const p1 = await more(a.cookie, `kind=users&after=&q=${tag}`);
    expect(p1.body.rows).toHaveLength(25);
    expect(p1.body.total).toBe(30);
    expect(p1.body.next).toBeTruthy();
    const p2 = await more(a.cookie, `kind=users&after=${encodeURIComponent(p1.body.next)}&q=${tag}`);
    expect(p2.body.rows).toHaveLength(5);
    expect(p2.body.next).toBeNull(); // the end: "That's all (30)"
    const seen = new Set([...p1.body.rows, ...p2.body.rows].map((r: Row) => r.id));
    expect(seen.size).toBe(30);
    expect(endLine(p2.body.total)).toBe("That's all (30)");
    // A filter change asks for the first 25 again (no cursor): the box starts at its top.
    const ticked = await more(a.cookie, `kind=users&after=&q=${tag}&f=tester`);
    expect(ticked.body.total).toBe(0);
    expect(ticked.body.next).toBeNull();
  });

  it("the heading, the Loading row, the end line and the pill", () => {
    expect(headingText("Accounts", 1204, false)).toBe("Accounts (1,204)");
    expect(headingText("Accounts", 12, true)).toBe("Accounts: 12 match");
    expect(headingText("Tests", 0, true)).toBe("Tests: 0 match");
    expect(LOADING_LINE).toBe("Loading…");
    expect(endLine(1204)).toBe("That's all (1,204)");
    expect(newRowsPill(3)).toBe("3 new ↑");
    expect(nearEnd({ scrollTop: 0, clientHeight: 368, scrollHeight: 2000 })).toBe(false);
    expect(nearEnd({ scrollTop: 1500, clientHeight: 368, scrollHeight: 2000 })).toBe(true);
  });

  it("new rows: only those ahead of every row shown; the pill shows them on top; more than a page starts the box over", () => {
    const r = (id: string) => ({ id });
    const shown = ["c", "d", "e"].map(r);
    expect(newRowsAhead(["a", "b", "c", "d"].map(r), shown).map((x) => x.id)).toEqual(["a", "b"]);
    expect(newRowsAhead(["c", "d"].map(r), shown)).toEqual([]);
    expect(newRowsPill(newRowsAhead(["x", "y", "z", "c"].map(r), shown).length)).toBe("3 new ↑");
    // Taking them in keeps every row already loaded (scrolled-down rows don't move until the pill is pressed).
    expect(mergeTop(["a", "b", "c", "d"].map(r), shown)).toEqual({ rows: ["a", "b", "c", "d", "e"].map(r), replaced: false, added: 2 });
    // None of the fresh rows shown yet (over 25 arrived, or the list was empty): the box starts over from the fresh first 25.
    expect(mergeTop(["x", "y"].map(r), shown)).toEqual({ rows: ["x", "y"].map(r), replaced: true, added: 2 });
    expect(mergeTop([], shown)).toEqual({ rows: shown, replaced: false, added: 0 });
  });

  it("every admin list (console, profile boxes, test page boxes) is the scroll box: no Previous / Next, no '1–25 of N'", () => {
    const list = src("app/admin/PagedList.tsx");
    expect(list).not.toMatch(/>Previous<|>Next<|of \$\{total\}|data-pager/);
    expect(list).toContain("onScroll");
    expect(list).toContain("nearEnd(b)");
    expect(list).toContain("{LOADING_LINE}");
    expect(list).toContain("{endLine(total)}");
    expect(list).toContain("{newRowsPill(fresh)}");
    expect(list).toContain("max-h-[23rem] w-full overflow-y-auto"); // about 10 rows; full width on phones
    expect(list).toMatch(/setApplied\(f\);[\s\S]*scrollTop = 0/); // a search or a tick resets the box to its top
    expect(list).toContain("SEARCH_PAUSE_MS"); // after a short pause
    const page = src("app/admin/page.tsx");
    expect(page).not.toMatch(/\.total\}\)<\/h2>/);
    for (const t of ["Accounts", "Tests", "Open disputes", "Lifts", "Chargeback holds", "Your actions", "Paused tests", "Decided disputes", "Contact us", "Reports", "No-show reports", "Latest payments"]) expect(page, t).toContain(`title="${t}"`);
    const boxes = src("app/admin/AdminBoxes.tsx");
    expect(boxes).toContain("title={title} level={3}");
    expect(boxes).not.toMatch(/\(\{page\.total\}\)/);
  });
});

describe("§6 Suspend / Reinstate / Delete on a profile's admin view, with the Preview check", () => {
  it("the profile's admin view has the same component as the Accounts list", () => {
    expect(src("app/admin/AdminBoxes.tsx")).toContain("<AccountActions initial={acct} />");
    expect(src("app/admin/PagedList.tsx")).toContain("<AccountActions initial={u.acct} />");
    const c = src("app/admin/AccountActions.tsx");
    for (const s of ['action="suspend"', 'action="unsuspend"', 'action="delete-account"', "<PreviewButton", "onRefused={refused}", "since: previewAt ?? acct.at"]) expect(c, s).toContain(s);
  });

  it("two admins racing Suspend on the same side: one goes through, the other is refused by name, with the account's state now", async () => {
    const dev = await makeUser({ dev: true });
    const a = await admin(), b = await admin();
    const since = new Date().toISOString();
    const [x, y] = await Promise.all([
      aact(a.cookie, "suspend", { id: dev.user.id, note: "First", since, from: "page" }),
      aact(b.cookie, "suspend", { id: dev.user.id, note: "Second", since, from: "page" }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const lost = x.status === 409 ? x : y;
    const winner = x.status === 200 ? a : b;
    expect(lost.body.error.message).toMatch(new RegExp(`^(That account's developer side is already suspended \\(by ${winner.user.email}\\)\\.|Since this page loaded, ${winner.user.email} suspended that account's developer side at .+\\.)$`));
    expect(lost.body.error.account.suspended.developer).toContain(`by ${winner.user.email}`);
    expect(await db.accountEvent.count({ where: { userId: dev.user.id, kind: "suspended" } })).toBe(1);
  });

  it("suspend then reinstate behind a page: Reinstate from a page older than a new suspension is refused naming who and when (it never lifts the new one)", async () => {
    const dev = await makeUser({ dev: true });
    const a = await admin(), b = await admin(), c = await admin();
    expect((await aact(a.cookie, "suspend", { id: dev.user.id, note: "First" })).status).toBe(200);
    const pageAt = new Date().toISOString(); // B's and C's pages show the side suspended
    await tick();
    expect((await aact(b.cookie, "unsuspend", { id: dev.user.id, side: "developer", since: pageAt, from: "page" })).status).toBe(200);
    await tick();
    expect((await aact(a.cookie, "suspend", { id: dev.user.id, note: "Again" })).status).toBe(200);
    const late = await aact(c.cookie, "unsuspend", { id: dev.user.id, side: "developer", since: pageAt, from: "page" });
    expect(late.status).toBe(409);
    const now = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    expect(late.body.error.message).toBe(changedSinceLine("page", a.user.email, "suspended", "developer", now.devSuspendedAt!));
    expect(late.body.error.message).toMatch(/^Since this page loaded, .+ suspended that account's developer side at .+\.$/);
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.user.id } })).devSuspendedAt).not.toBeNull(); // still suspended
    // The refusal carries the state now; pressing again from it goes through.
    expect((await aact(c.cookie, "unsuspend", { id: dev.user.id, side: "developer", since: late.body.error.account.at, from: "page" })).status).toBe(200);
  });

  it("two admins racing Suspend and Reinstate: the Reinstate behind the page is refused, and a Reinstate already done names who", async () => {
    const dev = await makeUser({ dev: true });
    const a = await admin(), b = await admin();
    expect((await aact(a.cookie, "suspend", { id: dev.user.id, note: "Why" })).status).toBe(200);
    const since = new Date().toISOString();
    const [x, y] = await Promise.all([
      aact(a.cookie, "unsuspend", { id: dev.user.id, side: "developer", since, from: "page" }),
      aact(b.cookie, "unsuspend", { id: dev.user.id, side: "developer", since, from: "page" }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const lost = x.status === 409 ? x : y;
    const winner = x.status === 200 ? a : b;
    expect(lost.body.error.message).toMatch(new RegExp(`^(That account's developer side was already reinstated \\(by ${winner.user.email}\\)\\.|Since this page loaded, ${winner.user.email} reinstated that account's developer side at .+\\.)$`));
    expect(lost.body.error.account.suspended.developer).toBe("");
    // A Suspend sent with a Preview from before the reinstatement: refused, naming it.
    const loser = winner === a ? b : a;
    const sus = await aact(loser.cookie, "suspend", { id: dev.user.id, note: "Back", since, from: "preview" });
    expect(sus.status).toBe(409);
    expect(sus.body.error.message).toMatch(new RegExp(`^Since your Preview, ${winner.user.email} reinstated that account's developer side at .+\\.$`));
  });

  it("a stale Preview: another admin's change after the Preview refuses Suspend, naming who and when; the admin's own changes don't", async () => {
    const t = await makeUser({ tester: true });
    const a = await admin(), b = await admin();
    const pv = await aact(a.cookie, "preview-suspension", { id: t.user.id });
    expect(pv.status).toBe(200);
    expect(typeof pv.body.at).toBe("string");
    expect(pv.body.lines.length).toBeGreaterThan(0);
    await tick();
    expect((await aact(b.cookie, "suspend", { id: t.user.id, note: "Checking" })).status).toBe(200);
    expect((await aact(b.cookie, "unsuspend", { id: t.user.id })).status).toBe(200);
    const r = await aact(a.cookie, "suspend", { id: t.user.id, note: "My reason", since: pv.body.at, from: "preview" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("changed_since");
    const back = await db.user.findUniqueOrThrow({ where: { id: t.user.id } });
    expect(r.body.error.message).toBe(changedSinceLine("preview", b.user.email, "reinstated", "tester", back.testerReinstatedAt!));
    expect(r.body.error.message.startsWith(`Since your Preview, ${b.user.email} reinstated that account's tester side at `)).toBe(true);
    expect(r.body.error.account).toMatchObject({ id: t.user.id, suspended: { developer: "", tester: "" }, deleted: "" });
    expect(back.testerSuspendedAt).toBeNull(); // nothing happened
    // A fresh Preview: goes through.
    const pv2 = await aact(a.cookie, "preview-suspension", { id: t.user.id });
    expect((await aact(a.cookie, "suspend", { id: t.user.id, note: "My reason", since: pv2.body.at, from: "preview" })).status).toBe(200);
    // The admin's own change since their page doesn't stop their own next press.
    expect((await aact(a.cookie, "unsuspend", { id: t.user.id, since: pv2.body.at, from: "page" })).status).toBe(200);
  });

  it("suspend vs delete: delete wins ('That account was deleted.'), naming who and when for a press made before it", async () => {
    const dev = await makeUser({ dev: true });
    const a = await admin(), b = await admin();
    const since = new Date().toISOString();
    await tick();
    expect((await aact(b.cookie, "delete-account", { id: dev.user.id, note: "Fraud" })).status).toBe(200);
    const r = await aact(a.cookie, "suspend", { id: dev.user.id, note: "Late", since, from: "page" });
    expect(r.status).toBe(409);
    const u = await db.user.findUniqueOrThrow({ where: { id: dev.user.id } });
    expect(r.body.error.message).toBe(deletedSinceLine(b.user.email, u.deletedAt!));
    expect(r.body.error.message.startsWith(`${ACCOUNT_DELETED} ${b.user.email} deleted it at `)).toBe(true);
    expect(r.body.error.account.deleted).toMatch(new RegExp(`^Deleted .* by ${b.user.email.replace(/[.+]/g, "\\$&")}: Fraud$`));
    expect(u.devSuspendedAt).toBeNull();
    // Without a view time (an old client): the plain line. Reinstate is refused the same way.
    expect((await aact(a.cookie, "suspend", { id: dev.user.id, note: "Late" })).body.error.message).toBe("That account was deleted.");
    expect((await aact(a.cookie, "unsuspend", { id: dev.user.id })).body.error.message).toBe("That account was deleted.");
    // At the same moment: the account ends up deleted; the Suspend either landed first or is refused with the delete line.
    const d2 = await makeUser({ dev: true });
    const s2 = new Date().toISOString();
    const [del, sus] = await Promise.all([aact(b.cookie, "delete-account", { id: d2.user.id, note: "Fraud" }), aact(a.cookie, "suspend", { id: d2.user.id, note: "Same time", since: s2, from: "page" })]);
    expect(del.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: d2.user.id } })).deletedAt).not.toBeNull();
    if (sus.status !== 200) expect(sus.body.error.message.startsWith(ACCOUNT_DELETED)).toBe(true);
  });

  it("the old refusals stay as they were for presses without a view time", async () => {
    const both = await makeUser({ dev: true, tester: true });
    const a = await admin(), b = await admin();
    expect((await aact(a.cookie, "suspend", { id: both.user.id, note: "Chargebacks", side: "developer" })).status).toBe(200);
    expect((await aact(b.cookie, "suspend", { id: both.user.id, note: "Me too", side: "developer" })).body.error.message).toBe(`That account's developer side is already suspended (by ${a.user.email}).`);
    expect((await aact(a.cookie, "unsuspend", { id: both.user.id, side: "developer" })).status).toBe(200);
    expect((await aact(b.cookie, "unsuspend", { id: both.user.id, side: "developer" })).body.error.message).toBe(`That account's developer side was already reinstated (by ${a.user.email}).`);
  });
});
