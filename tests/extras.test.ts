import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { PUT as uploadPUT } from "@/app/api/recordings/[id]/upload/route";
import { GET as fileGET } from "@/app/api/recordings/[id]/file/route";
import { makeUser, req } from "./helpers";
import { act, joined, sact, setup } from "./fixtures";

describe("recordings", () => {
  it("upload to local disk, send, and only the tester and the developer can watch", async () => {
    const { dev, testId } = await setup({ recordingCents: "15.00" });
    const { tester, sessionId } = await joined(testId);
    const start = await sact(sessionId, "recording-start", tester.cookie, { filename: "run.mp4", size: 11, contentType: "video/mp4" });
    expect(start.status).toBe(200);
    const { recordingId, uploadUrl } = start.body;
    expect(uploadUrl).toBe(`/api/recordings/${recordingId}/upload`);
    const put = await uploadPUT(new Request(`http://localhost:3400${uploadUrl}`, { method: "PUT", headers: { cookie: tester.cookie }, body: "hello video" }), { params: Promise.resolve({ id: recordingId }) });
    expect(put.status).toBe(200);
    await sact(sessionId, "recording-done", tester.cookie, { recordingId });
    expect((await sact(sessionId, "recording-send", tester.cookie)).status).toBe(200);
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId, kind: "recording" } });
    expect(sub.agreedCents).toBe(1500);
    const get = (cookie: string) => fileGET(req(`/api/recordings/${recordingId}/file`, { cookie }), { params: Promise.resolve({ id: recordingId }) });
    expect(await (await get(dev.cookie)).text()).toBe("hello video");
    expect((await get(tester.cookie)).status).toBe(200);
    expect((await get((await makeUser()).cookie)).status).toBe(404);
  });

  it("500 MB and 5 per session; videos only", async () => {
    const { testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await sact(sessionId, "recording-start", tester.cookie, { filename: "a.mp4", size: 501 * 1024 * 1024, contentType: "video/mp4" })).body.error.message).toBe("Recordings can be at most 500 MB.");
    expect((await sact(sessionId, "recording-start", tester.cookie, { filename: "a.png", size: 10, contentType: "image/png" })).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await sact(sessionId, "recording-start", tester.cookie, { filename: "a.mp4", size: 10, contentType: "video/mp4" })).status).toBe(200);
    expect((await sact(sessionId, "recording-start", tester.cookie, { filename: "a.mp4", size: 10, contentType: "video/mp4" })).body.error.message).toBe("You can add at most 5 recordings. Remove one first.");
  });
});

describe("chat", () => {
  it("only the developer and that tester can write", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    expect((await sact(sessionId, "message", tester.cookie, { body: "Hi! Started playing." })).status).toBe(200);
    expect((await act(testId, "message", dev.cookie, { contractId: sessionId, body: "Thanks!" })).status).toBe(200);
    const other = await makeUser({ dev: true });
    expect((await act(testId, "message", other.cookie, { contractId: sessionId, body: "Hello?" })).status).toBe(404);
    expect(await db.message.count({ where: { contractId: sessionId } })).toBe(2);
  });
});

describe("emails for key events", () => {
  it("joined and sent go to the developer", async () => {
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    // (Owner, Oct 26) One email lists everything new (the summary), not one email per update.
    await (await import("@/lib/server/notify")).sendSummaries();
    const mails = await db.outboxEmail.findMany({ where: { to: dev.user.email } });
    expect(mails.length).toBe(1);
    expect(mails[0].text).toContain("Ana Silva joined “Harbor Run”");
    expect(mails[0].text).toContain("Ana Silva sent written answers for “Harbor Run”");
  });
});

