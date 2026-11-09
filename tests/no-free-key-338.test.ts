import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { NO_FREE_KEY, noFreeKeyFor, noKeyWaitingLine } from "@/lib/keys";
import { onSwitchToAnyone } from "@/lib/server/joining";
import { savedHref, savedNoteText } from "@/lib/savedNote";
import { makeUser } from "./helpers";
import { act, seen, settle, setup } from "./fixtures";

// (Owner, Nov 9, §338) No free access key never fails a press after its work is saved: an Invite that would join an applicant, and the switch to "Anyone can join".
// The test uses keys, but its only key is unassigned (its tester left; not returned to Free), so no key is free.
const noFreeKey = (testId: string) => db.accessKey.create({ data: { testId, value: `K-${Math.random().toString(36).slice(2, 8)}`, status: "unassigned" } });

describe("§338 no free access key", () => {
  it("the line names the applicant in the refusal's own words", () => {
    expect(noFreeKeyFor("Ana Silva")).toBe("Ana Silva: no access key is free right now, so this test can't take another tester until the developer adds one.");
    expect(NO_FREE_KEY).toBe("No access key is free right now, so this test can't take another tester until the developer adds one.");
  });

  it("Invite of several, one of whom applied: every invite is saved and every invitee told; the applicant who can't join is named; nothing fails", async () => {
    const { dev, testId } = await setup({ joinMode: "apply", spots: 5 });
    await noFreeKey(testId);
    const ana = await makeUser({ tester: true, name: "Ana Silva", pronoun: "she" });
    const ben = await makeUser({ tester: true, name: "Ben Cole", pronoun: "he" });
    const cam = await makeUser({ tester: true, name: "Cam Lee", pronoun: "they" });
    const devPageAt = seen();
    await settle();
    expect((await act(testId, "apply", ana.cookie, { seenAt: seen(), confirmed: true, note: "I sail a lot" })).status).toBe(200);
    await settle();
    const r = await act(testId, "invite", dev.cookie, { seenAt: devPageAt, testerIds: [ana.user.id, ben.user.id, cam.user.id], confirmed: true });
    expect(r.status).toBe(200);
    expect(r.body.message).toContain("Invited Ana Silva, Ben Cole and Cam Lee.");
    expect(r.body.message).toContain(noFreeKeyFor("Ana Silva"));
    expect(r.body.joined).toEqual([]);
    for (const t of [ana, ben, cam]) {
      expect((await db.invite.findFirst({ where: { testId, testerId: t.user.id } }))?.status).toBe("sent");
      expect(await db.notification.count({ where: { userId: t.user.id, text: { startsWith: "Nora Lane invited you to" } } })).toBe(1);
    }
    expect((await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } })).status).toBe("pending");
    expect(await db.contract.count({ where: { testId } })).toBe(0);
  });

  it("switch to Anyone can join with no free key: done, the applicants stay waiting, one line for the developer (the Save's note and the log)", async () => {
    const { testId } = await setup({ joinMode: "apply", spots: 5 });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    const ben = await makeUser({ tester: true, name: "Ben Cole" });
    for (const t of [ana, ben]) expect((await act(testId, "apply", t.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await noFreeKey(testId);
    // (The Save itself refuses too few keys for the open spots; this is the case where the keys run out under it, e.g. another tab or a join meanwhile.)
    await db.test.update({ where: { id: testId }, data: { joinMode: "anyone" } });
    const r = await onSwitchToAnyone(testId);
    expect(r.noKey).toEqual(["Ana Silva", "Ben Cole"]);
    expect((await db.application.findMany({ where: { testId } })).map((a) => a.status)).toEqual(["pending", "pending"]);
    expect(await db.contract.count({ where: { testId } })).toBe(0);
    const line = noKeyWaitingLine(r.noKey);
    expect(line).toBe("No access key is free, so these applications stay waiting: Ana Silva, Ben Cole. Add keys in Edit to let them join.");
    expect(await db.testEvent.count({ where: { testId, kind: "applied", text: line } })).toBe(1);
    const note = savedNoteText(Object.fromEntries(new URL(savedHref(testId, { offered: 0, noKeyApps: r.noKey }), "http://x").searchParams));
    expect(note).toEqual({ text: `Saved. ${line}`, extras: true });
    expect(noKeyWaitingLine(["Ana Silva"])).toBe("No access key is free, so this application stays waiting: Ana Silva. Add keys in Edit to let them join.");
  });
});
