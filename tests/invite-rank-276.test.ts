import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { invitePanel, testerRowInfo } from "@/lib/server/invites";
import { ratingSummary } from "@/lib/server/ratings";
import { personHoverFor } from "@/lib/server/personHover";
import { ratingTile } from "@/lib/server/profileStats";
import { makeUser, uniq } from "./helpers";
import { setup } from "./fixtures";

// (Owner, Nov 5, §276) Invite testers: a tester row shows only the ratings they got as a tester (Rating rows with side "developer": a developer rated them);
// unrated testers (no revealed tester-side rating) come after every rated one: meets, rated, score, accepted, matches.
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const profile = (userId: string, devices: string[]) => db.testerProfile.update({ where: { userId }, data: { devices } });

/** `n` revealed ratings of `rateeId` with `stars`. side "developer" = a developer rated them as a tester; "tester" = their own tester rated them as a developer. */
async function rate(rateeId: string, side: "developer" | "tester", stars: number, n = 1, raterId = `rater-${uniq()}`) {
  await db.rating.createMany({ data: Array.from({ length: n }, () => ({ testId: `t-${uniq()}`, contractId: `c-${uniq()}`, side, raterId, rateeId, stars, revealedAt: new Date() })) });
}

describe("§276 a tester row shows only the ratings they got as a tester", () => {
  it("someone with only a developer-side rating reads \"No ratings yet\" in Invite testers and ranks as unrated", async () => {
    const tag = uniq();
    const filler = `filler-${tag}`;
    try {
      const { dev, testId } = await setup();
      // Rita joined first, so on a tie (newest first) Dual would lead: only the rated-first rule puts Rita ahead.
      const rated = await makeUser({ tester: true, name: `Rita Rated ${tag}` });
      const dual = await makeUser({ tester: true, dev: true, name: `Dual Dee ${tag}` });
      // Their own tester rated Dual 3★ as a developer; Rita got one 1★ as a tester (a low score); some 5★ elsewhere keep the platform's average above 1.
      await rate(dual.user.id, "tester", 3);
      await rate(rated.user.id, "developer", 1);
      await rate(`nobody-${tag}`, "developer", 5, 3, filler);

      expect((await ratingSummary(dual.user.id, "tester")).line).toBe("");
      expect((await ratingSummary(dual.user.id, "developer")).line).toBe("3.0 ★ (1 rating)");

      const p = await invitePanel(dev.user.id, testId, { q: tag });
      const row = p.found.find((r) => r.id === dual.user.id)!;
      expect(row.rating).toBe("No ratings yet");
      expect(row.ratingAvg).toBeNull();
      expect(row.detail).not.toContain("3.0");
      // Rated first, even with a lower score.
      expect(ids(p.found)).toEqual([rated.user.id, dual.user.id]);
      expect(ids(p.suggested)).toEqual([rated.user.id, dual.user.id]);
      expect(p.found[1].score).toBeGreaterThan(p.found[0].score);
      expect(p.found[0]).toMatchObject({ rating: "1.0 ★ (1 rating)", ratingAvg: 1 });

      // Application and invited rows (testerRowInfo), the hover from the developer side and the tester tiles: the tester side only.
      const info = (await testerRowInfo(dev.user.id, { devices: [], languages: [] }, [{ id: dual.user.id, profile: null }])).get(dual.user.id)!;
      expect(info.seen.rating).toBeNull();
      expect(new Date(info.changedAt).getTime()).toBe(0);
      const u = await db.user.findUniqueOrThrow({ where: { id: dual.user.id } });
      expect((await personHoverFor(dev.user.id, "developer", u))?.summary).toEqual(["No ratings yet"]);
      expect((await personHoverFor(rated.user.id, "tester", u))?.summary).toEqual(["3.0 ★ (1 rating)"]);
      expect(await ratingTile(dual.user.id, "tester")).toEqual({ value: "-", hint: "no ratings yet" });
      expect(await ratingTile(dual.user.id, "developer")).toEqual({ value: "3.0 ★", hint: "1 rating" });
    } finally {
      await db.rating.deleteMany({ where: { raterId: filler } });
    }
  });

  it("the other one-sided places use their side", () => {
    expect(src("app/app/find/[id]/page.tsx")).toContain('ratingSummary(t.developerId, "developer")');
    expect(src("app/app/find/page.tsx")).toContain('ratingSummary(id, "developer")');
    expect(src("app/app/sessions/[id]/page.tsx")).toContain('ratingSummary(c.test.developerId, "developer")');
    expect(src("app/app/tests/[id]/page.tsx")).toContain('ratingSummary(c.testerId, "tester")');
    expect(src("app/app/page.tsx")).toContain('ratingSummary(userId, "tester")');
    expect(src("app/app/profile/page.tsx")).toContain("ratingSummary(u.id, side)");
    expect(src("lib/server/joining.ts")).toContain('ratingSummary(tester.id, "tester")');
    const tiles = src("components/ProfileTiles.tsx");
    expect(tiles).toContain('ratingTile(userId, "developer")');
    expect(tiles).toContain('ratingTile(userId, "tester")');
  });
});

describe("§276 unrated testers come after every rated one", () => {
  it("with the platform average above 4, an unrated tester still ranks after one with many 4★ ratings, in Suggested and Find", async () => {
    const tag = uniq();
    const filler = `filler-${tag}`;
    try {
      // Push the platform's average (developer-side, revealed) above 4 with this test's own 5★ rows (removed at the end).
      const agg = await db.rating.aggregate({ where: { side: "developer", revealedAt: { not: null } }, _sum: { stars: true }, _count: { _all: true } });
      const sum = agg._sum.stars ?? 0, count = agg._count._all;
      const need = Math.max(1, Math.ceil((4.3 * count - sum) / 0.7) + 1);
      await rate(`nobody-${tag}`, "developer", 5, need, filler);
      const { dev, testId } = await setup();
      const una = await makeUser({ tester: true, name: `Una Unrated ${tag}` });
      const fay = await makeUser({ tester: true, name: `Fay Four ${tag}` });
      await rate(fay.user.id, "developer", 4, 30);
      const avg = (await db.rating.aggregate({ where: { side: "developer", revealedAt: { not: null } }, _avg: { stars: true } }))._avg.stars!;
      expect(avg).toBeGreaterThan(4);

      const p = await invitePanel(dev.user.id, testId, { q: tag });
      expect(ids(p.suggested)).toEqual([fay.user.id, una.user.id]);
      expect(ids(p.found)).toEqual([fay.user.id, una.user.id]);
      // The score alone would put Una first (she starts at the platform's average); the formula is unchanged.
      expect(p.found[1].score).toBeGreaterThan(p.found[0].score);
      expect(p.found[1].score).toBeCloseTo(avg, 1);
      expect(p.found.map((r) => r.rating)).toEqual(["4.0 ★ (30 ratings)", "No ratings yet"]);
    } finally {
      await db.rating.deleteMany({ where: { raterId: filler } });
    }
  });

  it("among rated testers the score decides; meeting the requirements still comes first", async () => {
    const tag = uniq();
    const { dev, testId } = await setup({ devices: ["Mac"] });
    const high = await makeUser({ tester: true, name: `Ann High ${tag}` });
    const low = await makeUser({ tester: true, name: `Bea Low ${tag}` });
    const unrated = await makeUser({ tester: true, name: `Cy None ${tag}` });
    const winStar = await makeUser({ tester: true, name: `Dot Win ${tag}` });
    for (const u of [high, low, unrated]) await profile(u.user.id, ["Mac"]);
    await rate(high.user.id, "developer", 5, 5);
    await rate(low.user.id, "developer", 3, 5);
    await rate(winStar.user.id, "developer", 5, 20); // the best score, but doesn't meet (no Mac)

    const p = await invitePanel(dev.user.id, testId, { q: tag });
    const order = [high.user.id, low.user.id, unrated.user.id, winStar.user.id];
    expect(ids(p.found)).toEqual(order);
    expect(ids(p.suggested)).toEqual(order);
    expect(p.found.map((r) => r.meets)).toEqual([true, true, true, false]);
  });
});
