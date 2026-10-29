import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { LIMITS } from "@/lib/limits";
import * as R from "@/lib/rules";
import { json, makeUser, req } from "./helpers";
import { act, joined, listingBody, sact, seen, setup } from "./fixtures";
import { MAX_ATTACHMENT_BYTES, MAX_RECORDING_BYTES } from "@/lib/server/storage";

// (Owner, Oct 29, batch 31) A flat 10 testers per test: the growing tester limit (10, +10% per 10 good ratings, at most 50) is gone.
const src = (p: string) => readFileSync(path.resolve(__dirname, "..", "src", p), "utf8");
/** The source without its comments (a comment may say what a line was before). */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const post = async (cookie: string, over: Record<string, unknown>) => json(await testsPOST(req("/api/tests", { cookie, body: listingBody(over) })));

describe("batch 31: at most 10 testers per test", () => {
  it("the limit is 10, with its line; the rule refuses 11 and takes 1 to 10", () => {
    expect(LIMITS.spots.max).toBe(10);
    expect(R.MAX_SPOTS).toBe(10);
    expect(R.SPOTS_MAX_LINE).toBe("At most 10 testers per test.");
    const base = { ...listingBody(), writtenCents: 1000, recordingCents: null, liveRateCents: 3000 } as unknown as R.Listing;
    expect(R.checkListing({ ...base, spots: 11 })).toContain(R.SPOTS_MAX_LINE);
    expect(R.checkListing({ ...base, spots: 10 }).some((e) => /spots|testers per test/i.test(e))).toBe(false);
    expect(R.checkListing({ ...base, spots: 0 })).toContain("Spots must be a whole number from 1 to 10.");
    // Edit of a test that already has 20: 20 stays, 21 is refused with the kept line.
    expect(R.checkListing({ ...base, spots: 20 }, 0, new Date(), { savedSpots: 20 }).some((e) => /spots|testers per test/i.test(e))).toBe(false);
    expect(R.checkListing({ ...base, spots: 21 }, 0, new Date(), { savedSpots: 20 })).toContain(R.spotsKeptLine(20));
    expect(R.spotsKeptLine(20)).toBe("At most 10 testers per test. This test keeps its 20 spots: you can lower them, not raise them.");
    // A test at 10 or fewer can go up to 10, never past it.
    expect(R.spotsCap(4)).toBe(10);
    expect(R.checkListing({ ...base, spots: 11 }, 0, new Date(), { savedSpots: 4 })).toContain(R.SPOTS_MAX_LINE);
  });

  it("Post with 11 spots is refused (red at spots); 10 posts, for a new developer and for one with many good ratings", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane", pronoun: "she" });
    const over = await post(dev.cookie, { spots: 11 });
    expect(over.status).toBe(400);
    expect(over.body.error.message).toBe("At most 10 testers per test.");
    expect((await post(dev.cookie, { spots: 10 })).status).toBe(200);
    // A stored older limit (the column stays, unused) no longer lets a developer post more.
    await db.user.update({ where: { id: dev.user.id }, data: { testerLimit: 50 } });
    expect((await post(dev.cookie, { spots: 11, title: "Harbor Run II" })).body.error.message).toBe(R.SPOTS_MAX_LINE);
  });

  it("an existing 20-spot test keeps 20 (other edits save), can't go to 21, can go lower", async () => {
    const { dev, testId } = await setup();
    await db.test.update({ where: { id: testId }, data: { spots: 20 } });
    const v = async () => (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    const spots = async () => (await db.test.findUniqueOrThrow({ where: { id: testId } })).spots;
    expect((await act(testId, "edit", dev.cookie, { version: await v(), fields: { title: "Harbor Run II" }, confirmed: true })).status).toBe(200);
    expect(await spots()).toBe(20);
    const up = await act(testId, "edit", dev.cookie, { version: await v(), fields: { spots: 21 }, confirmed: true });
    expect(up.status).toBe(400);
    expect(up.body.error.message).toBe(R.spotsKeptLine(20));
    expect(await spots()).toBe(20);
    expect((await act(testId, "edit", dev.cookie, { version: await v(), fields: { spots: 15 }, confirmed: true })).status).toBe(200);
    expect(await spots()).toBe(15);
    // Lowered to 15, it can't go back up to 20.
    expect((await act(testId, "edit", dev.cookie, { version: await v(), fields: { spots: 20 }, confirmed: true })).body.error.message).toBe(R.spotsKeptLine(15));
  });

  it("a test at 5 can be edited up to 10, not 11", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const v = async () => (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: await v(), fields: { spots: 11 }, confirmed: true })).body.error.message).toBe(R.SPOTS_MAX_LINE);
    expect((await act(testId, "edit", dev.cookie, { version: await v(), fields: { spots: 10 }, confirmed: true })).status).toBe(200);
  });

  it("Next round of a 20-spot test starts at 10; posting it with 11 is refused", async () => {
    const { dev, testId } = await setup();
    await db.test.update({ where: { id: testId }, data: { spots: 20 } });
    const draft = await act(testId, "next-round", dev.cookie, { seenAt: seen(), confirmed: true });
    expect(draft.status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: draft.body.id } })).spots).toBe(10);
    const r = await act(draft.body.id, "post-draft", dev.cookie, listingBody({ title: "Round 2", spots: 11 }));
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe(R.SPOTS_MAX_LINE);
    // The original keeps its 20.
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).spots).toBe(20);
  });

  it("the tester-limit card and the rating-based growth code are gone; the form says 1–10 and the line; Terms says 10", () => {
    expect(existsSync(path.resolve(__dirname, "..", "src/lib/capacity.ts"))).toBe(false);
    expect(existsSync(path.resolve(__dirname, "..", "src/lib/server/capacity.ts"))).toBe(false);
    const tiles = src("components/ProfileTiles.tsx");
    expect(tiles).not.toMatch(/CapacityCard|tester-limit|Can take up to/);
    expect(src("app/app/profile/page.tsx")).not.toMatch(/CapacityCard/);
    expect(src("lib/server/ratings.ts")).not.toMatch(/revealTimes/);
    const form = src("app/app/tests/TestForm.tsx");
    expect(code("app/app/tests/TestForm.tsx")).not.toMatch(/spotsLimit|limitHint|right now/);
    expect(form).toMatch(/SPOTS_MAX_LINE/);
    for (const p of ["app/app/tests/new/page.tsx", "app/app/tests/[id]/edit/page.tsx"]) expect(src(p)).not.toMatch(/testerCapacity|spotsLimit/);
    const terms = src("app/terms/page.tsx");
    expect(terms).toMatch(/Every test takes at most \$\{MAX_SPOTS\} testers\./);
    expect(terms).not.toMatch(/never more than 50|grows with good ratings/);
  });

  it("unchanged: a tester can be in at most 10 tests at once", () => {
    expect(R.MAX_ACTIVE_TESTS).toBe(10);
  });
});

// (Owner, Oct 29, batch 31 section 2) Files attached to written answers: 500 MB each (was 25 MB); still 5 files; recordings stay 500 MB.
describe("batch 31 section 2: written-answer files up to 500 MB", () => {
  const MB = 1024 * 1024;
  it("500 MB is accepted, 500 MB + 1 byte refused with the updated line; recordings unchanged", async () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(500 * MB);
    expect(MAX_RECORDING_BYTES).toBe(500 * MB);
    const s = await setup({ recordingCents: "5.00" });
    const j = await joined(s.testId);
    const start = (body: Record<string, unknown>) => sact(j.sessionId, "recording-start", j.tester.cookie, body);
    const over = await start({ part: "written", filename: "big.zip", size: 500 * MB + 1, contentType: "application/zip" });
    expect(over.status).toBe(413);
    expect(over.body.error.message).toBe("Files can be at most 500 MB.");
    const ok = await start({ part: "written", filename: "big.pdf", size: 500 * MB, contentType: "application/pdf" });
    expect(ok.status).toBe(200);
    // Recordings: still 500 MB each.
    expect((await start({ part: "recording", filename: "run.mp4", size: 500 * MB + 1, contentType: "video/mp4" })).body.error.message).toBe("Recordings can be at most 500 MB.");
    expect((await start({ part: "recording", filename: "run.mp4", size: 1000, contentType: "video/mp4" })).status).toBe(200);
  });

  it("a failed upload is abandoned: its row goes, the slot is free, and a retry starts clean; a finished one is never removed this way", async () => {
    const s = await setup({ recordingCents: "5.00" });
    const j = await joined(s.testId);
    const start = (body: Record<string, unknown>) => sact(j.sessionId, "recording-start", j.tester.cookie, body);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await start({ part: "written", filename: `f${i}.png`, size: 100, contentType: "image/png" })).body.recordingId);
    expect((await start({ part: "written", filename: "six.png", size: 100, contentType: "image/png" })).body.error.message).toBe("You can attach at most 5 files to your written answers.");
    // The last one's upload failed: the browser abandons it, and the retry goes through.
    const gone = await sact(j.sessionId, "recording-abandon", j.tester.cookie, { recordingId: ids[4] });
    expect(gone.status).toBe(200);
    expect(gone.body.abandoned).toBe(true);
    expect(await db.recording.findUnique({ where: { id: ids[4] } })).toBeNull();
    expect((await start({ part: "written", filename: "f4.png", size: 100, contentType: "image/png" })).status).toBe(200);
    // A finished upload stays (abandon is only for unfinished ones), and another tester can't abandon it.
    await db.recording.update({ where: { id: ids[0] }, data: { uploadedAt: new Date() } });
    expect((await sact(j.sessionId, "recording-abandon", j.tester.cookie, { recordingId: ids[0] })).body.abandoned).toBe(false);
    expect(await db.recording.findUnique({ where: { id: ids[0] } })).not.toBeNull();
    const other = await joined(s.testId, "Ben Okafor", "he");
    expect((await sact(j.sessionId, "recording-abandon", other.tester.cookie, { recordingId: ids[1] })).status).not.toBe(200);
    expect(await db.recording.findUnique({ where: { id: ids[1] } })).not.toBeNull();
    // A recording that failed no longer blocks Send as "still uploading".
    const rec = await start({ part: "recording", filename: "run.mp4", size: 1000, contentType: "video/mp4" });
    await sact(j.sessionId, "recording-abandon", j.tester.cookie, { recordingId: rec.body.recordingId });
    expect(await db.recording.count({ where: { contractId: j.sessionId, part: "recording", uploadedAt: null } })).toBe(0);
  });

  it("the lines: the file box says 500 MB, the client checks 500 MB; the browser abandons a failed upload and the file box can retry the same file", () => {
    const box = src("app/app/sessions/[id]/WrittenAttachments.tsx");
    expect(box).toContain("(images, PDF, text or zip; 500 MB each, 5 at most)");
    expect(box).toContain('file.size > 500 * 1024 * 1024) return setErr(FIELD + "Files can be at most 500 MB.")');
    expect(code("app/app/sessions/[id]/WrittenAttachments.tsx")).not.toMatch(/25 MB/);
    expect(box).toContain('e.target.value = ""');
    expect(src("app/api/recordings/[id]/upload/route.ts")).toContain('MAX_ATTACHMENT_BYTES, "Files can be at most 500 MB."');
    const up = src("lib/upload.ts");
    expect(up).toContain("recording-abandon");
    expect(up).toContain("onProgress?.(Math.round((e.loaded / e.total) * 100))");
    expect(src("app/app/sessions/[id]/RecordingUpload.tsx")).toContain("Or upload a recording (video, up to 500 MB; 5 at most)");
  });
});
