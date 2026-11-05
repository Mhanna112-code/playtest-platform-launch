import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { SentWork } from "@/components/SentWork";
import { joined, sact, seen, setup } from "./fixtures";

// (Owner, Nov 5, batch 35 §239) Testers no longer add a note when sending recordings: no notes box, nothing stored, and an old recording's stored notes never shown
// (no migration). The written part's notes ("Anything else") are not affected.

(globalThis as unknown as { React: typeof React }).React = React;
vi.mock("next/navigation", () => ({ usePathname: () => "/app", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams() }));
const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../src", p), "utf8");

describe("§239 recordings carry no notes", () => {
  it("an old recording's stored notes are never shown (the developer's views and the admin's See the work all draw SentWork); the written part's notes still are", () => {
    const files = [{ id: "f1aaaa", filename: "run.mp4", contentType: "video/mp4", sizeBytes: 10, part: "recording", uploadedAt: new Date() }];
    const r = renderToStaticMarkup(createElement(SentWork, { timeZone: "UTC", kind: "recording", answers: [], notes: "Old recording note", additions: [], files }));
    expect(r).not.toContain("Old recording note");
    expect(r).not.toContain(">Notes<");
    expect(r).toContain("run.mp4");
    const w = renderToStaticMarkup(createElement(SentWork, { timeZone: "UTC", kind: "written", answers: [{ question: "Q1", answer: "a" }], questions: ["Q1"], notes: "Written part's note", additions: [], files: [] }));
    expect(w).toContain("Written part&#x27;s note");
  });

  it("the recording's Send has no notes box and sends none; the server ignores a notes field and stores nothing", async () => {
    expect(src("app/app/sessions/[id]/RecordingUpload.tsx")).not.toMatch(/notes/i);
    const { testId } = await setup();
    const j = await joined(testId);
    await db.recording.create({ data: { contractId: j.sessionId, storageKey: `k-${randomUUID()}`, filename: "run.mp4", sizeBytes: 10, contentType: "video/mp4", uploadedAt: new Date(), part: "recording" } });
    const r = await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true, notes: "Should not be stored" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind: "recording" } })).notes).toBe("");
  });
});
