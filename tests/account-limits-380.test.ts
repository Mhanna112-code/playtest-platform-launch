import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as testsPOST } from "@/app/api/tests/route";
import { MAX_ACTIVE_TESTS, TEST_LIMIT_LINE } from "@/lib/rules";
import { SECOND_TEST_LINE } from "@/lib/subscription";
import { json, makeUser, req } from "./helpers";
import { act, listingBody, setup } from "./fixtures";

// (Owner, Nov 11, §380 N) Account-wide limits are counted inside a lock on the person's account row: the tester's 10 working tests (Join, Accept, a rejoin
// accepted) and the developer's open tests (Post, Accept testers again). Two presses at once in two tabs: the second counts the first.

const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");

describe("§380 N: account-wide limits under the account's lock", () => {
  it("the tester at 9 working tests joins two tests at once: one goes in, the other reads the limit", async () => {
    const t = await makeUser({ tester: true, name: "Ana Silva" });
    for (let i = 0; i < MAX_ACTIVE_TESTS - 1; i++) {
      const s = await setup();
      expect((await act(s.testId, "join", t.cookie, { listingVersion: 1 })).status).toBe(200);
    }
    const [a, b] = [await setup(), await setup()];
    const r = await Promise.all([a, b].map((s) => act(s.testId, "join", t.cookie, { listingVersion: 1 })));
    expect(r.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(r.find((x) => x.status === 409)!.body.error.message).toBe(TEST_LIMIT_LINE);
    expect(await db.contract.count({ where: { testerId: t.user.id, status: "working" } })).toBe(MAX_ACTIVE_TESTS);
  }, 120_000);

  it("a free-plan developer posts two tests at once: one opens, the other reads the one-open-test line", async () => {
    process.env.FREE_UNTIL = new Date(Date.now() - 86_400_000).toISOString(); // free during launch is over: the free plan's one open test
    const dev = await makeUser({ dev: true, name: "Nora Lane" });
    await db.user.update({ where: { id: dev.user.id }, data: { stripePaymentMethodId: "pm_test_saved", cardExpMonth: 12, cardExpYear: 2030 } });
    const post = (title: string) => testsPOST(req("/api/tests", { cookie: dev.cookie, body: listingBody({ title, productName: title }) })).then(json);
    const r = await Promise.all([post("Harbor Run"), post("Reef Dash")]);
    expect(r.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(r.find((x) => x.status === 409)!.body.error.message).toBe(SECOND_TEST_LINE);
    expect(await db.test.count({ where: { developerId: dev.user.id, status: "open" } })).toBe(1);
    delete process.env.FREE_UNTIL;
  });

  it("every way in counts under the lock", () => {
    const tests = src("lib/server/tests.ts");
    expect(tests).toContain('await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${tester.id} FOR UPDATE`;');
    expect(tests.match(/canOpenAnotherLocked\(tx, dev\.id/g)?.length).toBe(3); // Post, a draft's Post, Accept testers again
  });
});
