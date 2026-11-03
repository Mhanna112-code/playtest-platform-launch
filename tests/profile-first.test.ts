import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { PROFILE_FIRST, profileSaved } from "@/lib/server/tests";
import { act, joined, setup } from "./fixtures";
import { makeUser } from "./helpers";

// (Owner, Nov 2) Like a developer's card before posting: a tester saves their profile (a device and a language) before Join, Apply or Ask to rejoin.
describe("a saved tester profile before joining", () => {
  it("an empty profile (as sign-up leaves it) can't join; once saved it can", async () => {
    const s = await setup();
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    await db.testerProfile.update({ where: { userId: t.user.id }, data: { devices: [], languages: [] } });
    expect(profileSaved(await db.testerProfile.findUnique({ where: { userId: t.user.id } }))).toBe(false);
    const test = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
    const r = await act(s.testId, "join", t.cookie, { listingVersion: test.listingVersion });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "profile_first", message: PROFILE_FIRST });
    expect(await db.contract.count({ where: { testId: s.testId, testerId: t.user.id } })).toBe(0);
    await db.testerProfile.update({ where: { userId: t.user.id }, data: { devices: ["Windows PC"], languages: ["English"] } });
    expect((await act(s.testId, "join", t.cookie, { listingVersion: test.listingVersion })).status).toBe(200);
  });
  it("a tester with a saved profile joins as before", async () => {
    const s = await setup();
    const j = await joined(s.testId);
    expect(j.sessionId).toBeTruthy();
  });
});
