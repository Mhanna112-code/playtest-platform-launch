import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { liftsWhen } from "@/lib/pause";
import { pauseTest, suspendAccount } from "@/lib/server/restrictions";
import { renderTimes } from "@/lib/tz";
import { makeUser } from "./helpers";
import { setup } from "./fixtures";

// (Owner, Nov 11, §390 c) The developer's team-pause line read "The team paused “…”: it closes on Nov 25 unless your account is cleared" (the suspension's words)
// when the developer was suspended too. Each pause names what lifts IT: the team's pause leads with "unless the team lifts the pause".

async function admin() {
  const a = await makeUser({ email: `admin-390c-${Date.now()}-${Math.random().toString(36).slice(2)}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
const paused = async (devId: string) => (await db.notification.findFirstOrThrow({ where: { userId: devId, text: { startsWith: "The team paused" } } })).text;

describe("§390 c: a team pause never reads as a suspension", () => {
  it("each cause's own words, the line's own pause first", () => {
    expect(liftsWhen(["team"])).toBe("the team lifts the pause");
    expect(liftsWhen(["suspension", "team"], "team")).toBe("the team lifts the pause and your account is cleared");
    expect(liftsWhen(["hold", "team"], "team")).toBe("the team lifts the pause and you pay what you owe");
    expect(liftsWhen(["chargeback"])).toBe("you finish the steps");
  });

  it("the team pauses a test: '… unless the team lifts the pause'", async () => {
    const a = await admin();
    const s = await setup();
    await pauseTest(a.user.id, s.testId, "Checking a report about this test.");
    expect(renderTimes(await paused(s.dev.user.id), "UTC")).toMatch(/^The team paused “Harbor Run”: it closes on [A-Z][a-z]{2} \d{1,2} unless the team lifts the pause$/);
  });

  it("the team pauses a test of a suspended developer: the team's lift first (never the suspension's words alone)", async () => {
    const a = await admin();
    const s = await setup();
    await suspendAccount(a.user.id, s.dev.user.id, "Checking a report about this account.", "developer");
    await pauseTest(a.user.id, s.testId, "Checking a report about this test.");
    expect(renderTimes(await paused(s.dev.user.id), "UTC")).toMatch(/^The team paused “Harbor Run”: it closes on [A-Z][a-z]{2} \d{1,2} unless the team lifts the pause and your account is cleared$/);
  });
});
