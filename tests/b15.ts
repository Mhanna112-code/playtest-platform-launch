import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { json, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// Shared helpers for the batch 15 tests.
export const DAY = 86_400_000;
export const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
export const payMore = (testId: string, cookie: string, body: Record<string, unknown>) => act(testId, "pay-extra", cookie, { seenAt: seen(), confirmed: true, payKey: randomUUID(), ...body });
export const withCard = (userId: string) => db.user.update({ where: { id: userId }, data: { stripeCustomerId: "cus_" + randomUUID(), stripePaymentMethodId: "pm_x" } });

/** Written answers sent on a test (listed at `writtenCents`, or not listed with null). */
export async function sentWork(writtenCents: string | null = "10.00", over: Record<string, unknown> = {}) {
  const s = await setup(writtenCents == null ? { writtenCents: null, questions: [], ...over } : { writtenCents, ...over });
  const j = await joined(s.testId);
  const n = ((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).questions as string[]).length || 1;
  await sact(j.sessionId, "written", j.tester.cookie, { answers: Array(n).fill("answer") });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  return { ...s, ...j, sub };
}
