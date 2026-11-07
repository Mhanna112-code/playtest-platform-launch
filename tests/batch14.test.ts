import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as pulseGET } from "@/app/api/pulse/route";
import { POST as testsPOST } from "@/app/api/tests/route";
import * as R from "@/lib/rules";
import { CRITICAL_FIELDS, countersOf, countingSince, countsOf, criticalLine } from "@/lib/limits";
import { groupTitle } from "@/lib/bell";
import { CLOSING_FIELDS } from "@/lib/server/tests";
import { devChanges } from "@/lib/server/live";
import { decideTerms } from "@/lib/server/terms";
import { json, makeUser, req } from "./helpers";
import { act, joined, listingBody, sact, seen, settle, setup } from "./fixtures";

// Batch 14 (owner, Oct 29): the 3-change limit on two more fields (the build link; the parts and prices), counted from when anyone is affected (batch 35 §66: from the first join); applicants and invited
// testers told in stacked lines; a quieter Switch / Keep; 50,000-character written parts; the read-only Access keys notice.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const edit = async (testId: string, cookie: string, fields: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  return act(testId, "edit", cookie, { version: v, fields, seenAt: seen(), confirmed: true, ...extra });
};
const counts = async (testId: string) => countsOf((await db.test.findUniqueOrThrow({ where: { id: testId } })).criticalCounts);

describe("batch 14 section 1: the build link and the parts and prices are limited fields", () => {
  it("each has its own 3 changes; one Save changing several part settings uses one change", async () => {
    expect(CRITICAL_FIELDS).toMatchObject({ buildUrl: "build link", parts: "parts and prices" });
    expect(countersOf(["writtenCents", "writtenRequired", "liveMinutes", "description"]).sort()).toEqual(["description", "parts"]);
    const { dev, testId } = await setup();
    await joined(testId);
    expect((await edit(testId, dev.cookie, { writtenCents: "11.00", writtenRequired: true, liveRateCents: "31.00" })).status).toBe(200);
    expect((await counts(testId)).parts).toBe(1);
    for (const p of ["12.00", "13.00"]) expect((await edit(testId, dev.cookie, { writtenCents: p })).status).toBe(200);
    const fourth = await edit(testId, dev.cookie, { recordingCents: "5.00" });
    expect(fourth.body.error.message).toBe(criticalLine("parts"));
    for (const u of ["https://example.com/2", "https://example.com/3", "https://example.com/4"]) expect((await edit(testId, dev.cookie, { buildUrl: u })).status).toBe(200);
    expect((await edit(testId, dev.cookie, { buildUrl: "https://example.com/5" })).body.error.message).toBe("You've changed the build link 3 times since testers joined. Contact us in Settings to change it again.");
    const f = src("app/app/tests/TestForm.tsx");
    expect(f).toContain('{left("parts")}');
    expect(f).toContain('after: left("buildUrl")');
    expect(f).toContain('disabled={!on || free || pl}');
  });
});

describe("batch 14 section 2 (batch 35 §66): the count starts when the first tester joins", () => {
  it("edits before anyone joined are free (an application doesn't start it); the first join does, and it keeps counting after they leave", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    expect((await edit(testId, dev.cookie, { description: "Sail around" })).status).toBe(200);
    expect((await counts(testId)).description).toBe(0);
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    expect((await act(testId, "apply", ana.cookie, { note: "I love boat games" })).status).toBe(200);
    expect(countingSince((await db.test.findUniqueOrThrow({ where: { id: testId } })).criticalCounts)).toBeNull();
    expect((await edit(testId, dev.cookie, { description: "Sail around the bay" })).status).toBe(200);
    expect((await counts(testId)).description).toBe(0);
    await db.test.update({ where: { id: testId }, data: { joinMode: "anyone" } });
    const j = await joined(testId, "Ben Ward");
    expect(countingSince((await db.test.findUniqueOrThrow({ where: { id: testId } })).criticalCounts)).not.toBeNull();
    await sact(j.sessionId, "leave", j.tester.cookie, { seenAt: seen(), confirmed: true });
    expect((await edit(testId, dev.cookie, { description: "Sail around the whole bay" })).status).toBe(200);
    expect((await counts(testId)).description).toBe(1);
  });
});

describe("batch 14 section 3: applicants and invited testers are told, stacked", () => {
  it("a build-link change closes applications and re-sends invites; (batch 29 §23) their lines stack across tests in 'Applications and invites'", async () => {
    expect(CLOSING_FIELDS).toContain("buildUrl");
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    for (const title of ["Harbor Run", "Reef Dash"]) {
      const { dev, testId } = await setup({ joinMode: "apply", title });
      await act(testId, "apply", ana.cookie, { note: "Hi" });
      await settle();
      expect((await edit(testId, dev.cookie, { buildUrl: "https://example.com/new" })).status).toBe(200);
    }
    const lines = await db.notification.findMany({ where: { userId: ana.user.id, groupKey: "apps" } });
    expect(lines.map((l) => l.text).sort()).toEqual(["“Harbor Run”'s listing changed, so your application was closed. You can apply again on the current listing.", "“Reef Dash”'s listing changed, so your application was closed. You can apply again on the current listing."]);
    // (Batch 30 §6) The old "Applications closed" / "Invites sent again" stacks are gone (batch 29 §23: "Applications and invites").
    expect(groupTitle("appclosed", 2)).toBeUndefined();
    expect(groupTitle("reinvited", 3)).toBeUndefined();
    // Re-sent invites.
    const { dev, testId } = await setup({ joinMode: "invite" });
    const ben = await makeUser({ tester: true, name: "Ben Ward" });
    await act(testId, "invite", dev.cookie, { testerIds: [ben.user.id], seenAt: seen(), confirmed: true });
    await settle();
    expect((await edit(testId, dev.cookie, { buildUrl: "https://example.com/v2" })).status).toBe(200);
    expect(await db.notification.findFirstOrThrow({ where: { userId: ben.user.id, groupKey: "apps" } })).toMatchObject({ text: "Nora Lane updated “Harbor Run”: your invite was sent again on the new listing." });
  });
});

describe("batch 14 section 4: a quieter Switch / Keep", () => {
  it("Keep tells the developer nothing; Switch is one quiet live-box line (stacked per day) and never stops a press", async () => {
    expect(R.DEV_STOP_KINDS).not.toContain("terms");
    expect(R.DEV_QUIET_KINDS).toEqual(["terms", "rated", "sentpaid", "req_dropped", "withdrew_req", "req_closed", "withdrew_app"]); // (§184 req_dropped; §185 a tester's withdrawal) (batch 20 section 24) a rating by a tester whose part had ended; (batch 30 §2) an update at the cap
    const { dev, testId } = await setup();
    const a = await joined(testId, "Ana Silva");
    const b = await joined(testId, "Ben Ward", "he");
    const c = await joined(testId, "Cleo Hart");
    expect((await edit(testId, dev.cookie, { writtenCents: "12.00" })).status).toBe(200);
    const since = new Date();
    await settle();
    for (const [x, choice] of [[a, "switch"], [b, "switch"], [c, "keep"]] as const) {
      const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: x.sessionId, status: "open" } });
      await decideTerms({ id: x.tester.user.id }, x.sessionId, { offerId: offer.id, choice, seenAt: seen(), confirmed: true });
    }
    expect(await db.testEvent.count({ where: { testId, kind: "terms", text: { contains: "kept" } } })).toBe(0);
    expect((await devChanges(dev.user.id, testId, since, "")).filter((e) => e.kind === "terms")).toEqual([]);
    const live = (await devChanges(dev.user.id, testId, since, "", db, { all: true })).filter((e) => e.kind === "terms");
    expect(live.map((e) => e.text)).toEqual(["2 testers switched to the new terms"]);
    expect(R.switchedLine(1, "Ana Silva")).toBe("Ana Silva switched to the new terms");
    // A press with a page loaded before the switches goes through.
    expect((await act(testId, "stop", dev.cookie, { reason: "We have what we need.", seenAt: since.toISOString() })).status).toBe(200);
    expect(src("lib/alerts.ts")).not.toContain('case "terms"');
  });
});

describe("batch 14 section 5: written answers up to 20,000 characters (owner, Nov 4, §186; was 50,000)", () => {
  it("the limit and the counter", () => {
    expect(R.WRITTEN_MAX_CHARS).toBe(20_000);
    expect(R.checkWrittenLength(["a".repeat(20_001)])).toMatchObject({ ok: false, message: "Your written answers can be at most 20,000 characters in all (now 20,001)." });
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain("{WRITTEN_MAX_CHARS.toLocaleString(\"en-US\")}");
  });
});

describe("batch 14 section 6: access keys, no Assign a free key", () => {
  it("Assign is gone; (§304) no key report either; the read-only notice lists free and given keys", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane", pronoun: "she" });
    const r = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ spots: 2, accessKeys: "K1\nK2\nK3" }) })));
    const testId = r.body.id as string;
    await settle();
    const before = (await json(await pulseGET(req(`/api/pulse?test=${testId}`, { method: "GET", cookie: dev.cookie })))).body.v;
    const a = await joined(testId, "Ana Silva");
    const after = (await json(await pulseGET(req(`/api/pulse?test=${testId}`, { method: "GET", cookie: dev.cookie })))).body.v;
    expect(after).not.toBe(before);
    const since = new Date();
    await settle();
    // (Owner, Nov 6, §304) "This key doesn't work" is gone: the press is no route, and nothing replaces a key or tells the developer.
    expect((await sact(a.sessionId, "key-broken", a.tester.cookie, { seenAt: seen() })).status).toBe(404);
    expect((await db.accessKey.findFirstOrThrow({ where: { testId, value: "K1" } })).status).toBe("inuse");
    expect(await db.accessKey.count({ where: { testId, status: "free" } })).toBe(2);
    expect(await db.notification.count({ where: { userId: dev.user.id, text: { contains: "access key" } } })).toBe(0);
    expect((await devChanges(dev.user.id, testId, since, "", db, { all: true })).some((e) => e.kind === "key")).toBe(false);
    expect((await act(testId, "assign-key", dev.cookie, { contractId: a.sessionId, seenAt: seen(), confirmed: true })).status).toBeGreaterThanOrEqual(400);
    const notice = src("app/app/tests/[id]/KeysNotice.tsx");
    for (const s of ["Access keys", "Free (not given to anyone yet)", "Given", "max-h-[5.5rem]", "sm:grid-cols-2", "edit#keys", 'target="_blank"', "each new tester gets one."]) expect(notice).toContain(s);
    expect(notice).not.toContain("<button");
    expect(notice).not.toContain("line-through"); // (§304) nothing crossed out
    expect(src("lib/keys.ts")).toContain("If a tester's key doesn't work, delete a free key ");
    expect(fs.readFileSync(path.resolve(__dirname, "../src/lib/server/accessKeys.ts"), "utf8")).not.toContain("assignFreeKey");
    // A key in use still can't be added again.
    expect((await edit(testId, dev.cookie, {}, { keysAdd: ["K1"] })).status).toBe(400);
  });
});
