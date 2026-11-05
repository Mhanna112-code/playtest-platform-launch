import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as sessionPOST } from "@/app/api/sessions/[id]/[action]/route";
import { json, req } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

const pay = (cookie: string, id: string) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), kind: "submission", id, amount: "10.00", tickedCents: 1000, confirmed: true } })).then(json);
const texts = (r: { body: { error?: { changes?: { text: string }[] } } }) => (r.body.error?.changes ?? []).map((e) => e.text);
async function ready() {
  const s = await setup();
  const j = await joined(s.testId, "Ana Silva", "they");
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] })).status).toBe(200);
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  expect((await pay(s.dev.cookie, sub.id)).status).toBe(200);
  const t = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
  expect((await act(s.testId, "edit", s.dev.cookie, { version: t.version, fields: { writtenCents: "12.00" }, confirmed: true })).status).toBe(200);
  await settle();
  expect(await db.termsOffer.count({ where: { contractId: j.sessionId, status: "open" } })).toBe(1);
  return { ...s, ...j };
}
const press = (x: Awaited<ReturnType<typeof ready>>, action: "rate" | "leave", extra: Record<string, unknown>) =>
  sessionPOST(req(`/api/sessions/${x.sessionId}/${action}`, { cookie: x.tester.cookie, body: { ...(action === "rate" ? { stars: 5, comment: "" } : {}), ...extra } }), { params: Promise.resolve({ id: x.sessionId, action }) }).then(json);

describe("(Owner, Nov 5) §232 Rate and Leave stop once for open new terms, even when the page shows them", () => {
  it.each(["rate", "leave"] as const)("%s: a page drawn after the offer (shown) still stops once naming it; the second press goes ahead", async (action) => {
    const x = await ready();
    const shown = seen(); // the page drew the offer's box: §90 alone would let the press through
    const first = await press(x, action, { seenAt: shown, pageSeenAt: shown, loadedAt: shown });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(texts(first)).toEqual([`Nora Lane offered you new terms: Switch or Keep in the box above, or ${action === "rate" ? "rating" : "leaving"} closes them unanswered`]);
    const second = await press(x, action, { seenAt: shown, confirmed: true, boxAt: first.body.error.now });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
  });
  it("no open offer: nothing extra stops", async () => {
    const x = await ready();
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: x.sessionId, status: "open" } });
    await db.termsOffer.update({ where: { id: offer.id }, data: { status: "kept" } });
    const shown = seen();
    expect((await press(x, "rate", { seenAt: shown, pageSeenAt: shown, loadedAt: shown })).status).toBe(200);
  });
});
