import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { NOT_TAKING_LINE, appClosedLine, hiddenByBlock } from "@/lib/server/blocks";
import { joinPageChanges } from "@/lib/server/joining";
import { findTests } from "@/lib/server/tests";
import { json, makeUser, req } from "./helpers";
import { act, joined, sact, seen, setup } from "./fixtures";

// Batch 16 section 11 (owner, Oct 28): a block either way hides the developer's tests the tester was never part of; tests they were part of stay.
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const block = (cookie: string, userId: string, action?: string) => blocksPOST(req("/api/blocks", { cookie, body: { userId, action } })).then(json);
const lines = (userId: string) => db.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

for (const who of ["the developer blocks the tester", "the tester blocks the developer"] as const) {
  describe(`a block hides the developer's other tests: ${who}`, () => {
    it("Find and a direct link hide the tests they were never part of; a test they were in stays; pending applications close neutrally; rejoin asks are refused neutrally; unblock brings them back", async () => {
      // One test the tester is working on, one they left earlier (could ask to rejoin), one they applied to, one they never touched.
      const a = await setup({ spots: 5 });
      const dev = a.dev;
      const ana = await joined(a.testId, "Ana Silva");
      const left = await setup({ spots: 5 });
      await db.test.update({ where: { id: left.testId }, data: { developerId: dev.user.id } });
      const l = await act(left.testId, "join", ana.tester.cookie, { listingVersion: 1 });
      expect(l.status).toBe(200);
      expect((await sact(l.body.sessionId, "leave", ana.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
      const applied = await setup({ joinMode: "apply", spots: 5 });
      await db.test.update({ where: { id: applied.testId }, data: { developerId: dev.user.id } });
      expect((await act(applied.testId, "apply", ana.tester.cookie, { listingVersion: 1, seenAt: seen(), confirmed: true })).status).toBe(200);
      const other = await setup({ spots: 5 });
      await db.test.update({ where: { id: other.testId }, data: { developerId: dev.user.id } });
      const anaUser = await db.user.findUniqueOrThrow({ where: { id: ana.tester.user.id } });
      expect((await findTests(anaUser as never)).some((t) => t.id === other.testId)).toBe(true);

      if (who === "the developer blocks the tester") expect((await block(dev.cookie, ana.tester.user.id)).status).toBe(200);
      else expect((await block(ana.tester.cookie, dev.user.id)).status).toBe(200);

      // Find: none of this developer's tests.
      const found = await findTests(anaUser as never);
      for (const id of [a.testId, left.testId, applied.testId, other.testId]) expect(found.some((t) => t.id === id)).toBe(false);
      // A direct link: the test they never touched is hidden (the page reads "This test isn't available right now."); the ones they were part of are not.
      expect(await hiddenByBlock(ana.tester.user.id, { id: other.testId, developerId: dev.user.id })).toBe(true);
      for (const id of [a.testId, left.testId, applied.testId]) expect(await hiddenByBlock(ana.tester.user.id, { id, developerId: dev.user.id }), id).toBe(false);
      expect(await joinPageChanges(ana.tester.user.id, other.testId, new Date(Date.now() - 60_000).toISOString(), "")).toEqual([]);
      // The working session ended (neutral line), the pending application closed with the neutral line; the developer gets no line about it.
      expect((await db.contract.findUniqueOrThrow({ where: { id: ana.sessionId } })).status).toBe("ended");
      const app = await db.application.findFirstOrThrow({ where: { testId: applied.testId, testerId: ana.tester.user.id } });
      expect(app).toMatchObject({ status: "closed", closedReason: "blocked" });
      expect((await lines(ana.tester.user.id)).some((n) => n.text === appClosedLine("Harbor Run") && n.text === "“Harbor Run”: your application was closed.")).toBe(true);
      expect((await lines(dev.user.id)).some((n) => /application/.test(n.text) && /closed/.test(n.text))).toBe(false);
      expect((await act(applied.testId, "application", dev.cookie, { applicationId: app.id, decision: "accept", seenAt: seen(), confirmed: true })).body.error.message).toBe("Ana Silva's application was closed.");
      // Never revealed to either side's lines.
      for (const n of [...(await lines(ana.tester.user.id)), ...(await lines(dev.user.id))]) expect(n.text).not.toMatch(/block/i);
      // Rejoin ask: refused neutrally; Join on the hidden test and Apply: refused.
      expect((await act(left.testId, "rejoin-ask", ana.tester.cookie, { listingVersion: 1, seenAt: seen(), confirmed: true })).body.error.message).toBe(NOT_TAKING_LINE);
      const joinOther = (await act(other.testId, "join", ana.tester.cookie, { listingVersion: 1 })).body.error.message;
      expect(joinOther).toBe(who === "the developer blocks the tester" ? NOT_TAKING_LINE : "You blocked Nora Lane: unblock them in Account → Blocked people to join.");
      // Invites can't be sent.
      expect((await act(other.testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [ana.tester.user.id] })).body.message).toBe("Ana Silva can't be invited right now.");

      // Unblock: everything back as before (Find, links); nothing closed by the block reopens by itself.
      if (who === "the developer blocks the tester") await block(dev.cookie, ana.tester.user.id, "unblock");
      else await block(ana.tester.cookie, dev.user.id, "unblock");
      expect((await findTests(anaUser as never)).some((t) => t.id === other.testId)).toBe(true);
      expect(await hiddenByBlock(ana.tester.user.id, { id: other.testId, developerId: dev.user.id })).toBe(false);
      expect((await db.application.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("closed");
      expect((await db.contract.findUniqueOrThrow({ where: { id: ana.sessionId } })).status).toBe("ended");
    }, 60_000);
  });
}

describe("the pages (section 11)", () => {
  it("the listing hides a blocked developer's test the tester was never part of, with the paused test's line; the profile reads as unavailable (batch 20 section 17)", () => {
    const page = src("app/app/find/[id]/page.tsx");
    // (Batch 17 §18) The same line also covers an open invite-only test for a tester who isn't invited, applying or in it.
    expect(page).toContain("if (((paused && !involved) || inviteOnly || (blocked && !involved && t.developerId !== u.id)) && !isAdmin(u)) {");
    expect(page).toContain("This test isn&apos;t available right now.");
    // (Batch 20 section 17) Blocked by them: "This profile isn't available."; blocked by you: the profile with Unblock and their tests hidden.
    expect(src("app/app/developers/[id]/page.tsx")).toContain("(await db.block.count({ where: { blockerId: p.id, blockedId: viewer.id } })) > 0;");
    expect(src("app/app/developers/[id]/page.tsx")).toContain("if (theyBlocked) return <ProfileUnavailable />;");
  });
  it("another tester (no block) still sees everything", async () => {
    const { dev, testId } = await setup();
    const ben = await makeUser({ tester: true, name: "Ben Carter", pronoun: "he" });
    const cam = await makeUser({ tester: true, name: "Cam Lee", pronoun: "they" });
    await block(dev.cookie, ben.user.id);
    expect(await hiddenByBlock(ben.user.id, { id: testId, developerId: dev.user.id })).toBe(true);
    expect(await hiddenByBlock(cam.user.id, { id: testId, developerId: dev.user.id })).toBe(false);
    expect(await hiddenByBlock(dev.user.id, { id: testId, developerId: dev.user.id })).toBe(false);
  });
});
