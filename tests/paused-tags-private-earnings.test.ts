import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { paidRows } from "@/lib/server/paymentRows";
import { joined, sact, seen, setup } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/app/tests/example", useSearchParams: () => new URLSearchParams() }));
(globalThis as unknown as { React: typeof React }).React = React;

it("keeps the listing tags and adds Paused rather than replacing the status", async () => {
  const { TopPanel } = await import("@/app/app/tests/[id]/TopPanel");
  const props = { id: "example", title: "Example", status: "open", terms: "", spotsLine: "1 spot", seenAt: new Date().toISOString(), working: [], parts: { written: false, recording: false, live: true }, keysLeft: 4, categories: ["Developer tools"], joinMode: "anyone" };
  const normal = renderToStaticMarkup(React.createElement(TopPanel, props));
  const paused = renderToStaticMarkup(React.createElement(TopPanel, { ...props, paused: true, restricted: true }));
  for (const label of ["Accepting testers", "Live call", "4 keys left", "Developer tools", "Anyone who matches joins instantly"]) {
    expect(normal).toContain(label);
    expect(paused).toContain(label);
  }
  expect(paused).toContain(">Paused<");
  expect(normal).not.toContain(">Paused<");
});

it("omits the developer's repayment method from tester earnings while retaining the developer's own explanation", async () => {
  const { dev, testId } = await setup();
  const j = await joined(testId, "Earnings Tester", "they");
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true })).status).toBe(200);
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  const one = await db.payment.create({ data: { kind: "owed", developerId: dev.user.id, testerId: dev.user.id, amountCents: 1000, feeCents: 1000, testerCents: 0, status: "bundled", settledAt: new Date(), note: "press" } });
  const p = await db.payment.create({ data: { kind: "review", submissionId: sub.id, contractId: j.sessionId, developerId: dev.user.id, testerId: j.tester.user.id, amountCents: 1000, feeCents: 200, testerCents: 800, status: "charged", owedUntil: new Date(), settledAt: new Date(), coveredById: one.id } });
  const tester = (await paidRows([p], "tester")).get(p.id)!;
  expect(tester.how).toBe("");
  expect(tester.full).toContain("your written answers");
  expect((await paidRows([p], "developer")).get(p.id)!.how).toContain("paid through Pay what you owe");
});
