import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, joined, sact, seen, settle, setup } from "./fixtures";
import { json, req } from "./helpers";

// (Owner, Nov 11, §376) The session page's top notices and the paused rules for chat and excerpts.

const auth = vi.hoisted(() => ({ user: null as User | null }));
vi.mock("@/lib/server/page-auth", () => ({ requirePageUser: async () => auth.user, adminAway() {} }));
vi.mock("@/components/OtherSideNotice", () => ({ otherSideNotice: async () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/sessions/demo", useRouter: () => ({ refresh() {}, push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(), notFound: () => { throw Error("not found"); }, redirect: () => { throw Error("redirect"); } }));
(globalThis as unknown as { React: typeof React }).React = React;

async function sessionHtml(sessionId: string, testerId: string) {
  auth.user = await db.user.findUniqueOrThrow({ where: { id: testerId } });
  const { default: Page } = await import("@/app/app/sessions/[id]/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: sessionId }) }));
}
const pause = (testId: string) => db.test.update({ where: { id: testId }, data: { adminPausedAt: new Date(), pausedSince: new Date() } });

describe("§376 item 1: a tester whose part is over reads only the ended notice", () => {
  it("left, then the test paused: the ended notice only, never the paused one", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    expect((await sact(j.sessionId, "leave", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await settle();
    await pause(f.testId);
    const html = await sessionHtml(j.sessionId, j.tester.user.id);
    expect(html).toContain('data-stopped-line=""');
    expect(html).not.toContain('data-paused=""');
    expect(html).not.toContain("This test is paused right now");
  });

  it("paused first, then ended early: the ended notice only", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    await db.user.update({ where: { id: f.dev.user.id }, data: { holdStartedAt: new Date() } });
    await db.contract.update({ where: { id: j.sessionId }, data: { status: "ended", endKind: "early", endedAt: new Date() } });
    const html = await sessionHtml(j.sessionId, j.tester.user.id);
    expect(html).toContain('data-stopped-line=""');
    expect(html).not.toContain('data-paused=""');
  });

  it("a tester still working on a paused test keeps the paused notice", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    await pause(f.testId);
    const html = await sessionHtml(j.sessionId, j.tester.user.id);
    expect(html).toContain('data-paused=""');
    expect(html).not.toContain('data-stopped-line=""');
  });
});

describe("§376 item 2: chat and Ask to show an excerpt go on during every pause", () => {
  const ANSWER = "The harbour level felt great, but the second boss was far too hard for me.";
  const pay = async (cookie: string, body: Record<string, unknown>) => (await import("@/app/api/review/route")).POST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
  const ex = async (cookie: string, body: Record<string, unknown>) => (await import("@/app/api/excerpts/route")).POST(req("/api/excerpts", { cookie, body })).then(json);

  for (const kind of ["team", "hold", "chargeback", "suspension"] as const) {
    it(`(${kind}) the tester's chat Send and excerpt request go through; the paused notice offers both`, async () => {
      const f = await setup();
      const j = await joined(f.testId);
      await sact(j.sessionId, "written", j.tester.cookie, { answers: [ANSWER, "Nowhere, it was smooth."], seenAt: seen(), confirmed: true });
      const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
      expect((await pay(f.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
      if (kind === "team") await pause(f.testId);
      if (kind === "hold") await db.user.update({ where: { id: f.dev.user.id }, data: { holdStartedAt: new Date(), holdReason: "unpaid" } });
      if (kind === "chargeback") await db.user.update({ where: { id: f.dev.user.id }, data: { holdStartedAt: new Date(), holdReason: "chargeback" } });
      if (kind === "suspension") await db.user.update({ where: { id: f.dev.user.id }, data: { devSuspendedAt: new Date() } });
      const html = await sessionHtml(j.sessionId, j.tester.user.id);
      expect(html).toContain('data-paused=""');
      expect(html).toMatch(/This test is paused right now\. For now you can [^<]*ask to show an excerpt, and chat\./);
      expect((await sact(j.sessionId, "message", j.tester.cookie, { body: "Hello?" })).status).toBe(200);
      expect((await ex(j.tester.cookie, { action: "request", submissionId: sub.id, index: 0, text: "the second boss was far too hard" })).status).toBe(200);
    });
  }

  it("the tester's own restriction still closes their chat (batch 15 §1)", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    await db.user.update({ where: { id: j.tester.user.id }, data: { testerSuspendedAt: new Date() } });
    expect((await sact(j.sessionId, "message", j.tester.cookie, { body: "Hi" })).status).not.toBe(200);
    // The developer's message to a restricted tester is turned back with the neutral line.
    expect((await act(f.testId, "message", f.dev.cookie, { contractId: j.sessionId, body: "Hi" })).body.error.code).toBe("chat_paused");
  });

  it("the ended notice offers chat during a pause too", async () => {
    const f = await setup();
    const j = await joined(f.testId);
    await db.contract.update({ where: { id: j.sessionId }, data: { status: "ended", endKind: "early", endedAt: new Date() } });
    await pause(f.testId);
    const html = await sessionHtml(j.sessionId, j.tester.user.id);
    expect(html).toMatch(/data-stopped-line=""[^]*You can still [^<]*chat\./);
  });
});

describe("§376 item 3: one outcome per button (Send Answers / Add / a recording's Send)", () => {
  const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");
  it("a refusal (paused or any other) is a refusal; a box, a form mistake, a too-fast or a server error is not", async () => {
    const { pressRefusal } = await import("@/lib/topStop");
    const { ApiError } = await import("@/lib/client");
    expect(pressRefusal(new ApiError(409, "paused", "This test is paused right now, so your Send Answers didn't go through."))).toBe(true);
    expect(pressRefusal(new ApiError(409, "gone", "Your part in this test has ended, so your Add didn't go through."))).toBe(true);
    expect(pressRefusal(new ApiError(409, "stop_once", "Press again to go ahead."))).toBe(false);
    expect(pressRefusal(new ApiError(400, "bad_answers", "Answer every required question."))).toBe(false);
    expect(pressRefusal(new ApiError(429, "too_fast", "Wait a minute."))).toBe(false);
    expect(pressRefusal(new ApiError(500, "error", "Something went wrong."))).toBe(false);
    expect(pressRefusal(new Error("offline"))).toBe(false);
  });

  it("a refused press takes away the box under its button; the test pausing takes it away too (kept through redraws by §371's pressCarry)", () => {
    const s = src("app/app/sessions/[id]/SessionActions.tsx");
    const form = s.split("export function WrittenForm")[1].split("export function WrittenAddForm")[0];
    const add = s.split("export function WrittenAddForm")[1].split("export function LeaveButton")[0];
    const rec = src("app/app/sessions/[id]/RecordingUpload.tsx");
    for (const part of [form, add, rec]) {
      expect(part).toMatch(/if \(pressRefusal\((err|e)\)\) \{ setBox\(null\); setBoxAt\(""\); \}\s*(\/\/[^\n]*\n\s*)?const sb = stopBox/);
    }
    expect(form).toContain('useEffect(() => { if (!canSend) { setBox(null); setBoxAt(""); } }, [canSend, setBox, setBoxAt]);');
    expect(add).toContain('useEffect(() => { if (!canSend) { setBox(null); setBoxAt(""); } }, [canSend, setBox]);');
    expect(rec).toContain('useEffect(() => { if (!sendable) { setBox(null); setBoxAt(""); } }, [sendable, setBox]);');
    // The Send Answers box is the part's carried box (§371): clearing it clears it for the form a redraw swapped in too.
    expect(form).toContain("const [box, setBox] = useStopBox(carry);");
  });
});
