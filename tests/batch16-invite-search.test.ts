import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { SEARCH_LIMIT, invitePanel, searchCapLine } from "@/lib/server/invites";
import { act, setup } from "./fixtures";

// Batch 16 section 12 (bug found Oct 28): the invite panel's lists are worked out on the server over EVERY tester (it loaded only the newest 500).
const DAY = 86_400_000;

/** `n` testers created after everyone else (the newest accounts on the platform). */
async function newer(n: number, name: (i: number) => string) {
  const base = Date.now() + 365 * DAY;
  await db.user.createMany({ data: Array.from({ length: n }, (_, i) => ({ email: `n-${randomUUID()}@test.playtest.test`, name: name(i), isTester: true, createdAt: new Date(base + i * 1000) })) });
}

describe("invite: Search by name finds every tester (section 12)", () => {
  it("over 500 newer testers: the oldest one is found (any part of the name, any case); blocked either way and deleted never appear; the ticks narrow it", async () => {
    const tag = randomUUID().slice(0, 6);
    const { dev, testId } = await setup();
    const old = new Date(Date.now() - 900 * DAY);
    const mk = (name: string, devices: string[] = [], extra: Record<string, unknown> = {}) =>
      db.user.create({ data: { email: `t-${randomUUID()}@test.playtest.test`, name, isTester: true, createdAt: old, ...extra, profile: { create: { devices, languages: ["English"], categories: [] } } } });
    const target = await mk(`Fbbb Quillon ${tag}`, [`Rare-${tag}`]);
    const mac = await mk(`Fbbb Mac ${tag}`, ["Mac"]);
    const blocker = await mk(`Fbbb Blocker ${tag}`);
    const blockedByDev = await mk(`Fbbb Blocked ${tag}`);
    const gone = await mk(`Fbbb Gone ${tag}`, [], { deletedAt: new Date() });
    await db.block.create({ data: { blockerId: blocker.id, blockedId: dev.user.id } });
    await db.block.create({ data: { blockerId: dev.user.id, blockedId: blockedByDev.id } });
    await newer(520, (i) => `Filler ${tag} ${i}`);
    expect(await db.user.count({ where: { isTester: true, createdAt: { gt: target.createdAt } } })).toBeGreaterThan(500);

    const names = async (q: string, filters: { devices?: string[] } = {}) => (await invitePanel(dev.user.id, testId, { q, ...filters })).found.map((x) => x.name);
    expect(await names(`quillon ${tag}`)).toEqual([`Fbbb Quillon ${tag}`]);
    expect(await names(`QUILLON ${tag.toUpperCase()}`)).toEqual([`Fbbb Quillon ${tag}`]); // any case
    expect(await names(`llon ${tag}`)).toEqual([`Fbbb Quillon ${tag}`]); // any part of the name
    const all = await names(`fbbb`);
    expect(all).toEqual(expect.arrayContaining([`Fbbb Quillon ${tag}`, `Fbbb Mac ${tag}`]));
    for (const n of [`Fbbb Blocker ${tag}`, `Fbbb Blocked ${tag}`, `Fbbb Gone ${tag}`]) expect(all).not.toContain(n);
    // The device tick narrows the search.
    expect(await names(`fbbb`, { devices: ["Mac"] })).toEqual([`Fbbb Mac ${tag}`]);
    // One character searches nothing.
    expect((await invitePanel(dev.user.id, testId, { q: "f" })).found).toEqual([]);
    // Suggested is worked out over every tester too: the oldest account with the ticked device is suggested.
    expect((await invitePanel(dev.user.id, testId, { devices: [`Rare-${tag}`] })).suggested.map((x) => x.id)).toEqual([target.id]);
    // Through the test page's route.
    const r = await act(testId, "invite-search", dev.cookie, { q: `quillon ${tag}` });
    expect(r.status).toBe(200);
    expect(r.body.found.map((x: { id: string }) => x.id)).toEqual([target.id]);
    expect(r.body.foundTotal).toBe(1);
    expect(r.body.capLine).toBe("");
    void mac;
    void gone;
  }, 120_000);

  it("more than 100 matches: the first 100 and “Showing 100 of N: type more of the name”; nothing is capped silently", async () => {
    const tag = randomUUID().slice(0, 6);
    const { dev, testId } = await setup();
    await newer(SEARCH_LIMIT + 7, (i) => `Capcase ${tag} ${i}`);
    const p = await invitePanel(dev.user.id, testId, { q: `capcase ${tag}` });
    expect(p.found.length).toBe(SEARCH_LIMIT);
    expect(p.foundTotal).toBe(SEARCH_LIMIT + 7);
    expect(p.capLine).toBe(`Showing 100 of ${SEARCH_LIMIT + 7}: type more of the name`);
    expect(searchCapLine(240)).toBe("Showing 100 of 240: type more of the name");
    // Exactly the limit or fewer: every match and no line.
    const few = await invitePanel(dev.user.id, testId, { q: `capcase ${tag} 10` });
    expect(few.capLine).toBe("");
    expect(few.found.length).toBe(few.foundTotal);
  }, 60_000);

  it("another developer can't read the panel of someone else's test", async () => {
    const a = await setup();
    const b = await setup();
    const r = await act(a.testId, "invite-search", b.dev.cookie, { q: "ana" });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});
