import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { json, makeUser, req } from "./helpers";
import { act, listingBody, setup } from "./fixtures";
import { BASE_LIMIT, MAX_LIMIT, earnedLimit, overLimitText, step, type SentPiece } from "@/lib/capacity";
import { testerCapacity } from "@/lib/server/capacity";

// (Owner, Oct 23, NEWEST+9) Tester capacity per test.
const at = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 3_600_000);
const ratings = (stars: number[], from = 0) => stars.map((s, i) => ({ stars: s, at: at(from + i) }));
const tens = (n: number, stars: number) => Array.from({ length: n }, () => stars);

describe("tester capacity: the growth maths", () => {
  it("starts at 10; +10% (at least 1) per 10 ratings when half are 3 stars or more; up to 50", () => {
    expect(step(10)).toBe(1);
    expect(step(11)).toBe(2);
    expect(earnedLimit([], [])).toEqual({ limit: BASE_LIMIT, ratings: 0, nextIn: 10 });
    expect(earnedLimit(ratings(tens(9, 5)), []).limit).toBe(10);
    expect(earnedLimit(ratings(tens(9, 5)), []).nextIn).toBe(1);
    expect(earnedLimit(ratings(tens(10, 5)), []).limit).toBe(11);
    expect(earnedLimit(ratings(tens(20, 5)), []).limit).toBe(13);
    // Exactly half 3 stars or more is enough; four of ten isn't (with no reviews to count).
    expect(earnedLimit(ratings([3, 3, 3, 3, 3, 1, 1, 1, 1, 1]), []).limit).toBe(11);
    expect(earnedLimit(ratings([3, 3, 3, 3, 1, 1, 1, 1, 1, 1]), []).limit).toBe(10);
    const many = earnedLimit(ratings(tens(400, 5)), []);
    expect(many.limit).toBe(MAX_LIMIT);
    expect(many.nextIn).toBeNull();
  });

  it("or the developer reviewed at least 90% of the work sent them, as that batch completed", () => {
    const low = ratings(tens(10, 1));
    const reviewed = (n: number, missed: number, when = at(-1)): SentPiece[] => [
      ...Array.from({ length: n }, () => ({ reviewedAt: when, missedAt: null })),
      ...Array.from({ length: missed }, () => ({ reviewedAt: null, missedAt: when })),
    ];
    expect(earnedLimit(low, reviewed(9, 1)).limit).toBe(11);
    expect(earnedLimit(low, reviewed(8, 2)).limit).toBe(10);
    // Reviews after the batch completed don't count toward it.
    expect(earnedLimit(low, reviewed(9, 1, at(100))).limit).toBe(10);
  });

  it("never shrinks: the most earned before stays", () => {
    expect(earnedLimit([], [], 13).limit).toBe(13);
    expect(earnedLimit(ratings(tens(10, 1)), [], 15).limit).toBe(15);
  });
});

describe("tester capacity: Post and Edit", () => {
  it("Post refuses spots above the limit (red at spots); at the limit it posts", async () => {
    const dev = await makeUser({ dev: true, name: "Nora Lane", pronoun: "she" });
    const over = await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ spots: 11 }) })));
    expect(over.status).toBe(400);
    expect(over.body.error.message).toBe(overLimitText(10));
    expect(over.body.error.message).toBe("You can take up to 10 testers per test right now.");
    expect((await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ spots: 10 }) })))).status).toBe(200);
  });

  it("a test already above the limit keeps its spots; raising them is refused; the stored limit never shrinks", async () => {
    const { dev, testId } = await setup();
    await db.test.update({ where: { id: testId }, data: { spots: 20 } });
    const v = async () => (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
    expect((await act(testId, "edit", dev.cookie, { version: await v(), fields: { title: "Harbor Run II" }, confirmed: true })).status).toBe(200);
    const up = await act(testId, "edit", dev.cookie, { version: await v(), fields: { spots: 21 }, confirmed: true });
    expect(up.status).toBe(400);
    expect(up.body.error.message).toBe(overLimitText(10));
    expect((await act(testId, "edit", dev.cookie, { version: await v(), fields: { spots: 15 }, confirmed: true })).status).toBe(200);
    // Earned 13 before (stored): with no ratings now it stays 13, and 13 spots post.
    await db.user.update({ where: { id: dev.user.id }, data: { testerLimit: 13 } });
    expect((await testerCapacity(dev.user.id)).limit).toBe(13);
    expect((await json(await testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ spots: 13 }) })))).status).toBe(200);
  });
});
