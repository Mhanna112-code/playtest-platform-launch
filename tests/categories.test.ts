import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { json, makeUser, req } from "./helpers";
import { act, listingBody, setup } from "./fixtures";
import { CATEGORIES } from "@/lib/options";

// (Owner, Oct 23) Categories as in the full app: its list, several ticks, at least one.
describe("categories", () => {
  it("the full app's list exactly", () => {
    expect(CATEGORIES).toEqual(["Game", "Productivity", "Social", "Entertainment", "Education", "Health & fitness", "Finance", "Shopping", "Business", "Developer tools", "AI", "Other"]);
  });

  it("several are kept; unknown ones dropped; none ticked is a red mistake on Post and Edit", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane", pronoun: "she" });
    const none = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ categories: [] }) })));
    expect(none.status).toBe(400);
    expect(none.body.error.message).toBe("Tick at least one category.");
    const bogus = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ categories: ["Game: Puzzle"] }) })));
    expect(bogus.status).toBe(400);
    const ok = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ categories: ["Game", "Education", "Nope"] }) })));
    expect(ok.status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: ok.body.id } })).categories).toEqual(["Game", "Education"]);

    const { dev: d2, testId } = await setup();
    const v = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    const cleared = await act(testId, "edit", d2.cookie, { version: v, fields: { categories: [] }, confirmed: true });
    expect(cleared.status).toBe(400);
    expect(cleared.body.error.message).toBe("Tick at least one category.");
    expect((await act(testId, "edit", d2.cookie, { version: v, fields: { categories: ["AI", "Business"] }, confirmed: true })).status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: testId } })).categories).toEqual(["AI", "Business"]);
  });
});
