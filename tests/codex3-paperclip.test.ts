import { describe, expect, it } from "vitest";
import { attachmentMarker, excerptWithFiles, withoutAttachmentMarkers, removeAttachmentMarker } from "@/lib/answerAttachments";
import { answerChars } from "@/lib/questions";
import { writtenLength } from "@/lib/rules";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerWithAttachments } from "@/components/AnswerSets";

describe("Task 3: files placed at the cursor in written answers", () => {
  it("stores an upload id in a readable marker and excludes markers from answer limits", () => {
    const marker = attachmentMarker("upload-1", "map.png");
    expect(marker).toBe("[[attachment:upload-1|map.png]]");
    expect(withoutAttachmentMarkers(`hello${marker}`)).toBe("hello");
    expect(answerChars(`hello${marker}`)).toBe(5);
    expect(writtenLength([`hello${marker}`])).toBe(5);
    expect(writtenLength(["a".repeat(50000) + marker])).toBe(50000);
    expect(answerChars("a".repeat(49) + marker)).toBe(49);
    expect(answerChars("a".repeat(50) + marker)).toBe(50);
    expect(writtenLength(["hello[Uploading map.png… 40%]"])).toBe(5);
  });
  it("turns a marker crossed by an excerpt into [file]", () => {
    expect(excerptWithFiles(`before ${attachmentMarker("id", "map.png")} after`)).toBe("before [file] after");
  });
  it("renders an attachment at its marker in the shared answer renderer", () => {
    const marker = attachmentMarker("upload-1", "map.png");
    const html = renderToStaticMarkup(createElement(AnswerWithAttachments, { text: `before ${marker} after`, attachments: [{ id: "upload-1", filename: "map.png", size: 80, contentType: "image/png" }] }));
    expect(html.indexOf("before")).toBeLessThan(html.indexOf("map.png"));
    expect(html.indexOf("map.png")).toBeLessThan(html.indexOf("after"));
    expect(html).toContain("/api/recordings/upload-1/file");
  });
});

import { db } from "@/lib/db";
import { joined, setup, sact, seen } from "./fixtures";
import { getKept, setKept } from "@/lib/server/kept";
import { itemsOf } from "@/lib/answerSets";

const upload = async (sessionId: string, cookie: string, filename: string, contentType: string) => {
  const started = await sact(sessionId, "recording-start", cookie, { part: "written", filename, contentType, size: 100 });
  expect(started.status).toBe(200);
  expect((await sact(sessionId, "recording-done", cookie, { recordingId: started.body.recordingId })).status).toBe(200);
  return started.body.recordingId as string;
};

describe("paperclip uploads, drafts and sent answers", () => {
  it("keeps file and recording markers mid-answer in a draft and sends their order unchanged", async () => {
    const { testId } = await setup();
    const { sessionId, tester } = await joined(testId);
    const image = await upload(sessionId, tester.cookie, "map.png", "image/png");
    const video = await upload(sessionId, tester.cookie, "run.webm", "video/webm");
    const answer = `before ${attachmentMarker(image, "map.png")} between ${attachmentMarker(video, "run.webm")} after`;
    await setKept(tester.user.id, `written:${sessionId}`, { answers: [answer, "answer"], notes: "" });
    expect((await getKept(tester.user.id, `written:${sessionId}`)).data).toMatchObject({ answers: [answer, "answer"] });
    expect((await sact(sessionId, "written", tester.cookie, { answers: [answer, "answer"], seenAt: seen(), confirmed: true })).status).toBe(200);
    const sub = await db.submission.findUniqueOrThrow({ where: { contractId_kind: { contractId: sessionId, kind: "written" } }, include: { recordings: true } });
    expect(itemsOf(sub.answers)[0].answer).toBe(answer);
    const html = renderToStaticMarkup(createElement(AnswerWithAttachments, { text: answer, attachments: sub.recordings.map((r) => ({ id: r.id, filename: r.filename, size: r.sizeBytes, contentType: r.contentType })) }));
    expect(html.indexOf("before")).toBeLessThan(html.indexOf("map.png"));
    expect(html.indexOf("between")).toBeLessThan(html.indexOf("<video"));
    expect(html).toContain("controls");
    const removed = removeAttachmentMarker(answer, image);
    expect(removed).not.toContain(image);
    expect(removed).toContain(video);
    await setKept(tester.user.id, `written:${sessionId}`, { answers: [removed] });
    expect((await sact(sessionId, "recording-remove", tester.cookie, { recordingId: image, written: true })).status).toBe(200);
    expect(await db.recording.findUnique({ where: { id: image } })).not.toBeNull(); // the sent set still owns it
  });

  it("deletes an unsubmitted upload only after every answer has released its marker", async () => {
    const { testId } = await setup();
    const { sessionId, tester } = await joined(testId);
    const id = await upload(sessionId, tester.cookie, "map.png", "image/png");
    await setKept(tester.user.id, `written:${sessionId}`, { answers: [attachmentMarker(id, "map.png")] });
    const remove = () => sact(sessionId, "recording-remove", tester.cookie, { recordingId: id, written: true });
    expect((await remove()).body.retained).toBe(true);
    expect(await db.recording.findUnique({ where: { id } })).not.toBeNull();
    await setKept(tester.user.id, `written:${sessionId}`, { answers: ["text only"] });
    expect((await remove()).status).toBe(200);
    expect(await db.recording.findUnique({ where: { id } })).toBeNull();
  });

  it("shares five-file and five-recording limits across answers, with a 500 MB limit", async () => {
    const { testId } = await setup();
    const { sessionId, tester } = await joined(testId);
    for (const contentType of ["image/png", "video/webm"]) {
      for (let i = 0; i < 5; i++) await upload(sessionId, tester.cookie, `file-${i}`, contentType);
      const full = await sact(sessionId, "recording-start", tester.cookie, { part: "written", filename: "extra", contentType, size: 100 });
      expect(full.status).toBe(409);
    }
    for (const contentType of ["image/png", "video/webm"]) {
      const big = await sact(sessionId, "recording-start", tester.cookie, { part: "written", filename: "large", contentType, size: 500 * 1024 * 1024 + 1 });
      expect(big.status).toBe(413);
    }
  });

  it("waits for an unfinished written upload before Send", async () => {
    const { testId } = await setup();
    const { sessionId, tester } = await joined(testId);
    await sact(sessionId, "recording-start", tester.cookie, { part: "written", filename: "map.png", contentType: "image/png", size: 100 });
    const sent = await sact(sessionId, "written", tester.cookie, { answers: ["answer", "answer"], seenAt: seen(), confirmed: true });
    expect(sent.status).toBe(409);
    expect(sent.body.error.message).toContain("upload");
  });

  it("keeps old answers readable and renders other files with their name and size", () => {
    const plain = renderToStaticMarkup(createElement(AnswerWithAttachments, { text: "old answer", attachments: [] }));
    expect(plain).toContain("old answer");
    expect(plain).not.toContain("[file]");
    const file = renderToStaticMarkup(createElement(AnswerWithAttachments, { text: attachmentMarker("zip", "logs.zip"), attachments: [{ id: "zip", filename: "logs.zip", size: 1048576, contentType: "application/zip" }] }));
    expect(file).toContain("logs.zip");
    expect(file).toContain("1.0 MB");
  });
});
