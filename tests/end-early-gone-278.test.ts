import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { liveTicks } from "@/lib/liveTicks";
import { makeUser } from "./helpers";
import { act, joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 5, §278) End early with a ticked tester whose part already ended (left, ended, rated…) and others still working: that tester gets a refusal line of
// their own ("Your End early didn't go through for mhann: mhann already left the test.") and the press goes on for the others by the ordinary rules (a stop once
// for what's new, the refusal line beside it and the tick removed; or their work ends at once, the refusal line beside the done line). Every ticked tester out:
// one refusal, as before. The same for Request a time with several ticked testers, and Invite with some who rated the test. No "Refresh to see the latest".

type Res = { status: number; body: Record<string, unknown> & { error?: { code?: string; message?: string; now?: string; gone?: { contractId: string; text: string }[]; changes?: { text: string; forced?: boolean }[] } } };
const REASON = "We have what we need for this build";
const later = () => new Promise((r) => setTimeout(r, 30));

/** Ana and Ben are working; the page loads; then Ana leaves. */
async function world() {
  const s = await setup();
  const ana = await joined(s.testId, "Ana Silva");
  const ben = await joined(s.testId, "Ben Okafor", "he");
  await later();
  const pageLoaded = seen();
  await later();
  expect((await sact(ana.sessionId, "leave", ana.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
  await settle();
  return { ...s, ana, ben, pageLoaded };
}

describe("§278 End early with a ticked tester gone meanwhile", () => {
  it("gone plus a charge by the other: the refusal line for the gone one and a stop listing the charge; the second press ends the other; the tick goes", async () => {
    const w = await world();
    // Ben charges on his part (a charge about a ticked tester always stops the press: §193).
    const sub = await db.submission.create({ data: { contractId: w.ben.sessionId, kind: "written", agreedCents: 1000, sentAt: new Date(), updatedAt: new Date() } });
    await db.testEvent.create({ data: { testId: w.testId, kind: "paid", text: "Ben Okafor charged $10.00 for his written answers", contractId: w.ben.sessionId, link: `part-${sub.id}` } });
    await settle();
    const first = (await act(w.testId, "end-early", w.dev.cookie, { seenAt: w.pageLoaded, contractIds: [w.ana.sessionId, w.ben.sessionId], reason: REASON })) as Res;
    expect(first.status).toBe(409);
    expect(first.body.error?.code).toBe("stop_once");
    expect(first.body.error?.gone).toEqual([{ contractId: w.ana.sessionId, text: "Your End early didn't go through for Ana Silva: Ana Silva already left the test." }]);
    const texts = (first.body.error?.changes ?? []).map((c) => c.text);
    expect(texts).toContain("Ben Okafor charged $10.00 for his written answers");
    // Ana's leaving is what her refusal line says: not a stop line too.
    expect(texts.some((t) => t.startsWith("Ana Silva left"))).toBe(false);
    expect((first.body.error?.changes ?? []).find((c) => c.text.startsWith("Ben Okafor charged"))?.forced).toBe(true);
    expect(JSON.stringify(first.body)).not.toContain("Refresh");
    expect((await db.contract.findUniqueOrThrow({ where: { id: w.ben.sessionId } })).status).toBe("working");
    // The page removes the gone tester's tick (the ids the stop names), then the second press ends Ben's work.
    const ticks = [w.ana.sessionId, w.ben.sessionId].filter((id) => !first.body.error!.gone!.some((g) => g.contractId === id));
    expect(ticks).toEqual([w.ben.sessionId]);
    const second = (await act(w.testId, "end-early", w.dev.cookie, { seenAt: w.pageLoaded, contractIds: ticks, reason: REASON, confirmed: true, boxAt: first.body.error?.now })) as Res;
    expect(second.status).toBe(200);
    expect(second.body.endedIds).toEqual([w.ben.sessionId]);
    expect(await db.contract.findUniqueOrThrow({ where: { id: w.ben.sessionId } })).toMatchObject({ status: "ended", endKind: "early" });
    expect((await db.contract.findUniqueOrThrow({ where: { id: w.ana.sessionId } })).status).toBe("left");
  });

  it("gone plus nothing new: the others' work ends at once, with the refusal line for the gone one beside the done line", async () => {
    const w = await world();
    const r = (await act(w.testId, "end-early", w.dev.cookie, { seenAt: w.pageLoaded, contractIds: [w.ana.sessionId, w.ben.sessionId], reason: REASON })) as Res;
    expect(r.status).toBe(200);
    expect(r.body.endedIds).toEqual([w.ben.sessionId]);
    expect(r.body.gone).toEqual([{ contractId: w.ana.sessionId, text: "Your End early didn't go through for Ana Silva: Ana Silva already left the test." }]);
    expect(r.body.done).toBe("You ended Ben Okafor's work early.");
    expect((await db.contract.findUniqueOrThrow({ where: { id: w.ben.sessionId } })).status).toBe("ended");
  });

  it("all ticked testers gone: a single refusal naming them, with no refresh text", async () => {
    const w = await world();
    expect((await sact(w.ben.sessionId, "leave", w.ben.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    const r = (await act(w.testId, "end-early", w.dev.cookie, { seenAt: w.pageLoaded, contractIds: [w.ana.sessionId, w.ben.sessionId], reason: REASON })) as Res;
    expect(r.status).toBe(409);
    expect(r.body.error?.code).toBe("gone");
    expect(r.body.error?.message).toBe("Ana Silva already left the test. Ben Okafor already left the test.");
    expect(r.body.error?.changes).toBeUndefined();
    // One tester: as before.
    const one = (await act(w.testId, "end-early", w.dev.cookie, { seenAt: w.pageLoaded, contractIds: [w.ana.sessionId], reason: REASON })) as Res;
    expect(one.body.error?.message).toBe("Ana Silva already left the test.");
  });
});

describe("§278 other multi-person presses", () => {
  it("Request a time with a ticked tester gone meanwhile: their refusal line, and the request goes to the others", async () => {
    const w = await world();
    const startsAt = new Date(Date.now() + 48 * 3_600_000);
    startsAt.setUTCSeconds(0, 0);
    const r = (await act(w.testId, "request-time", w.dev.cookie, { seenAt: w.pageLoaded, contractIds: [w.ana.sessionId, w.ben.sessionId], startsAt: startsAt.toISOString() })) as Res;
    expect(r.status).toBe(200);
    expect(r.body.gone).toEqual([{ contractId: w.ana.sessionId, text: "Your Request a time didn't go through for Ana Silva: Ana Silva's session has ended." }]);
    expect(await db.callRequest.count({ where: { contractId: w.ben.sessionId, status: "pending" } })).toBe(1);
    expect(await db.callRequest.count({ where: { contractId: w.ana.sessionId } })).toBe(0);
    // Everyone ticked gone: the refusal as before.
    const only = (await act(w.testId, "request-time", w.dev.cookie, { seenAt: seen(), confirmed: true, contractIds: [w.ana.sessionId], startsAt: startsAt.toISOString() })) as Res;
    expect(only.body.error?.message).toBe("Ana Silva's session has ended.");
  });

  it("Invite with a ticked tester who rated the test: their refusal line, and the others are invited; all of them raters: one refusal", async () => {
    const s = await setup();
    const ana = await joined(s.testId, "Ana Silva");
    await db.contract.update({ where: { id: ana.sessionId }, data: { status: "left", endKind: "rated", endedAt: new Date() } });
    const ben = await makeUser({ tester: true, name: "Ben Okafor", pronoun: "he" });
    await settle();
    const r = (await act(s.testId, "invite", s.dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [ana.tester.user.id, ben.user.id] })) as Res;
    expect(r.status).toBe(200);
    expect(r.body.message).toBe("Invited Ben Okafor. Your Invite didn't go through for Ana Silva: Ana Silva rated this test, so she can't join it again.");
    expect(await db.invite.count({ where: { testId: s.testId, testerId: ben.user.id, status: "sent" } })).toBe(1);
    expect(await db.invite.count({ where: { testId: s.testId, testerId: ana.tester.user.id } })).toBe(0);
    const only = (await act(s.testId, "invite", s.dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [ana.tester.user.id] })) as Res;
    expect(only.body.error?.message).toBe("Ana Silva rated this test, so she can't join it again.");
  });
});

describe("§278 a tick whose row left the list is never sent hidden", () => {
  it("liveTicks keeps only ticks still shown as rows, in tick order", () => {
    expect(liveTicks(["mhann", "bb", "cara"], ["bb", "cara"])).toEqual(["bb", "cara"]);
    expect(liveTicks(["cara", "bb"], ["bb", "cara", "dan"])).toEqual(["cara", "bb"]);
    expect(liveTicks(["mhann"], [])).toEqual([]);
  });

  it("End early and Request a time send only ticks still in their lists ((Owner, Nov 6, §304) the broken-key Dismiss is gone)", () => {
    const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    const top = src("src/app/app/tests/[id]/TopPanel.tsx");
    expect(top).toContain("useDropGoneTicks(p.working.map((w) => w.contractId), setPicked)");
    expect(top).toContain('go("end-early", { contractIds: chosenIds, reason })');
    expect(top).toContain("const allPicked = p.working.length > 0 && chosen.length === p.working.length;");
    const calls = src("src/app/app/tests/[id]/DevCallPanel.tsx");
    expect(calls).toContain("useDropGoneTicks(testers.map((t) => t.contractId), setTicked)");
    expect(calls).toContain("contractIds: tickedIds");
  });
});

describe("§278 no 'Refresh to see the latest' anywhere", () => {
  it("no source file under src/ says it", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && readFileSync(p, "utf8").includes("Refresh to see the latest")) hits.push(p);
      }
    };
    walk(join(process.cwd(), "src"));
    expect(hits).toEqual([]);
  });
});
