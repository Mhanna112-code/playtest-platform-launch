import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeUser } from "./helpers";
import { addTo, joined, sact, seen, settle, setup } from "./fixtures";
import { pay } from "./b15";

// (Owner, Nov 11, §386 B; was "The team closed this for $0, so it can't be changed.") The team's $0 closure names the press: "The team closed this for $0, so your
// {button} didn't go through." for Send Answers, Add, and a recording's Send / Add.

const LONG = ["the boats were great", "level two gate was hard"];

async function closedPieces() {
  const s = await setup({ recordingCents: "10.00" });
  const j = await joined(s.testId);
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: LONG, seenAt: seen(), confirmed: true })).status).toBe(200);
  await db.recording.create({ data: { contractId: j.sessionId, storageKey: `k-${randomUUID()}`, filename: "run.mp4", sizeBytes: 10, contentType: "video/mp4", uploadedAt: new Date(), part: "recording" } });
  expect((await sact(j.sessionId, "recording-send", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
  await settle();
  const admin = await makeUser({ name: "Team Admin" });
  for (const kind of ["written", "recording"]) {
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId, kind } });
    expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "0", reason: "Nothing usable here" })).status).toBe(200);
    await db.review.update({ where: { submissionId: sub.id }, data: { teamClosedById: admin.user.id } });
  }
  await settle();
  return { ...s, ...j };
}

describe("§386 B the team's $0 closure names the press", () => {
  it("Send Answers, Add, and a recording's Send and Add", async () => {
    const w = await closedPieces();
    const line = (press: string) => `The team closed this for $0, so your ${press} didn't go through.`;
    expect((await sact(w.sessionId, "written", w.tester.cookie, { answers: ["something else here", "and more"], seenAt: seen(), confirmed: true })).body.error).toMatchObject({ code: "paid", message: line("Send Answers") });
    expect((await addTo(w.sessionId, w.tester.cookie, { text: "One more thing to add." })).body.error).toMatchObject({ code: "paid", message: line("Add") });
    await db.recording.create({ data: { contractId: w.sessionId, storageKey: `k-${randomUUID()}`, filename: "two.mp4", sizeBytes: 10, contentType: "video/mp4", uploadedAt: new Date(), part: "recording" } });
    expect((await sact(w.sessionId, "recording-send", w.tester.cookie, { seenAt: seen(), confirmed: true })).body.error).toMatchObject({ code: "paid", message: line("Send") });
    expect((await sact(w.sessionId, "recording-send", w.tester.cookie, { seenAt: seen(), confirmed: true, add: true })).body.error).toMatchObject({ code: "paid", message: line("Add") });
  });
});
