import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { runDaily } from "@/lib/server/holds";
import { makeUser } from "./helpers";
import { act, seen, setup } from "./fixtures";

// (Owner, Dec 2026) Invite reminders wait while the invited tester's tester side is suspended (the invite stays open) and resume after her reinstatement on
// the daily rule: one line on the first run after, never one per missed day. The developer's daily "… wait for your answer" leaves out applicants whose tester
// side is suspended (or whose account was deleted): none answerable left, no line.

const DAY = 86_400_000;
const H = 3_600_000;

describe("(Owner, Dec 2026) reminders about a tester whose tester side is suspended", () => {
  it("invite reminders wait during her suspension, then one line the first run after her reinstatement", async () => {
    const { dev, testId } = await setup();
    const t = await makeUser({ tester: true, name: "Dee Moss" });
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [t.user.id] })).status).toBe(200);
    const inv = await db.invite.findFirstOrThrow({ where: { testId, testerId: t.user.id } });
    await db.invite.update({ where: { id: inv.id }, data: { createdAt: new Date(Date.now() - 5 * DAY) } }); // invited 5 days ago, never reminded
    const lines = () => db.notification.count({ where: { userId: t.user.id, reminderKey: `invite:${inv.id}` } });
    await db.user.update({ where: { id: t.user.id }, data: { testerSuspendedAt: new Date(Date.now() - 4 * DAY) } });
    await runDaily();
    expect(await lines()).toBe(0); // suspended: it waits
    expect((await db.invite.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("sent"); // the invite stays open
    await db.user.update({ where: { id: t.user.id }, data: { testerSuspendedAt: null } }); // reinstated
    await runDaily();
    expect(await lines()).toBe(1); // one line, not one per missed day
    await runDaily(new Date(Date.now() + 2 * H));
    expect(await lines()).toBe(1); // the same day: no second
    await runDaily(new Date(Date.now() + DAY));
    expect(await lines()).toBe(2); // daily again
  }, 180_000);

  it("the developer's applications line leaves out a suspended or deleted applicant; none answerable left: no line", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const a = await makeUser({ tester: true, name: "Ann Bell" });
    const b = await makeUser({ tester: true, name: "Bo Cruz" });
    for (const x of [a, b]) expect((await act(testId, "apply", x.cookie, { note: "Hi" })).status).toBe(200);
    // Applications made before the suspension and the deletion (a suspension withdraws them; these stand for one written meanwhile).
    await db.user.update({ where: { id: a.user.id }, data: { testerSuspendedAt: new Date() } });
    const lines = () => db.notification.findMany({ where: { userId: dev.user.id, testId, text: { endsWith: "for your answer" } } });
    await runDaily();
    expect((await lines()).map((n) => n.text)).toEqual(["“Harbor Run”: 1 application or rejoin ask waits for your answer"]);
    await db.user.update({ where: { id: b.user.id }, data: { deletedAt: new Date() } });
    await runDaily(new Date(Date.now() + DAY));
    expect(await lines()).toHaveLength(1); // none answerable: no line
    await db.user.update({ where: { id: a.user.id }, data: { testerSuspendedAt: null } }); // reinstated: counted again
    await runDaily(new Date(Date.now() + 2 * DAY));
    expect((await lines()).map((n) => n.text)).toEqual(["“Harbor Run”: 1 application or rejoin ask waits for your answer", "“Harbor Run”: 1 application or rejoin ask waits for your answer"]);
  }, 180_000);
});
