import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getKept, setKept } from "@/lib/server/kept";
import { invitePanel, WHY_IN_TEST, WHY_INVITED } from "@/lib/server/invites";
import { newInviteLine } from "@/lib/server/joining";
import { testV } from "@/lib/server/pulseV";
import { testerChanges } from "@/lib/server/testerGate";
import { asLines } from "@/lib/server/live";
import { keyOf } from "@/lib/server/accessKeys";
import { KEY_BOX_ID } from "@/lib/keys";
import { POST as testsPOST } from "@/app/api/tests/route";
import { json, makeUser, req, uniq } from "./helpers";
import { act, joined, listingBody, seen, settle, setup } from "./fixtures";

// Batch 34 §9-§11 (owner's findings, Oct 30): Edit after its own Save; Join after a re-sent invite; the invite panel's lists.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const dollars = (c: number | null) => (c == null ? null : (c / 100).toFixed(2));

/** What a tab's form holds, as the API takes it (TestForm's toApi). */
async function formOf(testId: string, over: Record<string, unknown> = {}) {
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  return {
    productName: t.productName, title: t.title, description: t.description, buildUrl: t.buildUrl, categories: t.categories, devices: t.devices, languages: t.languages,
    mature: t.mature, matureWhy: t.mature ? t.matureWhy : "", ndaText: t.ndaText, spots: String(t.spots), deadlineDays: String(t.deadlineDays),
    writtenCents: dollars(t.writtenCents), recordingCents: dollars(t.recordingCents), liveRateCents: dollars(t.liveRateCents), liveMinutes: null,
    writtenRequired: t.writtenCents != null && t.writtenRequired, recordingRequired: t.recordingCents != null && t.recordingRequired, liveRequired: t.liveRateCents != null && t.liveRequired,
    questions: t.questions as string[], openUntil: t.openUntil ? t.openUntil.toISOString().slice(0, 10) : "", joinMode: t.joinMode, ...over,
  };
}

/** Tab A opens Edit: what it loaded (as an Edit page sends it with every Save). */
async function editPage(testId: string) {
  const t0 = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const loaded = { version: t0.version, seenAt: seen(), base: await formOf(testId), keysLoaded: [] as string[] };
  await settle();
  return loaded;
}
type Loaded = Awaited<ReturnType<typeof editPage>>;
const save = (testId: string, cookie: string, page: Loaded, tab: string, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  act(testId, "edit", cookie, { version: page.version, fields, seenAt: page.seenAt, tab, base: page.base, has: { ...page.base, ...fields }, keysLoaded: page.keysLoaded, keysAdd: [], keysRemove: [], ...extra });

describe("batch 34 §9: Edit after its own Save", () => {
  it("owner's repro: the same tab's Save, then (Back, stale page) another Save from that tab goes straight through; never \"another tab\"", async () => {
    const { dev, testId } = await setup();
    const page = await editPage(testId);
    const first = await save(testId, dev.cookie, page, "tab-A", { productName: "Harbor Run Deluxe", title: "Harbor Run, levels 1-3", description: "Sail through all three reefs." });
    expect(first.status).toBe(200);
    // The save is kept with its tab.
    expect((await db.testEvent.findFirstOrThrow({ where: { testId, kind: "edited" }, orderBy: { createdAt: "desc" } })).tab).toBe("tab-A");
    await settle();
    // Back to the Edit page as it was before the Save (its version and base are older), the fields typed again: before the fix this stopped with
    // "Product / Name of this test / Instructions: your version will replace the one saved in another tab at 11:15 AM.".
    const again = await save(testId, dev.cookie, page, "tab-A", { productName: "Harbor Run Gold", title: "Harbor Run, levels 1-4", description: "Sail through all four reefs." });
    expect(again.status).toBe(200);
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect([t.productName, t.title, t.description]).toEqual(["Harbor Run Gold", "Harbor Run, levels 1-4", "Sail through all four reefs."]);
  });

  it("a save from another tab still stops once, one line per typed field (the fix is only for this tab's own saves)", async () => {
    const { dev, testId } = await setup();
    const page = await editPage(testId);
    expect((await save(testId, dev.cookie, page, "tab-A", { title: "Harbor Run, levels 1-3" })).status).toBe(200);
    await settle();
    const other = await editPage(testId);
    expect((await save(testId, dev.cookie, other, "tab-B", { description: "Sail through all three reefs." })).status).toBe(200);
    await settle();
    const r = await save(testId, dev.cookie, page, "tab-A", { description: "Only the first reef." });
    expect(r.status).toBe(409);
    const lines = r.body.error.changes as { text: string; kind?: string; fields?: string[] }[];
    expect(lines.filter((l) => l.kind === "yours")).toEqual([expect.objectContaining({ text: "Instructions: your version will replace the one saved in another tab", fields: ["description"] })]);
    // Never a line for the field only this tab saved.
    expect(lines.some((l) => /Name of this test|title/.test(l.text))).toBe(false);
  });

  it("the Save's answer carries what was saved (the page's new base) and the kept draft is gone on the server", async () => {
    const { dev, testId } = await setup();
    await setKept(dev.user.id, `test:edit:${testId}`, { f: { description: "Old typed text" }, touched: ["description"], keysText: "" });
    const page = await editPage(testId);
    const r = await save(testId, dev.cookie, page, "tab-A", { description: "Sail through all three reefs." });
    expect(r.status).toBe(200);
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect(r.body.version).toBe(t.version);
    expect(r.body.listing).toMatchObject({ description: "Sail through all three reefs.", title: t.title });
    expect(Array.isArray(r.body.keys.free)).toBe(true);
    expect((await getKept(dev.user.id, `test:edit:${testId}`)).data).toBeNull();
    // From the new base, the next Save from the same tab goes through too.
    const next = { version: r.body.version as number, seenAt: page.seenAt, base: await formOf(testId), keysLoaded: [] as string[] };
    expect((await save(testId, dev.cookie, next, "tab-A", { description: "Sail through all four reefs." })).status).toBe(200);
  });

  it("the page: base becomes what was saved, Back / forward refreshes, every replace line shows its note, no flash of the change limit", () => {
    const form = src("app/app/tests/TestForm.tsx");
    // (a) After a Save: base, version, every field's saved value; nothing touched; the draft cleared before moving on.
    expect(form).toContain("if (r.listing && typeof r.version === \"number\") savedHere(r.listing, r.version, r.keys);");
    const saved = form.slice(form.indexOf("function savedHere("), form.indexOf("async function rebaseKeys"));
    for (const s of ["setF(now);", "setBase(now);", "seenBase.current = now;", "setVersion(v);", "setTouched(new Set());", "setTheirs({});", "keysSeen.current = free;"]) expect(saved).toContain(s);
    expect(form.indexOf("savedHere(r.listing, r.version, r.keys)")).toBeLessThan(form.indexOf("await keep.clear();\n      const q = "));
    // bfcache: pageshow with persisted refreshes the data.
    expect(form).toContain('window.addEventListener("pageshow", onShow);');
    expect(form).toMatch(/if \(!e\.persisted\) return;\s+leaving\.current = false;\s+setBusy\(false\);\s+void tick\(\);/);
    // What the tab already holds (a live refresh) is no longer "news" to the base it sends.
    expect(form).toContain("const known = [...m.settled, ...m.take.filter((k) => !m.oldNote.includes(k))];");
    // (c) Each "your version will replace" line marks its field's note (their value, Use theirs).
    expect(form).toContain('const yours = ((err.data.changes as Change[]) ?? []).filter((c) => c.kind === "yours" && c.fields?.length);');
    expect(form).toContain("if (marks.length) setTheirs((o) => ({ ...o, ...Object.fromEntries(marks) }));");
    // (d) Leaving after a Save: no refresh redraws the page (the counts, the lock line) and the button stays "Saving…".
    expect(form).toContain("if (!r || !alive || leaving.current) return;");
    expect(form).toContain("if (!leaving.current) setBusy(false);");
    // The kept draft's delayed write never brings back what a Save just cleared.
    expect(src("lib/useKept.tsx")).toMatch(/const t = setTimeout\(\(\) => \{\s+\/\/[^\n]*\n\s+if \(cleared\.current\) return;/);
  });
});

describe("batch 34 §10: Join after a re-sent invite", () => {
  async function invitedThenChanged() {
    const { dev, testId } = await setup({ joinMode: "invite", ndaText: "Keep it secret." });
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [ana.user.id] })).status).toBe(200);
    const oldInvite = await db.invite.findFirstOrThrow({ where: { testId, testerId: ana.user.id, status: "sent" } });
    await settle();
    const pageAt = seen(); // the tester opens the join page
    await settle();
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: { ndaText: "Keep it secret, please." } })).status).toBe(200);
    const fresh = await db.invite.findFirstOrThrow({ where: { testId, testerId: ana.user.id, status: "sent" } });
    expect(fresh.id).not.toBe(oldInvite.id);
    return { dev, testId, ana, oldInvite, fresh, pageAt };
  }

  it("the first press stops once with the full list (the NDA change included); the second joins on the CURRENT invite without a reload", async () => {
    const { testId, ana, oldInvite, fresh, pageAt } = await invitedThenChanged();
    const first = await act(testId, "join", ana.cookie, { seenAt: pageAt, inviteId: oldInvite.id, ndaAccepted: true });
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe("stop_once");
    const lines = first.body.error.changes as { text: string; nda?: boolean }[];
    expect(lines.some((l) => l.nda)).toBe(true); // the page clears the NDA tick (JoinBox afterChanges)
    expect(lines.some((l) => /new invite on the updated listing/.test(l.text))).toBe(true);
    // The second press (the page still holds the old invite) joins on the current one.
    const second = await act(testId, "join", ana.cookie, { seenAt: pageAt, inviteId: oldInvite.id, ndaAccepted: true, confirmed: true, boxAt: first.body.error.now });
    expect(second.status).toBe(200);
    expect((await db.invite.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("joined");
    expect(await db.contract.count({ where: { testId, testerId: ana.user.id, status: "working" } })).toBe(1);
  });

  it("if the refusal still happens (the change was already shown): one sentence, no dangling colon; the next press joins", async () => {
    const { testId, ana, oldInvite, fresh } = await invitedThenChanged();
    await settle();
    const r = await act(testId, "join", ana.cookie, { seenAt: seen(), inviteId: oldInvite.id, ndaAccepted: true });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("invite_replaced");
    expect(r.body.error.message).toMatch(/^Nora Lane changed the listing at \d{1,2}:\d{2}\s[AP]M and sent you a new invite on it\. Press Join to join on it\.$/);
    expect(r.body.error.message).not.toMatch(/:$/);
    expect(newInviteLine("Nora Lane", "11:16 AM")).toBe("Nora Lane changed the listing at 11:16 AM and sent you a new invite on it. Press Join to join on it.");
    expect(r.body.error.newInviteId).toBe(fresh.id);
    expect(typeof r.body.error.now).toBe("string");
    // The page switches to the new invite and counts the refusal as seen: the next press joins.
    const next = await act(testId, "join", ana.cookie, { seenAt: seen(), inviteId: r.body.error.newInviteId, ndaAccepted: true, confirmed: true, boxAt: r.body.error.now });
    expect(next.status).toBe(200);
    const box = src("app/app/find/[id]/JoinBox.tsx");
    expect(box).toContain("setErr(e.message);\n        if (typeof e.data.newInviteId === \"string\") setInviteId(e.data.newInviteId);\n        if (typeof e.data.now === \"string\") setBoxAt(e.data.now);");
    // join(): the listing stop runs before the replaced-invite check.
    const joining = src("lib/server/joining.ts");
    const body = joining.slice(joining.indexOf("export async function join("));
    expect(body.indexOf('await listingGate(tester.id, testId, body, "join");')).toBeLessThan(body.indexOf("await replacedInvite(tester.id, testId, body);"));
  });
});

describe("batch 34 §11: the invite panel's lists leave out testers in the test and testers invited", () => {
  it("People you've worked with and Suggested: no one working in this test, no one invited; someone who left shows again; the name search shows them greyed with why", async () => {
    const tag = uniq();
    const { dev, testId } = await setup({ spots: 5 });
    // A second test by the same developer, so these testers have worked with them.
    const b = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ title: `Sky Lab ${tag}` }) })));
    expect(b.status).toBe(200);
    const inNow = await joined(testId, `Xavi In ${tag}`);
    const leaver = await joined(testId, `Lena Left ${tag}`);
    await db.contract.update({ where: { id: leaver.sessionId }, data: { status: "left", endedAt: new Date() } });
    const invited = await joined(b.body.id, `Ivo Invited ${tag}`);
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [invited.tester.user.id] })).status).toBe(200);
    const newcomer = await makeUser({ tester: true, name: `Nia New ${tag}` });
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [newcomer.user.id] })).status).toBe(200);

    const panel = await invitePanel(dev.user.id, testId);
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
    expect(ids(panel.worked)).not.toContain(inNow.tester.user.id);
    expect(ids(panel.worked)).not.toContain(invited.tester.user.id);
    expect(ids(panel.worked)).toContain(leaver.tester.user.id);
    for (const id of [inNow.tester.user.id, invited.tester.user.id, newcomer.user.id]) expect(ids(panel.suggested)).not.toContain(id);
    // (Batch 30 §7) The name search still finds them, greyed with the reason.
    const inRow = (await invitePanel(dev.user.id, testId, { q: `Xavi In ${tag}` })).found.find((x) => x.id === inNow.tester.user.id)!;
    expect(inRow).toMatchObject({ why: WHY_IN_TEST, whyKind: "in" });
    expect(inRow.grey).toBeTruthy();
    const invRow = (await invitePanel(dev.user.id, testId, { q: `Ivo Invited ${tag}` })).found.find((x) => x.id === invited.tester.user.id)!;
    expect(invRow).toMatchObject({ why: WHY_INVITED, whyKind: "invited", invited: true });
    // Cancel the invite: they show again in People you've worked with.
    const inv = await db.invite.findFirstOrThrow({ where: { testId, testerId: invited.tester.user.id, status: "sent" } });
    await db.invite.update({ where: { id: inv.id }, data: { status: "cancelled" } });
    expect(ids((await invitePanel(dev.user.id, testId)).worked)).toContain(invited.tester.user.id);
  });
});

describe("batch 34 §12: a key the developer's Save gives a working tester shows at once on their session page", () => {
  it("the session's poll fingerprint changes when the key is given; the line has a See it link to the key box", async () => {
    const { dev, testId } = await setup({ spots: 3 });
    const ana = await joined(testId, "Ana Silva");
    const since = new Date();
    await settle();
    const before = await testV(ana.tester.user.id, testId, ana.sessionId);
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: v, fields: {}, seenAt: seen(), confirmed: true, keysAdd: ["K1", "K2", "K3"] })).status).toBe(200);
    const key = (await keyOf(ana.sessionId))!;
    expect(key.value).toBe("K1");
    const after = await testV(ana.tester.user.id, testId, ana.sessionId);
    expect(after).not.toBe(before);
    expect(after.split("|").pop()).toContain(`${key.id}:inuse`);
    // Reported as not working: the fingerprint follows the key's state too.
    await db.accessKey.update({ where: { id: key.id }, data: { status: "broken" } });
    expect(await testV(ana.tester.user.id, testId, ana.sessionId)).not.toBe(after);
    // The tester's top-box line carries its kind, so it gets "See it" (jumping to the key box).
    const lines = asLines(await testerChanges(ana.tester.user.id, ana.sessionId, testId, since, ""));
    expect(lines).toContainEqual(expect.objectContaining({ text: "Nora Lane gave you an access key for “Harbor Run”", kind: "keygiven" }));
    expect(KEY_BOX_ID).toBe("access-key");
    expect(src("app/app/sessions/[id]/KeyBox.tsx")).toContain(`id="${KEY_BOX_ID}"`);
    const see = 'l.kind === "keygiven" && <> · <a href={`#${KEY_BOX_ID}`} data-see-it="key" onClick={(e) => { e.preventDefault(); jumpTo(KEY_BOX_ID); }}>See it</a></>';
    expect(src("components/LiveTop.tsx")).toContain(see);
    expect(src("components/ChangesBox.tsx")).toContain(see.replace("l.kind", "c.kind"));
  });
});

describe("batch 34 §13: no rejoin card on the session page; the test's own page is linked", () => {
  it("the session page drops the Ask to rejoin / invited back card and links to the test's page; the join box there reads Ask to rejoin", () => {
    const page = src("app/app/sessions/[id]/page.tsx");
    expect(page).not.toContain('id="rejoin"');
    expect(page).not.toContain("invited you back to");
    expect(page).not.toContain("`Ask to rejoin ${title}`");
    expect(page).toContain('<a className="text-sm" href={`/app/find/${c.testId}`} data-test-page-link="">Open the test&apos;s page</a>');
    // The test's page: a tester who left asks to rejoin there (an invited one just joins).
    const box = src("app/app/find/[id]/JoinBox.tsx");
    expect(box).toContain("const rejoining = !!p.rejoin && !p.invited;");
    expect(box).toContain('rejoining ? "Ask to rejoin" : applying ? "Apply to join" : "Join this test"');
  });
});
