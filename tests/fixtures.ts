import { expect } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { POST as testAction } from "@/app/api/tests/[id]/[action]/route";
import { POST as sessionAction } from "@/app/api/sessions/[id]/[action]/route";
import { json, makeUser, req } from "./helpers";

export const listingBody = (over: Record<string, unknown> = {}) => ({
  title: "Harbor Run", description: "Sail", buildUrl: "https://example.com/b", category: "Action", devices: [], languages: [],
  spots: 3, writtenCents: "10.00", recordingCents: null, liveRateCents: "30.00", liveMinutes: 30, deadlineDays: 7,
  questions: ["What did you like?", "Where did you get stuck?"], openUntil: "", ...over,
});

export async function setup(over: Record<string, unknown> = {}) {
  const dev = await makeUser({ dev: true, name: "Nora Lane", pronoun: "she" });
  const r = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody(over) })));
  expect(r.status).toBe(200);
  return { dev, testId: r.body.id as string };
}
export const act = (id: string, action: string, cookie: string, body: Record<string, unknown> = {}) =>
  testAction(req(`/api/tests/${id}/${action}`, { cookie, body }), { params: Promise.resolve({ id, action }) }).then(json);
export const sact = (id: string, action: string, cookie: string, body: Record<string, unknown> = {}) =>
  sessionAction(req(`/api/sessions/${id}/${action}`, { cookie, body }), { params: Promise.resolve({ id, action }) }).then(json);

export async function joined(testId: string, name = "Ana Silva", pronoun = "she") {
  const t = await makeUser({ tester: true, name, pronoun });
  const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const r = await act(testId, "join", t.cookie, { listingVersion: test.listingVersion });
  expect(r.status).toBe(200);
  return { tester: t, sessionId: r.body.sessionId as string };
}
export const seen = () => new Date().toISOString();

/** Calls are always requests: the developer requests a time with this tester and the tester accepts → booked. */
export async function bookCall(testId: string, devCookie: string, sessionId: string, testerCookie: string, hours = 48) {
  const startsAt = new Date(Date.now() + hours * 3_600_000);
  startsAt.setSeconds(0, 0);
  const r = await act(testId, "request-time", devCookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: startsAt.toISOString() });
  expect(r.status).toBe(200);
  const q = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId, status: "pending", fromSide: "developer" }, orderBy: { createdAt: "desc" } });
  const a = await sact(sessionId, "answer-request", testerCookie, { requestId: q.id, action: "accept", seenAt: seen(), confirmed: true });
  expect(a.status).toBe(200);
  return db.call.findFirstOrThrow({ where: { contractId: sessionId, status: "booked" }, orderBy: { createdAt: "desc" } });
}
export const atHours = (h: number) => { const d = new Date(Date.now() + h * 3_600_000); d.setSeconds(0, 0); return d.toISOString(); };
