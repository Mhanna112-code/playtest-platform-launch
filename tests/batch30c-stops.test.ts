import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { GET as liveGET } from "@/app/api/live/route";
import { pressSeenAt } from "@/lib/live";
import { lockedChangeLine } from "@/lib/lockedChange";
import { parseSave, saveLine } from "@/lib/listingSave";
import { json, makeUser, req, saveRe } from "./helpers";
import { act, joined, sact, seen, setup } from "./fixtures";

// Batch 30 §9-§12 and the owner's Oct 29 addition: one line per listing save for testers; the join page's stop lists every change (the NDA too) and the needs-covered
// notice never swallows them; one stop box for several sources at once (your own other-tab changes with the other person's), oldest first, the second press goes ahead.

const later = () => new Promise((r) => setTimeout(r, 30));
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");
const texts = (r: { body: { error: { changes: { text: string }[] } } }) => r.body.error.changes.map((c) => c.text);
const ats = (r: { body: { error: { changes: { at: string }[] } } }) => r.body.error.changes.map((c) => new Date(c.at).getTime());
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version: v, fields, confirmed: true, ...extra });
};
const live = (cookie: string, scope: string, since: string) =>
  later().then(() => liveGET(req(`/api/live?scope=${encodeURIComponent(scope)}&since=${encodeURIComponent(since)}`, { cookie }))).then(json);
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
// (Batch 30 §14, another fork) written answers of 50+ characters each.
const LONG = ["The first level was clear and the controls felt right on my laptop.", "I got stuck on the second bridge because the jump timing was unclear."];

describe("batch 30 §10: one line per listing save for testers", () => {
  it("one save of several fields is ONE line on the join page and ONE on the session page (the listing information only), saying its own time", async () => {
    const { dev, testId } = await setup({ recordingCents: "5.00" });
    const { tester, sessionId } = await joined(testId);
    const outsider = await makeUser({ tester: true, name: "Cara Diaz" });
    await later();
    const pageLoaded = seen();
    await later();
    expect((await edit(testId, dev.cookie, { productName: "Harbor Run Deluxe", title: "lllllq", description: "Sail on", buildUrl: "https://example.com/b9", recordingCents: "6.00", liveRateCents: "31.00" })).status).toBe(200);
    // The join page: every field, the title with its new name.
    const j = await act(testId, "join", outsider.cookie, { seenAt: pageLoaded });
    expect(j.body.error.code).toBe("stop_once");
    expect(texts(j)).toEqual([expect.stringMatching(saveRe("Nora Lane", "product name, title (now “lllllq”), description, build link, recording price, live call rate"))]);
    expect(j.body.error.changes[0]).toMatchObject({ kind: "info", listing: true, keys: ["productName", "title", "description", "buildUrl", "parts", "call"] }); // (batch 35 §34) one line, See it marks them all
    const lj = await live(outsider.cookie, `listing:${testId}`, pageLoaded);
    expect(lj.body.changes.map((c: { text: string }) => c.text)).toEqual(texts(j));
    // The session page: the listing information only (the prices come as new terms, Switch / Keep): one line in the top box.
    const ls = await live(tester.cookie, `session:${sessionId}`, pageLoaded);
    expect(ls.body.changes.filter((c: { text: string }) => /edited the listing|changed the|renamed/.test(c.text)).map((c: { text: string }) => c.text)).toEqual([expect.stringMatching(saveRe("Nora Lane", "product name, title (now “lllllq”), description, build link"))]);
    // The developer's own pages are unchanged.
    const d = await act(testId, "next-round", dev.cookie, { seenAt: pageLoaded, tab: "tab-x" });
    expect(d.body.error.changes.map((c: { text: string }) => c.text).join(" | ")).not.toMatch(/edited the listing at/);
  });

  it("the session page's stop box: one line per save (a save without new terms: no Switch / Keep to answer first)", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await later();
    const before = seen();
    await later();
    expect((await edit(testId, dev.cookie, { title: "lllllq 2", devices: ["Windows PC"], languages: ["English"] })).status).toBe(200);
    const s = await sact(sessionId, "request-time", tester.cookie, { seenAt: before, startsAt: new Date(Date.now() + 80 * 3_600_000).toISOString() });
    expect(texts(s)).toEqual([expect.stringMatching(saveRe("Nora Lane", "title (now “lllllq 2”), devices, languages"))]);
  });

  it("(Oct 29 addition) the developer's other tab: one line for their own save, the rename in it (no second 'You renamed the test' line)", async () => {
    const { dev, testId } = await setup();
    await later();
    const pageLoaded = seen();
    await later();
    expect((await edit(testId, dev.cookie, { title: "Harbor Run 9", description: "Sail on" }, { tab: "tab-a" })).status).toBe(200);
    const r = await act(testId, "next-round", dev.cookie, { seenAt: pageLoaded, tab: "tab-b" });
    expect(texts(r)).toEqual(["You saved the listing in another tab"]); // (batch 35 §34) no field list
    const l = await live(dev.cookie, `test:${testId}`, pageLoaded);
    expect(l.body.changes.map((c: { text: string }) => c.text)).toEqual(texts(r));
  });

  it("a rename alone stays info only: it never stops by itself; the line words", () => {
    const at = new Date("2026-10-29T23:55:00Z");
    const s = parseSave(JSON.stringify({ by: "Marc Hanna", fields: ["title"], title: "lllllq", nda: false }))!;
    expect(saveLine(s, at, "America/Chicago", "join")).toEqual({ text: expect.stringMatching(/^Marc Hanna edited the listing at 6:55\sPM: title \(now “lllllq”\)$/), titleOnly: true, nda: false });
    const nda = parseSave(JSON.stringify({ by: "Marc Hanna", fields: ["ndaText"], title: "x", nda: true }))!;
    expect(saveLine(nda, at, "America/Chicago", "join")?.text).toMatch(/^Marc Hanna changed the NDA at 6:55\sPM: read and accept it again below$/);
    expect(saveLine(nda, at, "America/Chicago", "session")).toBeNull(); // the NDA is part of a working tester's contract (Switch / Keep)
    const removed = parseSave(JSON.stringify({ by: "Marc Hanna", fields: ["ndaText", "description"], title: "x", nda: false }))!;
    expect(saveLine(removed, at, "UTC", "join")?.text).toMatch(/^Marc Hanna edited the listing at 11:55\sPM: NDA \(removed\), description$/);
  });

  it("the join page's Alerts hint says the dashboard (there is no test page yet); the stop box's See it", () => {
    expect(src("components/QuickIgnore.tsx")).toContain('"You can turn these stops off below, or with Alerts on your dashboard."');
    const join = src("app/app/find/[id]/JoinBox.tsx");
    expect(join).toContain('seeIt="#listing" alertsWhere="join"');
    expect(join).not.toMatch(/<ChangesBox side="tester" changes=\{box\?\.changes \?\? null\} tail=\{box\?\.tail\} \/>/);
    // (Batch 34 §14) The developer's listing lines too (c.listing); the page can give every box its target (SeeItTarget).
    expect(src("components/ChangesBox.tsx")).toContain('seeTo && ((c.timed && c.kind === "info") || c.listing)');
  });
});

describe("batch 30 §12: the join page's stop lists every change since the page last showed it", () => {
  it("three saves after the page loads, an NDA change among them: all three stop Join; a save the top box already showed doesn't stop again", async () => {
    const { dev, testId } = await setup({ ndaText: "Keep it secret." });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    await later();
    const pageLoaded = seen();
    await later();
    await edit(testId, dev.cookie, { questions: ["What did you like most?", "Where did you get stuck?"] });
    await later();
    await edit(testId, dev.cookie, { productName: "Harbor Run 2", description: "Sail again" });
    await later();
    await edit(testId, dev.cookie, { ndaText: "Keep it secret, please." });
    const r = await act(testId, "join", ana.cookie, { seenAt: pageLoaded, ndaAccepted: true });
    expect(r.body.error.code).toBe("stop_once");
    // (Batch 35 §34) The three edits are ONE line (covering every field); the NDA to accept again keeps its own.
    expect(texts(r)).toEqual([
      expect.stringMatching(saveRe("Nora Lane", "questions, product name, description, NDA")),
      expect.stringMatching(saveRe("Nora Lane", "read and accept it again below", "changed the NDA")),
    ]);
    expect(r.body.error.changes[0]).toMatchObject({ keys: ["productName", "description", "questions", "ndaText"] });
    expect(r.body.error.changes[1]).toMatchObject({ nda: true });
    expect(ats(r)).toEqual([...ats(r)].sort((a, b) => a - b));
    // The top box showed the first two: a press sent with its marker stops only for what came after.
    const l = await live(ana.cookie, `listing:${testId}`, pageLoaded);
    expect(l.body.changes).toHaveLength(2);
    await later();
    expect((await edit(testId, dev.cookie, { categories: ["Game", "Education"] })).status).toBe(200);
    const again = await act(testId, "join", ana.cookie, { seenAt: l.body.now, ndaAccepted: true });
    expect(texts(again)).toEqual([expect.stringMatching(saveRe("Nora Lane", "categories"))]);
    // The second press (its box shown) joins.
    expect((await act(testId, "join", ana.cookie, { seenAt: l.body.now, ndaAccepted: true, confirmed: true, boxAt: again.body.error.now })).status).toBe(200);
  });

  it("the owner's finding: the save that makes the tester meet the needs still stops Join with ALL its other changes, shown with 'You now meet this test's needs'", async () => {
    const { dev, testId } = await setup({ devices: ["Mac"] });
    const ana = await makeUser({ tester: true, name: "Ana Silva" }); // Windows PC: doesn't cover "Mac"
    await later();
    const pageLoaded = seen();
    await later();
    // One save: the devices (now covered), the recording price and the questions.
    expect((await edit(testId, dev.cookie, { devices: ["Windows PC"], recordingCents: "7.00", questions: ["What did you like most?"] })).status).toBe(200);
    // The press finds the needs covered: the page asks what changed (my-gaps with its marker) and shows it with the notice.
    const g = await act(testId, "my-gaps", ana.cookie, { seenAt: pageLoaded, verb: "join" });
    expect(g.body.gaps).toEqual({ devices: [], languages: [] });
    expect(g.body.changes.map((c: { text: string }) => c.text)).toEqual([expect.stringMatching(saveRe("Nora Lane", "devices, recording price, questions"))]);
    expect(g.body.tail).toBe("Press again to join on the current listing.");
    // The next press (that box shown) joins.
    expect((await act(testId, "join", ana.cookie, { seenAt: pageLoaded, confirmed: true, boxAt: g.body.now })).status).toBe(200);
  });

  it("without that box the next Join still stops for the save (a redraw never moves the marker)", async () => {
    const { dev, testId } = await setup({ devices: ["Mac"] });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    await later();
    const pageLoaded = seen();
    await later();
    await edit(testId, dev.cookie, { devices: ["Windows PC"], description: "Sail on" });
    const r = await act(testId, "join", ana.cookie, { seenAt: pageLoaded });
    expect(texts(r)).toEqual([expect.stringMatching(saveRe("Nora Lane", "description, devices"))]);
    // The page keeps its first load as the marker: the redraw's newer render time loses to it.
    expect(pressSeenAt("2026-10-29T19:05:00.000Z", "2026-10-29T18:50:00.000Z", "")).toBe("2026-10-29T18:50:00.000Z");
    expect(pressSeenAt("2026-10-29T19:05:00.000Z", "2026-10-29T18:50:00.000Z", "2026-10-29T18:58:00.000Z")).toBe("2026-10-29T18:58:00.000Z");
    expect(pressSeenAt("2026-10-29T19:05:00.000Z", "", "")).toBe("2026-10-29T19:05:00.000Z"); // a page that doesn't note its load: as before
    const join = src("app/app/find/[id]/JoinBox.tsx");
    expect(join).toContain("const [seenAt] = useState(p.seenAt);");
    expect(join).toContain("await coveredNow(");
    expect(src("app/app/find/[id]/page.tsx")).toContain("<PageLoaded at={seenAt} />");
    expect(src("app/app/tests/[id]/page.tsx")).toContain("<PageLoaded at={seenAt} />");
    expect(src("app/app/tests/[id]/edit/page.tsx")).toContain("<PageLoaded at={seenAt} />");
    expect(src("lib/client.ts")).toContain("seenNow((body as { seenAt: string }).seenAt)");
  });
});

// (Owner, Oct 31, batch 35 §55) Replaces batch 30 §11: the join page has no live "Changed since you opened this page" list by the button any more.
describe("batch 35 §55 (replacing batch 30 §11): no live list next to Join", () => {
  it("live changes show only in the top box; by the button only the stop box after a press", () => {
    const join = src("app/app/find/[id]/JoinBox.tsx");
    expect(join).not.toContain("data-changed-since");
    expect(join).not.toContain("Changed since you opened this page");
    expect(join).not.toContain("setSince(");
    expect(join).toContain("<ChangesBox side=\"tester\" changes={box?.changes ?? null}");
  });
});

describe("batch 30 (Oct 29 addition): one stop box for several sources at once", () => {
  it("the developer's test page: their own save in another tab AND a tester sending work stop Pay once together, oldest first; the second press pays", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await later();
    const pageLoaded = seen();
    await later();
    expect((await sact(sessionId, "written", tester.cookie, { answers: LONG })).status).toBe(200);
    await later();
    expect((await edit(testId, dev.cookie, { description: "Sail faster" }, { tab: "tab-a" })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const body = { payKey: randomUUID(), kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: pageLoaded, tab: "tab-b" };
    const first = await reviewPOST(req("/api/review", { cookie: dev.cookie, body })).then(json);
    expect(first.body.error.code).toBe("stop_once");
    const t = texts(first);
    expect(t[0]).toBe("Ana Silva sent her written answers");
    expect(t[1]).toMatch(/^You (saved|changed) .* in another tab/);
    expect(ats(first)).toEqual([...ats(first)].sort((a, b) => a - b));
    expect((await reviewPOST(req("/api/review", { cookie: dev.cookie, body: { ...body, confirmed: true, boxAt: seen() } })).then(json)).status).toBe(200);
  });

  it("Edit's Save: a Pay made in another tab AND a tester joining stop Save once together; the second Save saves", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: LONG });
    await later();
    const pageLoaded = seen();
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    await later();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, tab: "tab-a" })).status).toBe(200);
    await later();
    await joined(testId, "Ben Carter", "he");
    const first = await act(testId, "edit", dev.cookie, { version: v, fields: { title: "Harbor Run 3" }, seenAt: pageLoaded, tab: "tab-b" });
    expect(first.body.error.code).toBe("changed");
    expect(texts(first)).toEqual(["You paid Ana Silva $10.00 for the written answers in another tab", "Ben Carter joined"]);
    expect(ats(first)).toEqual([...ats(first)].sort((a, b) => a - b));
    const second = await act(testId, "edit", dev.cookie, { version: first.body.error.version, fields: { title: "Harbor Run 3" }, seenAt: pageLoaded, tab: "tab-b", confirmed: true, boxAt: seen() });
    expect(second.status).toBe(200);
  });

  it("the tester's session page: their own call request in another tab AND the developer's Pay stop a call request once together; the second press goes", async () => {
    const { dev, testId } = await setup({ recordingCents: "5.00" });
    const { tester, sessionId } = await joined(testId);
    expect((await sact(sessionId, "written", tester.cookie, { answers: LONG })).status).toBe(200);
    await later();
    const pageLoaded = seen();
    await later();
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), startsAt: new Date(Date.now() + 90 * 3_600_000).toISOString(), tab: "tab-a" })).status).toBe(200);
    await later();
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
    const first = await sact(sessionId, "request-time", tester.cookie, { seenAt: pageLoaded, startsAt: new Date(Date.now() + 100 * 3_600_000).toISOString(), tab: "tab-b" });
    expect(first.body.error.code).toBe("stop_once");
    const t = texts(first);
    expect(t[0]).toMatch(/^You requested a call for .* in another tab$/);
    expect(t[1]).toBe("Nora Lane paid $10.00 for your written answers");
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: pageLoaded, startsAt: new Date(Date.now() + 100 * 3_600_000).toISOString(), tab: "tab-b", confirmed: true, boxAt: seen() })).status).toBe(200);
  });

  it("the join page: an application sent in another tab AND the developer's listing edit stop Withdraw once together; the second press goes", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    await later();
    const pageLoaded = seen();
    await later();
    expect((await act(testId, "apply", ana.cookie, { seenAt: seen(), note: "Hi", tab: "tab-a" })).status).toBe(200);
    await later();
    expect((await edit(testId, dev.cookie, { productName: "Harbor Run 2" })).status).toBe(200); // the product name doesn't close applications
    const first = await act(testId, "withdraw-application", ana.cookie, { seenAt: pageLoaded, tab: "tab-b" });
    expect(first.body.error.code).toBe("stop_once");
    expect(texts(first)).toEqual(["You applied to join in another tab", expect.stringMatching(saveRe("Nora Lane", "product name"))]);
    expect((await act(testId, "withdraw-application", ana.cookie, { seenAt: pageLoaded, tab: "tab-b", confirmed: true, boxAt: first.body.error.now })).status).toBe(200);
  });

  it("(wave 2, §17) a key given by the developer's Save, the tester's own call request in another tab and the listing save stop a press together, oldest first", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await later();
    const pageLoaded = seen();
    await later();
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), startsAt: new Date(Date.now() + 90 * 3_600_000).toISOString(), tab: "tab-a" })).status).toBe(200);
    await later();
    expect((await edit(testId, dev.cookie, { description: "Sail on and on" }, { keysAdd: ["K1", "K2", "K3"] })).status).toBe(200);
    const first = await sact(sessionId, "request-time", tester.cookie, { seenAt: pageLoaded, startsAt: new Date(Date.now() + 100 * 3_600_000).toISOString(), tab: "tab-b" });
    expect(first.body.error.code).toBe("stop_once");
    const t = texts(first);
    expect(t[0]).toMatch(/^You requested a call for .* in another tab$/);
    expect(t.slice(1)).toEqual(expect.arrayContaining(["Nora Lane gave you an access key for “Harbor Run”", expect.stringMatching(saveRe("Nora Lane", "description"))]));
    expect(t).toHaveLength(3);
    expect(ats(first)).toEqual([...ats(first)].sort((a, b) => a - b));
    // The top box has the same lines.
    const l = await live(tester.cookie, `session:${sessionId}`, pageLoaded);
    expect(l.body.changes.map((c: { text: string }) => c.text)).toEqual(expect.arrayContaining(t.slice(1)));
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: pageLoaded, startsAt: new Date(Date.now() + 100 * 3_600_000).toISOString(), tab: "tab-b", confirmed: true, boxAt: seen() })).status).toBe(200);
  });

  it("a stop never swallows the other changes: Pay on a page opened before the Stop lists the stop AND a tester's work sent", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await later();
    const pageLoaded = seen();
    await later();
    expect((await sact(sessionId, "written", tester.cookie, { answers: LONG })).status).toBe(200);
    await later();
    expect((await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true, tab: "tab-a" })).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const body = { payKey: randomUUID(), kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000, seenAt: pageLoaded, tab: "tab-b" };
    const first = await reviewPOST(req("/api/review", { cookie: dev.cookie, body })).then(json);
    expect(first.body.error.code).toBe("stop_once");
    const t = texts(first);
    expect(t[0]).toBe("Ana Silva sent her written answers");
    expect(t.slice(1).join(" | ")).toMatch(/stopped/);
    expect((await reviewPOST(req("/api/review", { cookie: dev.cookie, body: { ...body, confirmed: true, boxAt: seen() } })).then(json)).status).toBe(200);
  });
});

describe("batch 30 §9: a locked field's change is named, and locked boxes are really locked", () => {
  it("the line names the change with its values; long fields are named without their text", () => {
    expect(lockedChangeLine("parts", [{ key: "liveRate", name: "live call rate", before: "$24.00/h", now: "$30.00/h" }])).toBe(
      "Your change to the live call rate ($24.00/h → $30.00/h) can't be saved: you've changed the parts and prices 3 times since testers joined.",
    );
    expect(lockedChangeLine("parts", [{ key: "writtenPrice", name: "price for written answers", before: "$5.00", now: "$6.00" }, { key: "live", name: "live session", before: "on", now: "off" }])).toBe(
      "Your changes to the price for written answers ($5.00 → $6.00) and the live session (on → off) can't be saved: you've changed the parts and prices 3 times since testers joined.",
    );
    expect(lockedChangeLine("description", [{ key: "description", name: "instructions" }])).toBe("Your change to the instructions can't be saved: you've changed the steps 3 times since testers joined.");
  });

  it("every input of a locked group is disabled; the line at Save has Put it back; the server still refuses the locked change and saves the rest once it's put back", async () => {
    const form = src("app/app/tests/TestForm.tsx");
    expect(form).toContain('id={`high-${part.key}`} disabled={pl}');
    expect(form).toContain('disabled={!on || free || pl}');
    expect(form).toContain('data-put-back={c} onClick={() => putBack(items.map((i) => i.key))}>Put it back</button>');
    expect(form).toContain("lockedChangeParts(c, items)");
    // Server: the parts and prices used their 3 changes (another tab's Save locked them).
    const { dev, testId } = await setup();
    await joined(testId);
    for (const cents of ["11.00", "12.00", "13.00"]) expect((await edit(testId, dev.cookie, { writtenCents: cents })).status).toBe(200);
    const refused = await edit(testId, dev.cookie, { liveRateCents: "40.00", description: "New steps" });
    expect(refused.status).toBe(400);
    expect(refused.body.error.errors).toContain("You've changed the parts and prices 3 times since testers joined. Contact us in Settings to change it again.");
    // Put it back: the rate as saved; the other change saves.
    expect((await edit(testId, dev.cookie, { description: "New steps" })).status).toBe(200);
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect(t.description).toBe("New steps");
    expect(t.liveRateCents).toBe(3000);
  });
});
