import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { startHold } from "@/lib/server/holds";
import { findTests } from "@/lib/server/tests";
import { adminFindTests } from "@/lib/server/findSearch";
import { FIND_SEARCH_LABEL, noFindMatchLine, statesFrom, testState } from "@/lib/findSearch";
import { profileOpenTests, profileTestRefusal, TEST_NOT_AVAILABLE } from "@/lib/server/profileOpenTests";
import { pressLabelOf } from "@/lib/pressLabels";
import { POST as invitePOST } from "@/app/api/invites/[id]/route";
import { POST as testsPOST } from "@/app/api/tests/route";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { json, makeUser, req, uniq } from "./helpers";
import { act, atHours, joined, listingBody, sact, seen, settle, setup } from "./fixtures";

// Batch 17 sections 4, 8, 9 and 13.
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const later = () => new Promise((r) => setTimeout(r, 30));
const noThanks = (id: string, cookie: string, body: Record<string, unknown> = {}) => invitePOST(req(`/api/invites/${id}`, { cookie, body }), { params: Promise.resolve({ id }) }).then(json);
const texts = (r: { body: { error?: { code?: string; changes?: { text: string }[] } } }) => (r.body.error?.code === "stop_once" ? r.body.error.changes!.map((c) => c.text) : []);
const pulse = async (cookie: string, q: string) => (await json(await pulseGET(req(`/api/pulse?${q}`, { cookie, method: "GET" })))).body.v as string;

async function invited(over: Record<string, unknown> = {}) {
  const s = await setup(over);
  const ana = await makeUser({ tester: true, name: "Ana Silva" });
  expect((await act(s.testId, "invite", s.dev.cookie, { testerIds: [ana.user.id], seenAt: seen(), confirmed: true })).body.message).toBe("Invited Ana Silva.");
  const inv = await db.invite.findFirstOrThrow({ where: { testId: s.testId, testerId: ana.user.id, status: "sent" } });
  await later();
  return { ...s, ana, inv, loaded: seen() };
}

describe("No thanks on an invite follows batch 16 section 32 (section 4)", () => {
  it("a full test keeps the invite open: No thanks just declines it (no stop for the test filling)", async () => {
    const x = await invited({ spots: 1 });
    await joined(x.testId, "Ben Okafor");
    expect((await db.invite.findUniqueOrThrow({ where: { id: x.inv.id } })).status).toBe("sent");
    const r = await noThanks(x.inv.id, x.ana.cookie, { seenAt: x.loaded });
    expect(r.status).toBe(200);
    expect((await db.invite.findUniqueOrThrow({ where: { id: x.inv.id } })).status).toBe("declined");
  });

  it("closed invites are refused with the section 32 reason (never hold), and the card goes", async () => {
    const held = await invited();
    await startHold(held.dev.user.id, "unpaid");
    const r1 = await noThanks(held.inv.id, held.ana.cookie, { seenAt: held.loaded });
    expect(r1.body.error).toMatchObject({ code: "invite_closed", message: "“Harbor Run” isn't taking new testers right now, so this invite was closed." });
    expect(await db.invite.count({ where: { testerId: held.ana.user.id, status: "sent" } })).toBe(0);

    const stopped = await invited();
    expect((await act(stopped.testId, "stop", stopped.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await noThanks(stopped.inv.id, stopped.ana.cookie)).body.error).toMatchObject({ code: "invite_closed", message: "This test was stopped." });

    const ou = await invited();
    const until = new Date(Date.now() - 60_000);
    await db.test.update({ where: { id: ou.testId }, data: { openUntil: until } });
    await (await import("@/lib/server/tests")).closeJoiningAfterOpenUntil();
    expect((await noThanks(ou.inv.id, ou.ana.cookie)).body.error).toMatchObject({ code: "invite_closed", message: `“Harbor Run” closed to new testers on ${fmtDate(until)}.` });

    // Already answered in another tab: the plain section 32 line (no "This invite is closed.").
    const twice = await invited();
    expect((await noThanks(twice.inv.id, twice.ana.cookie)).status).toBe(200);
    expect((await noThanks(twice.inv.id, twice.ana.cookie)).body.error).toMatchObject({ code: "invite_closed", message: "This invite is no longer open." });
    const route = src("app/api/invites/[id]/route.ts");
    expect(route).not.toContain("This invite closed: the test filled up.");
    expect(route).not.toContain("This invite is closed.");
  });

  it("an invite re-sent on a new listing stops once (blue) with the new listing; the second press declines the new invite", async () => {
    const x = await invited();
    const v = (await db.test.findUniqueOrThrow({ where: { id: x.testId } })).version;
    expect((await act(x.testId, "edit", x.dev.cookie, { version: v, fields: { writtenCents: "12.00" }, seenAt: seen(), confirmed: true })).status).toBe(200);
    const fresh = await db.invite.findFirstOrThrow({ where: { testId: x.testId, testerId: x.ana.user.id, status: "sent" } });
    expect(fresh.id).not.toBe(x.inv.id);
    const r = await noThanks(x.inv.id, x.ana.cookie, { seenAt: x.loaded });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("stop_once");
    const lines = texts(r);
    expect(lines[0]).toBe("Nora Lane updated “Harbor Run”: your invite was sent again on the new listing");
    expect(lines[1]).toMatch(/^The new listing: .*\$9\.60/);
    expect(r.body.error.newInviteId).toBe(fresh.id);
    // The box's second press goes ahead on the new invite.
    const ok = await noThanks(x.inv.id, x.ana.cookie, { seenAt: x.loaded, confirmed: true, boxAt: r.body.error.now });
    expect(ok.status).toBe(200);
    expect((await db.invite.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("declined");
    expect(pressLabelOf(`/api/invites/${x.inv.id}`)).toBe("No thanks");
  });

  it("a replaced invite that wasn't sent again (the tester can't be invited now) is refused, not stopped", async () => {
    const x = await invited();
    await db.invite.update({ where: { id: x.inv.id }, data: { status: "replaced" } });
    expect((await noThanks(x.inv.id, x.ana.cookie)).body.error).toMatchObject({ code: "invite_closed", message: "This invite is no longer open." });
  });

  it("the bell line \"<tester> asked for a call\" opens the Live session's Call requests panel at that request", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await sact(sessionId, "request-time", tester.cookie, { startsAt: atHours(50), seenAt: seen(), confirmed: true })).status).toBe(200);
    const r = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId, fromSide: "tester" } });
    const n = await db.notification.findFirstOrThrow({ where: { userId: dev.user.id, groupKey: "callrequests" } });
    expect(n.text).toMatch(/^Ana Silva asked for a call: /);
    expect(n.link).toBe(`/app/tests/${testId}#req-${r.id}`);
    // The same highlight as the Needs you row: the panel's row id, opened by the page's hash jump.
    expect(src("components/CallRequestsPanel.tsx")).toContain("id={`req-${r.id}`}");
    expect(src("app/app/layout.tsx")).toContain("<HashJump />");
  });
});

describe("Find tests: the search box, for testers and admins (section 8)", () => {
  it("testers: test name, product name or developer name, any part, any case, on the server; the no-match line", async () => {
    const tag = uniq();
    const a = await setup({ title: `Reef ${tag} Dash` });
    const b = await setup({ productName: `Kelp${tag}Works` });
    const c = await setup();
    await db.user.update({ where: { id: c.dev.user.id }, data: { name: `Ola ${tag}Smith` } });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    const ids = async (q: string) => (await findTests(ana.user as never, q)).map((t) => t.id).sort();
    expect(await ids(tag.toUpperCase())).toEqual([a.testId, b.testId, c.testId].sort());
    expect(await ids(`reef ${tag}`)).toEqual([a.testId]);
    expect(await ids(`KELP${tag}`)).toEqual([b.testId]);
    expect(await ids(`ola ${tag}`)).toEqual([c.testId]);
    expect(await ids(`zz${tag}`)).toEqual([]);
    // The developer's email is not searched for testers.
    expect(await ids(c.dev.user.email)).toEqual([]);
    // Blank: the full list.
    expect((await ids("  ")).length).toBeGreaterThanOrEqual(3);
    // Only open tests a tester can join: a paused one is not found.
    await db.test.update({ where: { id: a.testId }, data: { adminPausedAt: new Date() } });
    expect(await ids(tag)).toEqual([b.testId, c.testId].sort());
    expect(noFindMatchLine(" har ")).toBe("No open tests match “har”.");
    expect(noFindMatchLine("har", true)).toBe("No tests match “har”.");
    // The box is at the top and works together with the chips and filters (they keep q; the filters' form sends it).
    const page = src("app/app/find/page.tsx");
    expect(FIND_SEARCH_LABEL).toBe("Search tests or developers");
    expect(page.indexOf("<FindSearch params={params} />")).toBeLessThan(page.indexOf("<CategoryChips"));
    expect(page).toContain('{typed && <input type="hidden" name="q" value={typed} />}');
    expect(page).toContain("findTests(u, typed)");
    expect(page).toContain("noFindMatchLine(typed, admin)");
  });

  it("admins: every test with its state (Open, Full, Joining closed, Paused, Stopped, Closed, Draft, Invite only), tick boxes, search by email too", async () => {
    const tag = uniq();
    const mk = async (state: string, over: Record<string, unknown> = {}) => (await setup({ title: `${state} ${tag}`, ...over })).testId;
    const open = await mk("open");
    const full = await mk("full", { spots: 1 });
    await joined(full);
    const closedJoin = await mk("joinclosed");
    await db.test.update({ where: { id: closedJoin }, data: { openUntil: new Date(Date.now() - 60_000) } });
    const paused = await mk("paused");
    await db.test.update({ where: { id: paused }, data: { adminPausedAt: new Date() } });
    const stoppedS = await setup({ title: `stopped ${tag}` });
    expect((await act(stoppedS.testId, "stop", stoppedS.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const closed = await mk("closed");
    await db.test.update({ where: { id: closed }, data: { status: "stopped", pauseClosedAt: new Date() } });
    const draft = await mk("draft");
    await db.test.update({ where: { id: draft }, data: { status: "draft" } });
    const inviteOnly = await mk("inviteonly");
    await db.test.update({ where: { id: inviteOnly }, data: { joinMode: "invite" } });

    const { tests } = await adminFindTests(tag);
    const stateOf = new Map(tests.map((t) => [t.id, t.state]));
    expect(Object.fromEntries([open, full, closedJoin, paused, stoppedS.testId, closed, draft, inviteOnly].map((id) => [id, stateOf.get(id)]))).toEqual({
      [open]: "Open", [full]: "Full", [closedJoin]: "Joining closed", [paused]: "Paused", [stoppedS.testId]: "Stopped", [closed]: "Closed", [draft]: "Draft", [inviteOnly]: "Invite only",
    });
    // Tick boxes: only those states.
    const ticked = statesFrom("paused,draft,joining-closed,nonsense");
    expect(ticked).toEqual(["Joining closed", "Paused", "Draft"]);
    expect((await adminFindTests(tag, ticked)).tests.map((t) => t.id).sort()).toEqual([closedJoin, paused, draft].sort());
    // The team finds a developer by email.
    expect((await adminFindTests(stoppedS.dev.user.email.toUpperCase())).tests.map((t) => t.id)).toEqual([stoppedS.testId]);
    // A tester's search never shows these states.
    const ana = await makeUser({ tester: true });
    expect((await findTests(ana.user as never, tag)).map((t) => t.id)).toEqual([open]);
    expect(testState({ status: "open", openUntil: null, joinMode: "anyone", spots: 3 }, { holdStartedAt: new Date() }, 0)).toBe("Paused");
  });

  it("admins reach it from the admin header; a card opens the test's page with the team's boxes; never Join / Apply", () => {
    expect(src("app/admin/page.tsx")).toContain('<Link href="/app/find" data-admin-find="">Find tests</Link>');
    const page = src("app/app/find/page.tsx");
    expect(page).toContain("if (!u.isTester && !admin) redirect(\"/app/profile\");");
    expect(page).toContain("<StateTicks params={params} ticked={ticked} />");
    expect(page).toContain("href={`/app/find/${t.id}`}");
    const listing = src("app/app/find/[id]/page.tsx");
    expect(listing).toContain('if (!t || (t.status === "draft" && !isAdmin(u))) notFound();');
    expect(listing).toContain("{isAdmin(u) && <AdminTestBoxes testId={t.id} adminId={u.id} />}");
    expect(listing).toContain("t.developerId === u.id || isAdmin(u) || !u.isTester || closed || blocked || ratedHere ? null : (");
  });
});

describe("developer profile's Open tests stays current (section 9)", () => {
  async function devWithTest(over: Record<string, unknown> = {}) {
    const s = await setup({ spots: 2, ...over });
    const devRow = () => db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    const ids = async () => (await profileOpenTests(await devRow(), ana.user, false)).map((t) => t.id);
    const v = () => pulse(ana.cookie, `profile=${s.dev.user.id}`);
    return { ...s, ana, ids, v };
  }

  it("a test that fills up, pauses, passes Open until or stops leaves the list on the page's poll; a newly open test appears", async () => {
    const x = await devWithTest();
    expect(await x.ids()).toEqual([x.testId]);
    let v = await x.v();
    // Fills up.
    await joined(x.testId, "Ben Okafor");
    expect(await x.v()).not.toBe(v); // a spot taken: the "N of M spots left" changes
    v = await x.v();
    await joined(x.testId, "Cam Reed");
    expect(await x.ids()).toEqual([]);
    expect(await x.v()).not.toBe(v);
    expect(await profileTestRefusal(x.testId, x.ana.user.id)).toBe("This test is full.");
    // A newly open test appears.
    v = await x.v();
    const r = await json(await testsPOST(req("/api/tests", { cookie: x.dev.cookie, body: listingBody({ title: "Sky Forge" }) })));
    expect(r.status).toBe(200);
    await settle();
    expect(await x.ids()).toEqual([r.body.id]);
    expect(await x.v()).not.toBe(v);

    const p = await devWithTest();
    await db.test.update({ where: { id: p.testId }, data: { adminPausedAt: new Date() } });
    expect(await p.ids()).toEqual([]);
    expect(await profileTestRefusal(p.testId, p.ana.user.id)).toBe(TEST_NOT_AVAILABLE);

    const h = await devWithTest();
    await startHold(h.dev.user.id, "unpaid");
    expect(await h.ids()).toEqual([]);
    expect(await profileTestRefusal(h.testId, h.ana.user.id)).toBe(TEST_NOT_AVAILABLE);

    const o = await devWithTest();
    const until = new Date(Date.now() - 60_000);
    const v0 = await o.v();
    await db.test.update({ where: { id: o.testId }, data: { openUntil: until } });
    expect(await o.ids()).toEqual([]);
    expect(await o.v()).not.toBe(v0);
    expect(await profileTestRefusal(o.testId, o.ana.user.id)).toBe(`This test closed to new testers on ${until.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}.`);

    const s = await devWithTest();
    expect((await act(s.testId, "stop", s.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await s.ids()).toEqual([]);
    expect(await profileTestRefusal(s.testId, s.ana.user.id)).toBe("This test was stopped.");
  });

  it("turning invite only for this tester, or their invite closing, takes it off; invited, applying or in it keeps it", async () => {
    const x = await devWithTest({ joinMode: "apply" });
    expect((await act(x.testId, "apply", x.ana.cookie, { seenAt: seen(), note: "hi" })).status).toBe(200);
    // Invite only: Ana's pending application keeps it listed; once it closes, it leaves.
    await db.test.update({ where: { id: x.testId }, data: { joinMode: "invite" } });
    expect(await x.ids()).toEqual([x.testId]);
    const v = await x.v();
    await db.application.updateMany({ where: { testId: x.testId, testerId: x.ana.user.id }, data: { status: "closed", closedReason: "invite_only", decidedAt: new Date() } });
    expect(await x.ids()).toEqual([]);
    expect(await x.v()).not.toBe(v);
    expect(await profileTestRefusal(x.testId, x.ana.user.id)).toBe(TEST_NOT_AVAILABLE);
    // Invited: listed; the developer cancels the invite: it leaves.
    expect((await act(x.testId, "invite", x.dev.cookie, { testerIds: [x.ana.user.id], seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await x.ids()).toEqual([x.testId]);
    expect(await profileTestRefusal(x.testId, x.ana.user.id)).toBe("");
    const inv = await db.invite.findFirstOrThrow({ where: { testId: x.testId, testerId: x.ana.user.id, status: "sent" } });
    expect((await act(x.testId, "cancel-invite", x.dev.cookie, { inviteId: inv.id, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect(await x.ids()).toEqual([]);
    expect(await profileTestRefusal(x.testId, x.ana.user.id)).toBe(TEST_NOT_AVAILABLE);
    // The developer and the team still see it.
    const devRow = await db.user.findUniqueOrThrow({ where: { id: x.dev.user.id } });
    expect((await profileOpenTests(devRow, { id: x.dev.user.id }, false)).map((t) => t.id)).toEqual([x.testId]);
    expect((await profileOpenTests(devRow, x.ana.user, true)).map((t) => t.id)).toEqual([x.testId]);
  });

  it("a stale click opens the test page with only the refusal; the profile polls and refreshes when shown again", async () => {
    const x = await devWithTest();
    const blocker = await makeUser({ tester: true });
    await db.block.create({ data: { blockerId: blocker.user.id, blockedId: x.dev.user.id } });
    expect(await profileTestRefusal(x.testId, blocker.user.id)).toBe(TEST_NOT_AVAILABLE);
    const profile = src("app/app/developers/[id]/page.tsx");
    expect(profile).toContain("{!mine && !isAdmin(viewer) && <AutoRefresh query={`profile=${p.id}`} v={openTestsV(open)} />}");
    expect(profile).toContain("`/app/find/${t.id}?from=profile`");
    const listing = src("app/app/find/[id]/page.tsx");
    expect(listing).toContain('const gone = from === "profile" && !isAdmin(u) ? await profileTestRefusal(id, u.id) : "";');
    expect(listing).toContain('<p className="card note" data-unavailable="" data-profile-gone="">{gone}</p>');
    expect(src("components/AutoRefresh.tsx")).toContain("const last = useRef<string | null>(v ?? null);");
  });
});

describe("small things (section 13)", () => {
  it("the tester's stop box knows when Alerts is Off and drops the two Alerts lines", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await db.user.update({ where: { id: tester.user.id }, data: { testerAlertsOff: true } });
    const before = seen();
    await later();
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { writtenCents: "12.00" }, seenAt: seen(), confirmed: true })).status).toBe(200);
    // New terms still stop with Alerts Off; the box is told Alerts is Off.
    const r = await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: before });
    expect(r.body.error.code).toBe("stop_once");
    expect(r.body.error.alertsOff).toBe(true);
    await db.user.update({ where: { id: tester.user.id }, data: { testerAlertsOff: false } });
    const r2 = await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"], seenAt: before });
    expect(r2.body.error.alertsOff).toBe(false);
    const q = src("components/QuickIgnore.tsx");
    expect(q).toContain("if (!show || (off && !done)) return null;");
    expect(src("lib/client.ts")).toContain('if (e?.code === "stop_once" && typeof e.alertsOff === "boolean") setTesterAlertsOff(e.alertsOff);');
    expect(src("components/TesterAlertsToggle.tsx")).toContain("useEffect(() => setTesterAlertsOff(off), [off]);");
    for (const f of ["lib/server/joining.ts", "lib/server/terms.ts", "lib/server/testerGate.ts", "app/api/invites/[id]/route.ts"]) expect(src(f), f).toContain("alertsOff");
  });

  it("Edit shows the red key line once, under the Free box", () => {
    const keys = src("app/app/tests/KeyBoxes.tsx");
    expect(keys.match(/\{line && </g)?.length).toBe(1);
    const free = keys.slice(keys.indexOf('id="keysFree"'), keys.indexOf("One key per line."));
    expect(free).toContain('{line && <p className="err-field" role="alert" data-keys-line="">{line}</p>}');
    // A server mistake the page's own key line already says isn't marked again under the box.
    expect(src("app/app/tests/TestForm.tsx")).toContain('(k === "keys" && !!keyLine && keyLine.includes(m))');
  });
});
