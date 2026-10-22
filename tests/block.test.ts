import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as blocksPOST } from "@/app/api/blocks/route";
import { POST as joinPOST } from "@/app/api/calls/[id]/join/route";
import { POST as reviewPOST } from "@/app/api/review/route";
import * as R from "@/lib/rules";
import { json, makeUser, req } from "./helpers";
import { act, bookCall, joined, sact, seen, setup } from "./fixtures";

const block = (cookie: string, userId: string, action?: string) => blocksPOST(req("/api/blocks", { cookie, body: { userId, action } })).then(json);
const join = (cookie: string, id: string) => joinPOST(req(`/api/calls/${id}/join`, { cookie, body: {} }), { params: Promise.resolve({ id }) }).then(json);
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe("join call refusals", () => {
  const base = { status: "booked", startsAt: new Date("2026-11-05T15:00:00Z"), minutes: 30, noShow: false, paused: false, testStatus: "open", contractStatus: "working", blocked: false, side: "tester" as const };
  const t = (iso: string) => new Date(iso);
  const fmt = () => "2:50 PM";
  it("opens 10 minutes before and closes 30 minutes after the end", () => {
    expect(R.joinCallRefusal(base, t("2026-11-05T14:49:00Z"), fmt)).toBe("You can join from 2:50 PM.");
    expect(R.joinCallRefusal(base, t("2026-11-05T14:51:00Z"), fmt)).toBe("");
    expect(R.joinCallRefusal(base, t("2026-11-05T16:01:00Z"), fmt)).toBe("This call is over.");
  });
  it("cancelled, blocked, no-show, paused, stopped, ended or left", () => {
    const now = t("2026-11-05T15:05:00Z");
    expect(R.joinCallRefusal({ ...base, status: "cancelled" }, now, fmt)).toBe("This call was cancelled.");
    expect(R.joinCallRefusal({ ...base, blocked: true }, now, fmt)).toBe("This call isn't available.");
    expect(R.joinCallRefusal({ ...base, noShow: true }, now, fmt)).toBe("This call was reported as a no-show.");
    expect(R.joinCallRefusal({ ...base, paused: true }, now, fmt)).toBe("This test is paused.");
    expect(R.joinCallRefusal({ ...base, testStatus: "stopped" }, now, fmt)).toBe("This test was stopped.");
    expect(R.joinCallRefusal({ ...base, contractStatus: "ended" }, now, fmt)).toBe("Your session ended.");
    expect(R.joinCallRefusal({ ...base, contractStatus: "left" }, now, fmt)).toBe("You left this test.");
  });
});

describe("block", () => {
  async function withCall() {
    const s = await setup();
    const j = await joined(s.testId);
    await bookCall(s.testId, s.dev.cookie, j.sessionId, j.tester.cookie, 48);
    const slots = [{ id: "" }, { id: "" }];
    await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"] });
    return { ...s, ...j, slots };
  }

  it("the developer blocks: session ends (neutral line), calls cancelled, sent work still payable, chat closed, no booking or invites", async () => {
    const { dev, testId, tester, sessionId, slots } = await withCall();
    expect((await block(dev.cookie, tester.user.id)).body).toMatchObject({ blocked: true, ended: 1 });
    expect(await db.notification.count({ where: { userId: tester.user.id, text: "Your session on Harbor Run ended." } })).toBe(1);
    expect(await db.notification.count({ where: { userId: tester.user.id, text: { contains: "block" } } })).toBe(0); // never revealed
    expect((await db.call.findFirstOrThrow({ where: { contractId: sessionId } })).status).toBe("cancelled");
    expect((await sact(sessionId, "written", tester.cookie, { answers: ["x", "y"] })).body.error.message).toBe("Your session on Harbor Run ended.");
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await reviewPOST(req("/api/review", { cookie: dev.cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 } }))).status).toBe(200);
    expect((await sact(sessionId, "message", tester.cookie, { body: "Hello?" })).body.error.message).toBe("This chat is closed.");
    expect((await sact(sessionId, "request-time", tester.cookie, { seenAt: seen(), confirmed: true, startsAt: inHours(72) })).status).toBe(409);
    expect(slots).toHaveLength(2);
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), confirmed: true, testerIds: [tester.user.id] })).status).toBe(200); // already in this test: skipped
    const s2 = await setup();
    expect((await act(s2.testId, "invite", s2.dev.cookie, { seenAt: seen(), testerIds: [tester.user.id] })).status).toBe(200); // a different developer can still invite
  });

  it("a blocked tester can't join or be invited to the blocker's tests (neutral wording); unblock reopens nothing", async () => {
    const { dev, testId } = await setup({ spots: 5 });
    const ben = await makeUser({ tester: true, name: "Ben Carter", pronoun: "he" });
    await block(dev.cookie, ben.user.id);
    expect((await act(testId, "join", ben.cookie, { listingVersion: 1 })).body.error.message).toBe("This test isn't taking new testers right now.");
    const inv = await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [ben.user.id] });
    expect(inv.body.message).toBe("Ben Carter can't be invited right now.");
    await block(dev.cookie, ben.user.id, "unblock");
    expect((await act(testId, "join", ben.cookie, { listingVersion: 1 })).status).toBe(200);
  });

  it("the tester blocks the developer: told how to unblock when trying to join; Join call refused", async () => {
    const { dev, testId, tester, sessionId } = await withCall();
    const call = await db.call.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await join(tester.cookie, call.id)).body.error.message).toMatch(/^You can join from /);
    await block(tester.cookie, dev.user.id);
    expect((await join(dev.cookie, call.id)).body.error.message).toBe("This call was cancelled.");
    const s2 = await setup();
    await db.test.update({ where: { id: s2.testId }, data: { developerId: dev.user.id } });
    expect((await act(s2.testId, "join", tester.cookie, { listingVersion: 1 })).body.error.message).toBe("You blocked Nora Lane: unblock them in Settings → Blocked people to join.");
    expect(testId).toBeTruthy();
  });
});
