import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import fs from "node:fs";
import path from "node:path";
import { json, makeUser, req } from "./helpers";
import { GET as keptGET, POST as keptPOST } from "@/app/api/kept/route";
import { OWN_EDIT_MS, draftWrite, flushDraft, ownEdit } from "@/lib/useKept";
import { act, atHours, joined, sact, seen, settle, setup } from "./fixtures";
import { isNewVersion, publishShownVersion, serverVersion, setVersionSource, shownVersion, versionOf } from "@/lib/pageVersion";
import { bringInViewHeld, holdBringInView } from "@/lib/markJump";
import { ALERTS_ON_LINE, ALERTS_OFF_LINE } from "@/components/TesterAlertsToggle";

// Batch 35 §59 (owner, Oct 31; replaces batch 15 §25 for Leave): Leave goes through the tester's one gate like their other presses.
// §60 a refusal / stop line goes on a redraw with a new page version; §61 the tester's own other-tab actions always stop; §62 See it stays at the panel.
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");
const texts = (r: { body: { error?: { changes?: { text: string }[] } } }) => (r.body.error?.changes ?? []).map((c) => c.text);
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true });
};
const payRecording = async (sessionId: string) => {
  const rec = await db.submission.create({ data: { contractId: sessionId, kind: "recording", agreedCents: 500, sentAt: new Date(), updatedAt: new Date() } });
  await db.review.create({ data: { submissionId: rec.id, contractId: sessionId, amountCents: 500, agreedCents: 500, reason: "", payKey: "k-" + rec.id } });
};
const status = async (id: string) => (await db.contract.findUniqueOrThrow({ where: { id } })).status;

describe("batch 35 §59: Leave stops once for contract changes, like the other tester presses", () => {
  it("new terms after the page loaded: the first Leave stops once (the box at the contract's offer box), the confirmed press leaves", async () => {
    const { dev, testId } = await setup({ recordingCents: "5.00" });
    const { tester, sessionId } = await joined(testId);
    await settle();
    const loaded = seen();
    await settle();
    expect((await edit(testId, dev.cookie, { writtenCents: "12.00" })).status).toBe(200);
    await settle();
    const r = await sact(sessionId, "leave", tester.cookie, { seenAt: loaded });
    expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
    // top: the page goes up to the Switch / Keep offer box (the contract box), as every other tester press's terms stop does.
    expect(r.body.error.top).toBe(true);
    expect(r.body.error.changes.map((c: { text: string }) => c.text)).toEqual([expect.stringMatching(/offered you the new terms/)]);
    expect(await status(sessionId)).toBe("working");
    expect((await sact(sessionId, "leave", tester.cookie, { seenAt: loaded, confirmed: true })).status).toBe(200);
    expect(await status(sessionId)).toBe("left");
  });

  it("a payment stops once with Alerts On; with Alerts Off (payments ignored) Leave goes straight through", async () => {
    const { testId } = await setup({ recordingCents: "5.00" });
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Okafor");
    await settle();
    const loaded = seen();
    await settle();
    await payRecording(a.sessionId);
    await payRecording(b.sessionId);
    await settle();
    const r = await sact(a.sessionId, "leave", a.tester.cookie, { seenAt: loaded });
    expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
    expect(r.body.error.top).toBe(false);
    expect((await sact(a.sessionId, "leave", a.tester.cookie, { seenAt: loaded, confirmed: true })).status).toBe(200);
    await db.user.update({ where: { id: b.tester.user.id }, data: { testerAlertsOff: true } });
    const l = await sact(b.sessionId, "leave", b.tester.cookie, { seenAt: loaded });
    expect(l.status, JSON.stringify(l.body)).toBe(200);
    expect(await status(b.sessionId)).toBe("left");
  });

  it("a refusal stays unchanged and comes before any stop", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await settle();
    const loaded = seen();
    expect((await sact(sessionId, "leave", tester.cookie, { seenAt: loaded })).status).toBe(200);
    await settle();
    expect((await edit(testId, dev.cookie, { writtenCents: "12.00" })).status).toBe(200);
    const r = await sact(sessionId, "leave", tester.cookie, { seenAt: loaded });
    expect(r.body.error?.code).toBe("gone");
    expect(r.body.error.message).toBe("You already left this test.");
  });
});

describe("batch 35 §61: what the tester did in another tab always stops once (Alerts Off too)", () => {
  it("Alerts Off: a call request made in tab A stops Leave in tab B once (§59's exception: never ignorable); the confirmed press leaves", async () => {
    const { testId } = await setup({ spots: 5 });
    const { tester, sessionId } = await joined(testId);
    await db.user.update({ where: { id: tester.user.id }, data: { testerAlertsOff: true } });
    await settle();
    const loaded = seen();
    await settle();
    expect((await sact(sessionId, "request-time", tester.cookie, { startsAt: atHours(50), seenAt: seen(), confirmed: true, tab: "A" })).status).toBe(200);
    await settle();
    const r = await sact(sessionId, "leave", tester.cookie, { seenAt: loaded, pageSeenAt: loaded, tab: "B" });
    expect(r.body.error?.code, JSON.stringify(r.body)).toBe("stop_once");
    expect(texts(r)).toEqual([expect.stringMatching(/^You requested a call for .* in another tab$/)]);
    expect(r.body.error.alertsOff).toBe(true);
    expect((await sact(sessionId, "leave", tester.cookie, { seenAt: loaded, tab: "B", confirmed: true })).status).toBe(200);
  });

  it("Alerts Off: Apply in tab A still stops Join on tab B's join page once", async () => {
    const { testId } = await setup({ joinMode: "apply" });
    const t = await makeUser({ tester: true, name: "Dee Moss" });
    await db.user.update({ where: { id: t.user.id }, data: { testerAlertsOff: true } });
    await settle();
    const loaded = seen();
    await settle();
    expect((await act(testId, "apply", t.cookie, { seenAt: seen(), tab: "A", note: "hi" })).status).toBe(200);
    await db.invite.create({ data: { testId, testerId: t.user.id } });
    const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
    const j = await act(testId, "join", t.cookie, { listingVersion: test.listingVersion, seenAt: loaded, tab: "B" });
    expect(j.body.error?.code, JSON.stringify(j.body)).toBe("stop_once");
    expect(texts(j)).toEqual(["You applied to join in another tab"]);
  });

  it("the Alerts lines say other tabs always stop; the live box never greys them; the developer's menu doesn't offer them", () => {
    expect(ALERTS_ON_LINE).toBe("Stops a press once for: new terms, your key, pay, calls, delayed pay, your dispute, listing changes, and what you did in another tab.");
    expect(ALERTS_OFF_LINE).toBe("Stops a press only for: new terms, your key marked as working, and what you did in another tab.");
    expect(src("lib/server/testerGate.ts")).toContain('export const ALERTS_OFF_KINDS = new Set([...CONTRACT_KINDS, "own"]);');
    expect(src("app/api/live/route.ts")).toContain("!ALERTS_OFF_KINDS.has(shown[i].kind)");
    expect(src("components/QuickIgnore.tsx")).toContain("New terms from the developer, a key marked as working and what you did in another tab still stop.");
    expect(src("lib/alerts.ts")).not.toMatch(/key: "(own|tabs)"/);
  });
});

describe("batch 35 §60: a refusal or stop line goes on a redraw with a new page version", () => {
  it("shown, then the redraw that brought its own change keeps it; a newer version clears it", async () => {
    let server = "v2";
    const off = setVersionSource("session=s1", async () => server);
    publishShownVersion("session=s1", "v1");
    // The refusal appears: its baseline is the server's version now (the redraw for the refusal's own change is coming).
    const base = await serverVersion();
    expect(base).toBe(versionOf(new Map([["session=s1", "v2"]])));
    publishShownVersion("session=s1", "v2");
    expect(isNewVersion(base, shownVersion())).toBe(false);
    // Nothing new: the line stays.
    publishShownVersion("session=s1", "v2");
    expect(isNewVersion(base, shownVersion())).toBe(false);
    // The tester left in another tab / the test ended: a new version, the line goes.
    server = "v3";
    publishShownVersion("session=s1", "v3");
    expect(isNewVersion(base, shownVersion())).toBe(true);
    // No baseline yet (or a page without a fingerprint): never.
    expect(isNewVersion(undefined, shownVersion())).toBe(false);
    expect(isNewVersion("", "x")).toBe(false);
    off();
  });

  it("the shared boxes use it: Err (refusals, not red mistakes), ChangesBox, FormMistakes' orphans; AutoRefresh publishes its version; api() announces refusals", () => {
    expect(src("components/Err.tsx")).toContain('useGoneOnNewVersion(text.startsWith(FIELD) ? "" : text, text)');
    expect(src("components/ChangesBox.tsx")).toContain("useGoneOnNewVersion(changes ?? error ?? null");
    expect(src("components/FormMistakes.tsx")).toContain("orphans={gone ? [] : orphans}");
    expect(src("components/AutoRefresh.tsx")).toContain("publishShownVersion(query, v)");
    expect(src("components/AutoRefresh.tsx")).toContain("setVersionSource(query,");
    expect(src("lib/client.ts")).toContain("new CustomEvent(PRESS_ERROR_EVENT, { detail: e.message })");
  });
});

describe("batch 35 §62: See it stays at the Listing panel", () => {
  it("a See it jump holds boxes from pulling the page back and drops a kept place; the jump's landing lets go soon after", () => {
    const now = 1_000_000;
    holdBringInView(12_000, now);
    expect(bringInViewHeld(now + 11_000)).toBe(true);
    holdBringInView(1500, now + 3000);
    expect(bringInViewHeld(now + 5000)).toBe(false);
    expect(src("lib/markJump.ts")).toContain("if (!el || bringInViewHeld()) return;");
    const info = src("components/ListingInfo.tsx");
    expect(info).toMatch(/holdBringInView\(SEE_IT_WAIT_MS \+ 2000\);\s+cancelPlaceRestore\(\);/);
    expect(info).toContain("holdBringInView(1500);");
    expect(src("lib/keepPlace.ts")).toContain("export function cancelPlaceRestore(");
  });
});

describe("batch 35 §65: only this tab's own edits write the shared draft", () => {
  it("tab A restored-untouched + a value change from a redraw: no request; tab B's draft stays for a new tab C", async () => {
    const dev = await makeUser({ dev: true });
    const keep = async (data: unknown) => json(await keptPOST(req("/api/kept", { cookie: dev.cookie, headers: { "x-uid": dev.user.id }, body: { key: "test:edit:t65", data } })));
    const read = async () => (await json(await keptGET(req("/api/kept?key=test%3Aedit%3At65", { cookie: dev.cookie, headers: { "x-uid": dev.user.id } })))).body.data as Record<string, unknown> | null;
    // Tab B typed every field: its own edit writes.
    const now = 5_000_000;
    expect(draftWrite({ ready: true, cleared: false, pristine: false, saved: true, unsent: false, own: ownEdit(now - 20, now) })).toBe(true);
    expect((await keep({ title: "B's title" })).status).toBe(200);
    // Old tab A (opened from an earlier draft, untouched: "pristine", a copy saved) becomes visible and redraws: its value changes with no gesture.
    const a = { ready: true, cleared: false, pristine: true, saved: true, unsent: false, own: ownEdit(now - 60_000, now) };
    expect(draftWrite(a)).toBe(false); // never forgets (null) the draft
    expect(draftWrite({ ...a, pristine: false })).toBe(false); // never sends its own older value over it
    expect(ownEdit(0, now)).toBe(false);
    expect(ownEdit(now - OWN_EDIT_MS - 1, now)).toBe(false);
    // §16 stays consistent: nothing unsent, nothing flushed on leaving / hiding.
    expect(flushDraft(a)).toBe("skip");
    // Typing waiting to be saved is still saved when a redraw lands meanwhile.
    expect(draftWrite({ ...a, pristine: false, unsent: true })).toBe(true);
    // A brand-new tab C reads B's draft.
    expect((await read())?.title).toBe("B's title");
    const kept = src("lib/useKept.tsx");
    expect(kept).toContain("if (!draftWrite({ ready: ready.current, cleared: cleared.current, pristine, saved: saved.current, unsent: unsent.current, own })) return;");
    expect(kept).toContain("if (e.isTrusted) lastGesture = Date.now();");
  });
});

describe("batch 35 §66: the 3-change count starts when the first tester joins", () => {
  const editT = async (testId: string, cookie: string, fields: Record<string, unknown>) => {
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    return act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true });
  };
  const stored = async (testId: string) => (await db.test.findUniqueOrThrow({ where: { id: testId } })).criticalCounts as Record<string, unknown> | null;
  it("invite + 3 saves: nothing counted; the invited tester joins: the next save counts 1", async () => {
    const { dev, testId } = await setup({ joinMode: "invite" });
    const ben = await makeUser({ tester: true, name: "Ben Ward" });
    expect((await act(testId, "invite", dev.cookie, { testerIds: [ben.user.id], seenAt: seen(), confirmed: true })).status).toBe(200);
    for (const d of ["Sail one", "Sail two", "Sail three"]) expect((await editT(testId, dev.cookie, { description: d })).status).toBe(200);
    expect((await stored(testId))?.description ?? 0).toBe(0);
    expect((await stored(testId))?.since).toBeUndefined();
    const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect((await act(testId, "join", ben.cookie, { listingVersion: test.listingVersion })).status).toBe(200);
    expect((await stored(testId))?.since).toBeTruthy();
    await settle();
    expect((await editT(testId, dev.cookie, { description: "Sail four" })).status).toBe(200);
    expect((await stored(testId))?.description).toBe(1);
  });

  it("a 'since' stored from an invite (older data) is recomputed from the first join: the saves before it no longer count", async () => {
    const { dev, testId } = await setup();
    await db.test.update({ where: { id: testId }, data: { criticalCounts: { description: 2, since: new Date(Date.now() - 86_400_000).toISOString() } } });
    // Nobody joined: counting hasn't started.
    expect((await editT(testId, dev.cookie, { description: "Sail five" })).status).toBe(200);
    expect((await stored(testId))?.since).toBeUndefined();
    expect((await stored(testId))?.description ?? 0).toBe(0);
    await joined(testId);
    expect((await editT(testId, dev.cookie, { description: "Sail six" })).status).toBe(200);
    expect((await stored(testId))?.description).toBe(1);
    expect(src("lib/server/invites.ts")).not.toContain("stampCounting");
    expect(src("lib/server/joining.ts")).not.toContain("stampCounting");
  });
});
