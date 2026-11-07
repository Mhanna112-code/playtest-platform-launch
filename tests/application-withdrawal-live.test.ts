import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { devChanges } from "@/lib/server/live";
import { GET as live } from "@/app/api/live/route";
import { json, makeUser, req } from "./helpers";
import { act, seen, settle, setup } from "./fixtures";

it("application withdrawal appears quietly in live updates, never stops another press, and refuses stale answers", async () => {
  const { dev, testId } = await setup({ joinMode: "apply" });
  const tester = await makeUser({ tester: true, name: "Applying Tester", pronoun: "they" });
  expect((await act(testId, "apply", tester.cookie, { note: "Sample application" })).status).toBe(200);
  const app = await db.application.findFirstOrThrow({ where: { testId, testerId: tester.user.id } });
  await settle();
  const loaded = seen();
  await settle();
  expect((await act(testId, "withdraw-application", tester.cookie, { seenAt: loaded })).status).toBe(200);
  const updates = await devChanges(dev.user.id, testId, new Date(loaded), "", db, { all: true });
  expect(updates.some((e) => e.kind === "withdrew_app" && e.text === "Applying Tester withdrew their application")).toBe(true);
  expect((await devChanges(dev.user.id, testId, new Date(loaded), "")).some((e) => e.kind === "withdrew_app")).toBe(false);
  const response = await json(await live(req(`/api/live?scope=test:${testId}&since=${encodeURIComponent(loaded)}`, { cookie: dev.cookie, method: "GET" })));
  expect(response.body.changes).toContainEqual(expect.objectContaining({ text: "Applying Tester withdrew their application", quiet: true }));
  for (const action of ["accept", "decline"]) expect((await act(testId, "application", dev.cookie, { applicationId: app.id, action, seenAt: loaded })).body.error).toMatchObject({ code: "gone", message: "Applying Tester withdrew their application." });
  expect((await act(testId, "withdraw-application", tester.cookie, {})).status).toBe(409);
  expect(await db.testEvent.count({ where: { testId, kind: "withdrew_app" } })).toBe(1);
  expect(await db.notification.count({ where: { userId: dev.user.id, groupKey: "appwithdrawn", testId } })).toBe(1);
});
