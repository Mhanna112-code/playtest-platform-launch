import { expect } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { POST as testAction } from "@/app/api/tests/[id]/[action]/route";
import { POST as sessionAction } from "@/app/api/sessions/[id]/[action]/route";
import { json, makeUser, req } from "./helpers";
import { questionKeys } from "@/lib/additions";
import { itemsFor } from "@/lib/answerSets";

export const listingBody = (over: Record<string, unknown> = {}) => ({
  productName: "Harbor Run", title: "Harbor Run", description: "Sail", buildUrl: "https://example.com/b", categories: ["Game"], devices: [], languages: [],
  spots: 3, writtenCents: "10.00", recordingCents: null, liveRateCents: "30.00", liveMinutes: 30, deadlineDays: 7,
  // (Batch 12 section 6) Open until is required (3 to 30 days ahead) and is every tester's deadline.
  questions: ["What did you like?", "Where did you get stuck?"], openUntil: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
  // (Batch 19 section 7) The required tick about Charge on Post (tests of the refusal leave it out).
  payRulesOk: true, ...over,
});

export async function setup(over: Record<string, unknown> = {}) {
  const dev = await makeUser({ dev: true, name: "Nora Lane", pronoun: "she" });
  await db.user.update({ where: { id: dev.user.id }, data: { stripePaymentMethodId: "pm_test_saved", cardExpMonth: 12, cardExpYear: 2030 } });
  const r = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody(over) })));
  expect(r.status).toBe(200);
  await settle();
  return { dev, testId: r.body.id as string };
}
// Windows' clock can lag by ~15 ms: let a step finish clearly before the test notes the page-load time (the stop-once rules compare the two).
export const settle = () => new Promise((r) => setTimeout(r, 25));
/** (Batch 19 section 7) Save and a draft's Post carry the required tick about Charge unless the test says otherwise (`payRulesOk: false`). */
const withPayTick = (action: string, body: Record<string, unknown>) => (action === "edit" || action === "post-draft" ? { payRulesOk: true, ...body } : body);
export const act = (id: string, action: string, cookie: string, body: Record<string, unknown> = {}) =>
  testAction(req(`/api/tests/${id}/${action}`, { cookie, body: withPayTick(action, body) }), { params: Promise.resolve({ id, action }) }).then(json);
export const sact = (id: string, action: string, cookie: string, body: Record<string, unknown> = {}) =>
  sessionAction(req(`/api/sessions/${id}/${action}`, { cookie, body }), { params: Promise.resolve({ id, action }) }).then(json);

/**
 * (Batch 35 §167) "Add to this answer": an addition is to one question, so a test's written-add goes under the session's first current question (`question` in
 * `body` picks another).
 */
export async function addTo(id: string, cookie: string, body: Record<string, unknown> = {}) {
  const c = await db.contract.findUniqueOrThrow({ where: { id } });
  const qs = Array.isArray(c.questions) && c.questions.length ? (c.questions as string[]) : ["Your feedback"];
  return sact(id, "written-add", cookie, { question: questionKeys(itemsFor(qs))[0], ...body });
}

export async function joined(testId: string, name = "Ana Silva", pronoun = "she") {
  const t = await makeUser({ tester: true, name, pronoun });
  const test = await db.test.findUniqueOrThrow({ where: { id: testId } });
  const r = await act(testId, "join", t.cookie, { listingVersion: test.listingVersion });
  expect(r.status).toBe(200);
  await settle();
  return { tester: t, sessionId: r.body.sessionId as string };
}
export const seen = () => new Date().toISOString();

/** Calls are always requests: the developer requests a time with this tester and the tester accepts → booked. */
export async function bookCall(testId: string, devCookie: string, sessionId: string, testerCookie: string, hours = 48) {
  const startsAt = new Date(Date.now() + hours * 3_600_000);
  startsAt.setUTCSeconds(0, 0); // (UTC: a local setSeconds lands a time in the repeated fall-back hour on its first occurrence)
  const r = await act(testId, "request-time", devCookie, { seenAt: seen(), confirmed: true, contractIds: [sessionId], startsAt: startsAt.toISOString() });
  expect(r.status).toBe(200);
  const q = await db.callRequest.findFirstOrThrow({ where: { contractId: sessionId, status: "pending", fromSide: "developer" }, orderBy: { createdAt: "desc" } });
  const a = await sact(sessionId, "answer-request", testerCookie, { requestId: q.id, action: "accept", seenAt: seen(), confirmed: true });
  expect(a.status).toBe(200);
  return db.call.findFirstOrThrow({ where: { contractId: sessionId, status: "booked" }, orderBy: { createdAt: "desc" } });
}
export const atHours = (h: number) => { const d = new Date(Date.now() + h * 3_600_000); d.setUTCSeconds(0, 0); return d.toISOString(); };

/**
 * (Owner, Nov 5, §208) An older "choose one" request (several times in ONE request: the other side picks one, the rest close), stored as the app made it before
 * Nov 5. None is made now ("+ Another time" sends each time as its own request), but those still waiting keep working: the tests of that behaviour start from one.
 * `rows`: times (each "once"), or rows with their repeat.
 */
export async function oldChooseOne(sessionId: string, fromSide: "developer" | "tester", rows: (string | { startsAt: string; repeat: string; count?: number })[], minutes = 30) {
  const c = await db.contract.findUniqueOrThrow({ where: { id: sessionId } });
  const rs = rows
    .map((r) => (typeof r === "string" ? { startsAt: r, repeat: "once", count: 1 } : { startsAt: r.startsAt, repeat: r.repeat, count: r.repeat === "once" ? 1 : (r.count ?? 0) }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const times = rs.map((r) => new Date(r.startsAt));
  return db.callRequest.create({
    data: { testId: c.testId, contractId: sessionId, fromSide, startsAt: times[0], times, weeks: 0, repeat: "", rows: rs, minutes, batchId: fromSide === "developer" ? `old-${Math.random().toString(36).slice(2, 10)}` : "" },
  });
}
