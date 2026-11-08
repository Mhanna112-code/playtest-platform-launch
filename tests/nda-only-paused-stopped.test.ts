import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { closedForSuspended } from "@/lib/closedPages";
import { NDA_ONLY_EDIT } from "@/lib/ndaEditing";
import { adminStopTest, pauseTest, unpauseTest } from "@/lib/server/restrictions";
import { makeUser } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

async function world(state: string) {
  const s = await setup();
  const j = await joined(s.testId);
  const before = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
  const loaded = seen();
  await settle();
  if (state === "paused") {
    const a = await makeUser();
    await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    await pauseTest(a.user.id, s.testId, "Manual pause for NDA checks.");
  } else if (state === "stopped") {
    expect((await act(s.testId, "stop", s.dev.cookie, { reason: "Finished this sample test.", confirmed: true })).status).toBe(200);
  } else if (state === "admin-stopped") {
    await adminStopTest(s.testId, "The team stopped this sample.");
  } else {
    await db.user.update({ where: { id: s.dev.user.id }, data: state === "held" ? { holdStartedAt: new Date(), holdReason: "unpaid" } : { devSuspendedAt: new Date() } });
  }
  return { ...s, ...j, before, loaded };
}

describe("NDA-only editing during pauses and after stops", () => {
  it.each(["paused", "stopped", "admin-stopped", "held", "suspended"])("%s permits only NDA changes and preserves participation and dates", async (state) => {
    const w = await world(state);
    const current = await db.test.findUniqueOrThrow({ where: { id: w.testId } });
    const c0 = await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } });
    const base = { ndaOnly: true, version: current.version, seenAt: seen(), confirmed: true };
    const bad = await act(w.testId, "edit", w.dev.cookie, { ...base, fields: { ndaText: "Do not share this build.", title: "A different title" } });
    expect(bad.body.error).toMatchObject({ code: "nda_only", message: NDA_ONLY_EDIT });
    const keys = await act(w.testId, "edit", w.dev.cookie, { ...base, fields: { ndaText: "Do not share this build." }, keysAdd: ["EXTRA-KEY"] });
    expect(keys.body.error?.code).toBe("nda_only");
    const good = await act(w.testId, "edit", w.dev.cookie, { ...base, payRulesOk: false, fields: { ndaText: "Do not share this build." } });
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    const after = await db.test.findUniqueOrThrow({ where: { id: w.testId } });
    expect(after).toMatchObject({ status: current.status, spots: current.spots, openUntil: current.openUntil, ndaText: "Do not share this build." });
    const c = await db.contract.findUniqueOrThrow({ where: { id: w.sessionId } });
    expect(c).toMatchObject({ status: c0.status, dueAt: c0.dueAt, writtenCents: c0.writtenCents, ndaText: after.ndaText, ndaAcceptedAt: null });
    expect(await db.termsOffer.count({ where: { contractId: c.id, status: "open" } })).toBe(0);
    expect((await sact(c.id, "nda-seen", w.tester.cookie)).status).toBe(200);
    expect((await db.contract.findUniqueOrThrow({ where: { id: c.id } })).ndaAcceptedAt).not.toBeNull();
  });

  it.each(["paused", "stopped", "admin-stopped"])("a stale NDA Save stops once for %s then saves without losing its text", async (state) => {
    const w = await world(state);
    const body = { ndaOnly: true, version: w.before.version, fields: { ndaText: "Keep this trial confidential." }, seenAt: w.loaded, pageSeenAt: w.loaded };
    const first = await act(w.testId, "edit", w.dev.cookie, body);
    expect(first.body.error?.code, JSON.stringify(first.body)).toBe("stop_once");
    const second = await act(w.testId, "edit", w.dev.cookie, { ...body, version: first.body.error.version, confirmed: true, boxAt: first.body.error.now });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: w.testId } })).ndaText).toBe(body.fields.ndaText);
  });

  it("a restricted developer can reach only the dedicated NDA editor, while Post stays closed", () => {
    const u = { isDeveloper: true, isTester: false, side: "developer", devSuspendedAt: new Date() };
    expect(closedForSuspended("/app/tests/test-id/edit", u, "developer")).toBe(false);
    expect(closedForSuspended("/app/tests/new", u, "developer")).toBe(true);
  });

  it("the NDA editor remains safe and usable if the pause lifts before Save", async () => {
    const w = await world("paused");
    await unpauseTest(w.testId);
    const t = await db.test.findUniqueOrThrow({ where: { id: w.testId } });
    const r = await act(w.testId, "edit", w.dev.cookie, { ndaOnly: true, version: t.version, fields: { ndaText: "Keep this build private." }, payRulesOk: false, confirmed: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const mixed = await act(w.testId, "edit", w.dev.cookie, { ndaOnly: true, version: t.version, fields: { ndaText: "Private", spots: 10 }, confirmed: true });
    expect(mixed.body.error?.code).toBe("nda_only");
  });
});
