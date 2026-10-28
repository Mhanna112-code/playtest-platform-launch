import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { presign } from "@/lib/server/storage";
import { UPLOAD_UNFINISHED } from "@/lib/server/recordings";
import { joined, sact, setup } from "./fixtures";

// Batch 15 section 6: on R2 the presigned PUT signs content-length, and finishing an upload checks the real object with a HEAD request.
const R2 = { R2_ACCOUNT_ID: "acc", R2_ACCESS_KEY_ID: "key", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "bucket" };
const withR2 = () => Object.assign(process.env, R2);
afterEach(() => {
  for (const k of Object.keys(R2)) process.env[k] = "";
  vi.unstubAllGlobals();
});

describe("R2 upload sizes (section 6)", () => {
  it("the presigned PUT has content-length among its signed headers; a GET signs only the host", () => {
    withR2();
    const put = new URL(presign("PUT", "recordings/x/a.mp4", 3600, 1234));
    expect(put.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;host");
    const get = new URL(presign("GET", "recordings/x/a.mp4"));
    expect(get.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    // Signed for a different size gives a different signature.
    expect(new URL(presign("PUT", "recordings/x/a.mp4", 3600, 1235)).searchParams.get("X-Amz-Signature")).not.toBe(put.searchParams.get("X-Amz-Signature"));
  });

  it("finishing checks the stored object: too big is deleted with the row; the right size goes through", async () => {
    const { testId } = await setup({ recordingCents: "5.00" });
    const { tester, sessionId } = await joined(testId);
    withR2();
    const calls: { method: string; url: string }[] = [];
    let size = 5000;
    vi.stubGlobal("fetch", async (url: string, init?: { method?: string }) => {
      calls.push({ method: init?.method ?? "GET", url });
      if (init?.method === "HEAD") return new Response(null, { status: 200, headers: { "content-length": String(size) } });
      return new Response(null, { status: 204 });
    });
    const start = await sact(sessionId, "recording-start", tester.cookie, { size: 1000, contentType: "video/mp4", filename: "run.mp4" });
    expect(start.status).toBe(200);
    expect(new URL(start.body.uploadUrl).searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host"); // (section 41, M5: the type too)
    // The stored object is bigger than claimed: refused, the object and the row deleted.
    const done = await sact(sessionId, "recording-done", tester.cookie, { recordingId: start.body.recordingId });
    expect(done.status).toBe(409);
    expect(done.body.error.message).toBe(UPLOAD_UNFINISHED);
    expect(calls.map((c) => c.method)).toEqual(["HEAD", "DELETE"]);
    expect(await db.recording.findUnique({ where: { id: start.body.recordingId } })).toBeNull();
    // A missing object: the row goes too (nothing to delete in storage).
    const s2 = await sact(sessionId, "recording-start", tester.cookie, { size: 1000, contentType: "video/mp4", filename: "run.mp4" });
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    expect((await sact(sessionId, "recording-done", tester.cookie, { recordingId: s2.body.recordingId })).status).toBe(409);
    expect(await db.recording.findUnique({ where: { id: s2.body.recordingId } })).toBeNull();
    // The right size: finished.
    size = 1000;
    vi.stubGlobal("fetch", async () => new Response(null, { status: 200, headers: { "content-length": String(size) } }));
    const s3 = await sact(sessionId, "recording-start", tester.cookie, { size: 1000, contentType: "video/mp4", filename: "run.mp4" });
    expect((await sact(sessionId, "recording-done", tester.cookie, { recordingId: s3.body.recordingId })).status).toBe(200);
    expect((await db.recording.findUniqueOrThrow({ where: { id: s3.body.recordingId } })).uploadedAt).not.toBeNull();
  });
});
