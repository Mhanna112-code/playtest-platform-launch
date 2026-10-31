import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { GET as healthGET } from "@/app/api/health/route";
import { bellKey } from "@/lib/bell";
import { startHold } from "@/lib/server/holds";
import { closeJoiningAfterOpenUntil } from "@/lib/server/tests";
import { T, renderTimes } from "@/lib/tz";
import {
  STORAGE_DEGRADED_KEYWORD, STORAGE_STATE_KEY, checkStorage, measureStorage, sizeText, storageAlerts, storageBellLine, storageBoxLine,
} from "@/lib/server/storageAlerts";
import { makeUser } from "./helpers";
import { act, bookCall, joined, sact, seen, settle, setup } from "./fixtures";

// Batch 30 (owner, Oct 29): §35 storage running out, §4 the developer's Rate rule that can never apply, §6 leftovers from the batch 29 design doc check, §13 leftovers
// from batch 31.
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const later = () => new Promise((r) => setTimeout(r, 30));
const again = () => ({ confirmed: true, boxAt: new Date().toISOString() });
const GB = 1_000_000_000;
/** (Batch 30 §14 asks 50+ characters per answer: these are long enough either way.) */
const ANSWERS = ["The boat handles well and the first harbor felt clear to me.", "I got stuck at the second bridge: the jump needs a hint there."];
async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}

describe("batch 30 §35: storage running out tells the admins, inside and outside the app", () => {
  const ping = () => healthGET(new Request("http://localhost:3400/api/health?key=test-health-key-30"));
  const bells = (userId: string) => db.notification.findMany({ where: { userId, text: { startsWith: "Storage is filling up" } }, orderBy: { createdAt: "asc" } });
  beforeEach(async () => {
    await db.appState.deleteMany({ where: { key: STORAGE_STATE_KEY } });
    vi.stubEnv("HEALTH_KEY", "test-health-key-30");
    vi.stubEnv("RESEND_API_KEY", "");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.appState.deleteMany({ where: { key: STORAGE_STATE_KEY } });
  });

  it("the lines: the owner's examples, in decimal units", () => {
    expect(storageBoxLine("database", { bytes: 410_000_000, limit: 0.5 * GB })).toBe("Storage is 82% full: database 410 MB of 500 MB.");
    expect(storageBoxLine("uploads", { bytes: 8.5 * GB, limit: 10 * GB })).toBe("Uploads are 85% full: 8.5 GB of 10 GB.");
    expect(storageBellLine("database", 82)).toBe("Storage is filling up (database 82%)");
    expect(storageBellLine("uploads", 85)).toBe("Storage is filling up (uploads 85%)");
    expect(sizeText(1 * GB)).toBe("1 GB");
  });

  it("limits unset: nothing is checked (no state, no box, no keyword)", async () => {
    vi.stubEnv("DB_STORAGE_LIMIT_GB", "");
    vi.stubEnv("UPLOADS_LIMIT_GB", "");
    const a = await admin();
    expect(await checkStorage(new Date(), { database: 99 * GB, uploads: 99 * GB })).toEqual({ at: expect.any(String) });
    expect(await db.appState.findUnique({ where: { key: STORAGE_STATE_KEY } })).toBeNull();
    expect((await storageAlerts()).lines).toEqual([]);
    expect(await bells(a.user.id)).toEqual([]);
    expect(await (await ping()).json()).toEqual({ ok: true, emails: "sending" });
  });

  it("79% → nothing; 81% → the box, one bell line, the health keyword; still over → no second line; back under → gone; crossing again → a new line", async () => {
    vi.stubEnv("DB_STORAGE_LIMIT_GB", "1");
    vi.stubEnv("UPLOADS_LIMIT_GB", "");
    const a = await admin();
    await checkStorage(new Date(), { database: 0.79 * GB });
    expect((await storageAlerts()).lines).toEqual([]);
    expect(await bells(a.user.id)).toEqual([]);
    expect(await (await ping()).json()).toEqual({ ok: true, emails: "sending" });

    await checkStorage(new Date(), { database: 0.81 * GB });
    expect((await storageAlerts()).lines).toEqual([{ kind: "database", line: "Storage is 81% full: database 810 MB of 1 GB." }]);
    let b = await bells(a.user.id);
    expect(b.map((n) => [n.text, n.link, n.own])).toEqual([["Storage is filling up (database 81%)", "/admin#storage", true]]);
    const r = await ping();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, emails: "sending", storage: STORAGE_DEGRADED_KEYWORD });

    await checkStorage(new Date(), { database: 0.86 * GB });
    expect((await storageAlerts()).lines[0].line).toBe("Storage is 86% full: database 860 MB of 1 GB.");
    expect(await bells(a.user.id)).toHaveLength(1); // one per crossing

    await checkStorage(new Date(), { database: 0.5 * GB });
    expect((await storageAlerts()).lines).toEqual([]);
    expect(await (await ping()).json()).toEqual({ ok: true, emails: "sending" });

    await checkStorage(new Date(), { database: 0.8 * GB });
    b = await bells(a.user.id);
    expect(b.map((n) => n.text)).toEqual(["Storage is filling up (database 81%)", "Storage is filling up (database 80%)"]);
  });

  it("uploads have their own limit and line; a limit removed later stops the box at once", async () => {
    vi.stubEnv("DB_STORAGE_LIMIT_GB", "");
    vi.stubEnv("UPLOADS_LIMIT_GB", "10");
    const a = await admin();
    await checkStorage(new Date(), { uploads: 8.5 * GB });
    expect((await storageAlerts()).lines).toEqual([{ kind: "uploads", line: "Uploads are 85% full: 8.5 GB of 10 GB." }]);
    expect((await bells(a.user.id)).map((n) => n.text)).toEqual(["Storage is filling up (uploads 85%)"]);
    vi.stubEnv("UPLOADS_LIMIT_GB", "");
    expect((await storageAlerts()).lines).toEqual([]);
  });

  it("the real measurement: the database's size and the stored uploads (only finished ones)", async () => {
    const before = await measureStorage();
    expect(before.database).toBeGreaterThan(0);
    const s = await setup();
    const j = await joined(s.testId);
    await db.recording.create({ data: { contractId: j.sessionId, storageKey: `k-${randomUUID()}`, filename: "a.mp4", sizeBytes: 1234, contentType: "video/mp4", uploadedAt: new Date() } });
    await db.recording.create({ data: { contractId: j.sessionId, storageKey: `k-${randomUUID()}`, filename: "b.mp4", sizeBytes: 999, contentType: "video/mp4" } });
    expect((await measureStorage()).uploads - before.uploads).toBe(1234);
  });

  it("the daily job runs it; the admin console's red box", () => {
    expect(src("lib/server/holds.ts")).toContain('(await import("./storageAlerts")).checkStorage(now)');
    const page = src("app/admin/page.tsx");
    expect(page).toContain('id="storage" data-storage-box=""');
    expect(page).toContain("Measured once a day (last {clock(storage.at)}). The uptime monitor&apos;s keyword alert tells you outside the app too.");
  });
});

describe("batch 30 §4: the developer's Rate has no call-change rule", () => {
  it("removed from the gate (it could never apply)", () => {
    const r = src("lib/server/ratings.ts");
    const dev = r.slice(r.indexOf("async function devRateGate"), r.indexOf("function refuse("));
    expect(dev).not.toContain('"requested", "booked"');
    expect(dev).not.toContain("ignoredAlerts");
  });
});

describe("batch 30 §6: leftovers from the batch 29 design doc check", () => {
  it("Pay now and Closing soon open the dashboard at Needs review (marked by HashJump)", () => {
    const h = src("lib/server/holds.ts");
    expect(h).not.toContain('"/app#needs-you"');
    expect(h.match(/"\/app#needs-review", \{ side: "developer", always: true, payment: true, group: "(closeout|unreviewed)"/g)).toHaveLength(2);
    expect(src("app/app/page.tsx")).toContain('id="needs-review"');
    expect(src("app/app/layout.tsx")).toContain("<HashJump />");
  });

  it("Open until passing: “<test>” closed to new testers on <date>., stacked in Applications and invites across tests", async () => {
    const one = await setup();
    const two = await setup({ title: "Reef Dash", productName: "Reef Dash" });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    for (const s of [one, two]) expect((await act(s.testId, "invite", s.dev.cookie, { testerIds: [ana.user.id], seenAt: seen(), confirmed: true })).status).toBe(200);
    const ou = new Date(Date.now() - 60_000);
    await db.test.updateMany({ where: { id: { in: [one.testId, two.testId] } }, data: { openUntil: ou } });
    await closeJoiningAfterOpenUntil();
    const lines = await db.notification.findMany({ where: { userId: ana.user.id, text: { contains: "closed to new testers" } } });
    const date = renderTimes(T(ou, "date"), ana.user.timeZone);
    expect(lines.map((l) => l.text).sort()).toEqual([`“Harbor Run” closed to new testers on ${date}.`, `“Reef Dash” closed to new testers on ${date}.`]);
    expect(lines.every((l) => l.groupKey === "apps")).toBe(true);
    expect(new Set(lines.map(bellKey)).size).toBe(1);
  });

  it("Your invite to “<test>” was closed. is a bell line in Applications and invites (Cancel invite, a stop, a pause), never why", async () => {
    const one = await setup();
    const two = await setup({ title: "Reef Dash", productName: "Reef Dash" });
    const three = await setup({ title: "Kelp Kart", productName: "Kelp Kart" });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    for (const s of [one, two, three]) expect((await act(s.testId, "invite", s.dev.cookie, { testerIds: [ana.user.id], seenAt: seen(), confirmed: true })).status).toBe(200);
    const inv = await db.invite.findFirstOrThrow({ where: { testId: one.testId, testerId: ana.user.id, status: "sent" } });
    expect((await act(one.testId, "cancel-invite", one.dev.cookie, { inviteId: inv.id, seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await act(two.testId, "stop", two.dev.cookie, { reason: "We have what we need.", seenAt: seen(), confirmed: true })).status).toBe(200);
    await startHold(three.dev.user.id, "unpaid");
    const lines = await db.notification.findMany({ where: { userId: ana.user.id, text: { startsWith: "Your invite to" } } });
    expect(lines.map((l) => l.text).sort()).toEqual(["Your invite to “Harbor Run” was closed.", "Your invite to “Kelp Kart” was closed.", "Your invite to “Reef Dash” was closed."]);
    expect(lines.every((l) => l.groupKey === "apps" && l.link.startsWith("/app/find/"))).toBe(true);
    expect(new Set(lines.map(bellKey)).size).toBe(1);
    // The live box says the same line.
    expect(src("app/api/live/route.ts")).toContain("text: inviteClosedLine(i.test.title)");
  });

  it("the dashboard Calls box's Cancel sends the page's seen marker and stops once like the test page's", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    const call = await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 120); // (a hold cancels calls within 3 days)
    await settle();
    const loaded = seen();
    await later();
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ANSWERS, seenAt: seen(), confirmed: true })).status).toBe(200);
    await startHold(s.dev.user.id, "unpaid"); // the box has Cancel itself while the developer is held (sending waits during a pause: sent before it)
    const first = await act(s.testId, "cancel-call", s.dev.cookie, { callId: call.id, reason: "", seenAt: loaded });
    expect(first.body.error.code).toBe("stop_once");
    expect(first.body.error.changes.map((c: { text: string }) => c.text).some((t: string) => t.startsWith("Ana Silva sent"))).toBe(true);
    await later();
    const second = await act(s.testId, "cancel-call", s.dev.cookie, { callId: call.id, reason: "", seenAt: loaded, ...again() });
    expect(second.body).toEqual({ cancelled: true });
    // usePress adds the page's seenAt (and confirmed / boxAt on the second press) to every press of the box.
    const box = src("app/app/CallsBox.tsx");
    expect(box).toContain("usePress(seenAt)");
    expect(src("lib/usePress.ts")).toContain("{ ...body, seenAt, confirmed:");
  });

  it("Go to the next round stops once after Open until passed too (no skip)", async () => {
    const s = await setup();
    const j = await joined(s.testId, "fbbb", "they");
    const made = await act(s.testId, "next-round", s.dev.cookie, { seenAt: seen(), confirmed: true });
    expect(made.status).toBe(200);
    await settle();
    const loaded = seen();
    await later();
    expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ANSWERS, seenAt: seen(), confirmed: true })).status).toBe(200);
    await db.test.update({ where: { id: s.testId }, data: { openUntil: new Date(Date.now() - 60_000) } });
    const first = await act(s.testId, "go-next-round", s.dev.cookie, { seenAt: loaded });
    expect(first.body.error.code).toBe("stop_once");
    expect(first.body.error.changes.map((c: { text: string }) => c.text)).toContain("fbbb sent their written answers");
    await later();
    const second = await act(s.testId, "go-next-round", s.dev.cookie, { seenAt: loaded, ...again() });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(made.body.id);
    expect(src("lib/server/tests.ts")).not.toContain("const closed = !!t.openUntil && t.openUntil.getTime() < Date.now();");
  });

  it("dead code is gone; the session route's comment says Dispute is the limited view's only press", () => {
    const bell = src("lib/bell.ts");
    for (const g of ["textra", "appclosed", "reinvited", "team", "disputes", "trejected"]) expect(bell).not.toMatch(new RegExp(`^\\s+${g}:`, "m"));
    const rules = src("lib/rules.ts");
    for (const f of ["bankConfirmLine", "bankConfirmTestLine", "chargeByLine", "payByLine"]) expect(rules).not.toMatch(new RegExp(`export const ${f}\\b`));
    const route = src("app/api/sessions/[id]/[action]/route.ts");
    expect(route).not.toMatch(/still\s+\* work \(on the first press\)/);
    expect(route).toMatch(/where Dispute is the only\s+\* press, under the same stop-once rules as everywhere/);
  });
});

describe("batch 30 §13: leftovers from batch 31", () => {
  it("LEAN-SPEC describes the flat 10; media.cjs no longer says 50", () => {
    const lean = fs.readFileSync(path.resolve(__dirname, "../LEAN-SPEC.md"), "utf8");
    expect(lean).toContain("Every test takes at most 10 testers");
    expect(lean).not.toContain("max 50; never shrinks");
    const media = fs.readFileSync(path.resolve(__dirname, "../scripts/media.cjs"), "utf8");
    expect(media).not.toContain("one who earned more has up to 50");
  });
  it("batch 23's daily-limit test runs on a pinned clock (noon UTC)", () => {
    const t = fs.readFileSync(path.resolve(__dirname, "batch23.test.ts"), "utf8");
    expect(t).toContain("const t0 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12));");
  });
});
