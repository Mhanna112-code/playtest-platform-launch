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

// (Owner, Nov 5, §268; replaces §232's "Rate and Leave stop once for open new terms, even when the page shows them") Rate and Leave follow the ordinary stop-once
// rule: an open offer stops them once only with Alerts on and only when the page hadn't shown it (the live pill / the page's render, §90); once shown, they go
// through. The NDA block (§267) never applies to them.
describe("(Owner, Nov 5) §268 Rate and Leave: open new terms follow the ordinary rule", () => {
  it.each(["rate", "leave"] as const)("%s: a page drawn after the offer (shown) goes straight through", async (action) => {
    const x = await ready();
    const shown = seen();
    const r = await press(x, action, { seenAt: shown, pageSeenAt: shown, loadedAt: shown });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
  it.each(["rate", "leave"] as const)("%s: a page drawn before the offer stops once (Alerts on), naming it; the second press goes ahead", async (action) => {
    const before = new Date(Date.now() - 60_000).toISOString();
    const x = await ready();
    const first = await press(x, action, { seenAt: before, pageSeenAt: before, loadedAt: before });
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    expect(texts(first)).toContain("Nora Lane offered you the new terms: Switch or Keep below");
    const second = await press(x, action, { seenAt: before, confirmed: true, boxAt: first.body.error.now });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
  });
  it.each(["rate", "leave"] as const)("%s with Alerts Off: never stopped for the offer", async (action) => {
    const before = new Date(Date.now() - 60_000).toISOString();
    const x = await ready();
    await db.user.update({ where: { id: x.tester.user.id }, data: { testerAlertsOff: true } });
    const r = await press(x, action, { seenAt: before, pageSeenAt: before, loadedAt: before });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
  it.each(["rate", "leave"] as const)("%s goes through while an added NDA blocks every other press (§267)", async (action) => {
    const x = await ready();
    const t = await db.test.findUniqueOrThrow({ where: { id: x.testId } });
    expect((await act(x.testId, "edit", x.dev.cookie, { version: t.version, fields: { ndaText: "Keep it secret." }, confirmed: true })).status).toBe(200);
    await settle();
    const shown = seen();
    const blocked = await sact(x.sessionId, "request-time", x.tester.cookie, { seenAt: shown });
    expect(blocked.body.error?.code).toBe("nda_block");
    const r = await press(x, action, { seenAt: shown, pageSeenAt: shown, loadedAt: shown });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});
