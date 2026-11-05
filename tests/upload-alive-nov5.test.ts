import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { STILL_UPLOADING } from "@/lib/server/recordings";
import { joined, sact, seen, setup } from "./fixtures";

const read = (f: string) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");
const start = (sessionId: string, cookie: string, extra: Record<string, unknown> = {}) => sact(sessionId, "recording-start", cookie, { size: 4, contentType: "video/mp4", filename: "a.mp4", ...extra });

describe("(Owner, Nov 5) an unfinished upload holds Send only while its page keeps saying it's still going", () => {
  it("a cut-off upload stops holding Send after 2 minutes; one still heard from keeps holding it; another tester's press can't keep it alive", async () => {
    const s = await setup({ recordingCents: "12.00" });
    const j = await joined(s.testId);
    const done = (await start(j.sessionId, j.tester.cookie)).body.recordingId as string;
    await sact(j.sessionId, "recording-done", j.tester.cookie, { recordingId: done });
    const stuck = (await start(j.sessionId, j.tester.cookie, { filename: "b.mp4" })).body.recordingId as string;
    // Just started: Send waits.
    expect((await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true })).body.error.message).toBe(STILL_UPLOADING);
    // Its page said "still going" a minute ago: still waits.
    await db.recording.update({ where: { id: stuck }, data: { aliveAt: new Date(Date.now() - 60_000) } });
    expect((await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true })).body.error.message).toBe(STILL_UPLOADING);
    // The page says so again.
    await db.recording.update({ where: { id: stuck }, data: { aliveAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await sact(j.sessionId, "recording-alive", j.tester.cookie, { recordingId: stuck })).body).toMatchObject({ alive: true });
    expect((await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true })).body.error.message).toBe(STILL_UPLOADING);
    // Not heard from for over 2 minutes (a reload or a closed tab cut it off): Send goes, with the finished one only.
    await db.recording.update({ where: { id: stuck }, data: { aliveAt: new Date(Date.now() - 3 * 60_000) } });
    expect((await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    const sent = await db.recording.findMany({ where: { contractId: j.sessionId, submissionId: { not: null } } });
    expect(sent.map((r) => r.id)).toEqual([done]);
    // A finished upload can't be "kept alive".
    expect((await sact(j.sessionId, "recording-alive", j.tester.cookie, { recordingId: done })).body).toMatchObject({ alive: false });
  });

  it("the written part's Send waits the same way", async () => {
    const s = await setup({ recordingCents: "12.00" });
    const j = await joined(s.testId);
    const w = (await start(j.sessionId, j.tester.cookie, { part: "written" })).body.recordingId as string;
    const live = await db.recording.count({ where: { contractId: j.sessionId, ...(await import("@/lib/server/recordings")).stillUploading("written") } });
    expect(live).toBe(1);
    await db.recording.update({ where: { id: w }, data: { aliveAt: new Date(Date.now() - 3 * 60_000) } });
    expect(await db.recording.count({ where: { contractId: j.sessionId, ...(await import("@/lib/server/recordings")).stillUploading("written") } })).toBe(0);
  });

  it("the page says it's still going every 20 s and drops the upload when it's left mid-upload", () => {
    const src = read("src/lib/upload.ts");
    expect(src).toMatch(/recording-alive[\s\S]*20_000/);
    expect(src).toMatch(/addEventListener\("pagehide", leave\)/);
    expect(src).toMatch(/recording-abandon`, \{ method: "POST", keepalive: true/);
  });
});

describe("(Owner, Nov 5) long names never widen the page", () => {
  it("names inside buttons and badges break anywhere; heading boxes keep 12rem; cut names keep their full text", () => {
    expect(read("src/components/ReportButton.tsx")).toContain('<span className="[overflow-wrap:anywhere]">Report {name}</span>');
    expect(read("src/components/BlockButton.tsx")).toContain('<span className="[overflow-wrap:anywhere]">Block {name}</span>');
    expect(read("src/components/BlockButton.tsx")).toContain('<span className="[overflow-wrap:anywhere]">{name ? `Unblock ${name}` : "Unblock"}</span>');
    expect(read("src/components/ConfirmButton.tsx")).toContain('<span className="min-w-0 [overflow-wrap:anywhere]">{confirmLabel}</span>');
    const find = read("src/app/app/find/[id]/page.tsx");
    expect(find).toContain('<div className="flex flex-wrap items-start gap-4">');
    expect(find).toContain("max-w-full border-sky-300/40 text-sky-200 [overflow-wrap:anywhere]");
    for (const f of ["src/app/app/testers/[id]/page.tsx", "src/app/app/developers/[id]/page.tsx"]) expect(read(f)).toMatch(/min-w-\[min\(100%,12rem\)\] flex-1[^"]*">\s*<h1/);
    expect(read("src/lib/server/emailLayout.ts")).toContain("overflow-wrap:anywhere;word-break:break-word;");
    expect(read("src/app/app/account/blocked/page.tsx")).toContain("<Cut text={displayName(x)} />");
    expect(read("src/app/app/layout.tsx")).toContain("title={`${name} · ${u.email}`}");
    expect(read("src/app/admin/layout.tsx")).toContain("max-w-[12rem] truncate");
    expect(read("src/app/app/calls/[id]/CallRoom.tsx")).toContain("max-w-[calc(100%-1.5rem)]");
  });

  it("an email line with a very long name wraps instead of widening the email", async () => {
    const { emailHtml } = await import("@/lib/server/emailLayout");
    const html = emailHtml("Today", `• ${"A".repeat(80)} sent written answers on ${"B".repeat(60)}`, { base: "https://playtestplatform.com" });
    expect(html).toMatch(/<p style="[^"]*overflow-wrap:anywhere;word-break:break-word;[^"]*">• A{80}/);
  });
});
