import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { db } from "@/lib/db";
import { rejoinLabels } from "@/lib/server/rejoinHistory";
import { RejoinTag } from "@/components/RejoinTag";
import { act, joined, sact, seen, setup } from "./fixtures";

it.each(["left", "ended"])("a rejoin after %s shows the orange tag for that departure, not on the first join", async (reason) => {
  const { dev, testId } = await setup();
  const j = await joined(testId, "Returning Tester", "they");
  let c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
  expect((await rejoinLabels(testId, [c])).get(c.id)).toBeUndefined();
  if (reason === "left") await sact(c.id, "leave", j.tester.cookie, { seenAt: seen(), confirmed: true });
  else await act(testId, "end-early", dev.cookie, { contractId: c.id, reason: "Local rejoin rehearsal", seenAt: seen(), confirmed: true });
  const invite = await act(testId, "invite", dev.cookie, { testerIds: [j.tester.user.id], seenAt: seen(), confirmed: true });
  expect(invite.status).toBe(200);
  const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
  expect((await act(testId, "join", j.tester.cookie, { listingVersion: t.listingVersion, seenAt: seen(), confirmed: true, ndaAccepted: true })).status).toBe(200);
  c = await db.contract.findUniqueOrThrow({ where: { id: c.id } });
  const label = (await rejoinLabels(testId, [c])).get(c.id);
  expect(label).toBe(reason === "left" ? "Previously left test" : "Previously ended early");
  const html = renderToStaticMarkup(React.createElement(RejoinTag, { label }));
  expect(html).toContain("text-orange-200");
  expect(html).toContain(label!);
});
