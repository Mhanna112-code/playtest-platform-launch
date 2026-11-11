import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { POST as invitePOST } from "@/app/api/invites/[id]/route";
import { whenText } from "@/lib/server/adminRace";
import { accountState } from "@/lib/server/accountState";
import { GapDialog } from "@/components/GapDialog";
import { lengthFinder, RecordingVideo } from "@/components/RecordingVideo";
import { json, makeUser, req } from "./helpers";
import { act, seen, settle, setup } from "./fixtures";

// Nov 2 fixes B (owner, Nov 2; docs/BATCH-35.md §119): race refusals name who actually did it; each Pause / Stop keeps its own reason on the Timeline; the device
// icon in the needs pop-up; Delete after the same admin's Suspend in another tab; old recordings' time bar can be dragged.

// The components are compiled for the browser's JSX runtime; rendering them here needs React in scope.
(globalThis as unknown as { React: typeof React }).React = React;
const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
type Res = { status: number; body: { error?: { code: string; message: string; changes?: { text: string }[]; now?: string } } & Record<string, unknown> };
/** An admin press, optionally from one browser tab and page load (x-tab / x-load, as every browser press sends). */
const aact = (cookie: string, action: string, body: Record<string, unknown>, tab?: string, load?: string): Promise<Res> =>
  adminPOST(req(`/api/admin/${action}`, { cookie, body, headers: { ...(tab ? { "x-tab": tab } : {}), ...(load ? { "x-load": load } : {}) } }), { params: Promise.resolve({ action }) }).then(json);
async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test`, name: "Team Member" });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
/** Two presses at the same instant: exactly one goes through; returns [winner's index, the other's response]. */
function oneWins(rs: Res[]) {
  expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
  const w = rs.findIndex((r) => r.status === 200);
  return [w, rs[1 - w]] as const;
}
async function timeline(adminId: string, testId: string) {
  const { adminPage } = await import("@/lib/server/adminLists");
  return (await adminPage("t-timeline", adminId, null, testId)).rows as { text: string }[];
}

describe("§119 A: a race's refusal names the admin who actually did it, with that time", () => {
  it("two admins press Lift the pause at once, 10 times over: the refusal always names the winner and the lift's own time", async () => {
    for (let i = 0; i < 10; i++) {
      const a = await admin(), b = await admin();
      const s = await setup();
      expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking" })).status).toBe(200);
      const [w, lost] = oneWins(await Promise.all([aact(a.cookie, "unpause-test", { id: s.testId }), aact(b.cookie, "unpause-test", { id: s.testId })]));
      const winner = w === 0 ? a : b;
      const lift = await db.adminAction.findFirstOrThrow({ where: { targetId: s.testId, action: "unpause-test" } });
      expect(lift.adminId).toBe(winner.user.id);
      expect(lost.body.error!.message).toBe(`That test's pause was already lifted (by ${winner.user.email} at ${whenText(lift.createdAt)}).`);
      expect(await db.testEvent.count({ where: { testId: s.testId, text: "The team lifted the pause on this test" } })).toBe(1); // one lift, one line
    }
  });

  it("the lift's record commits inside the test's lock, and the losing press reads it inside that same transaction", () => {
    const r = src("lib/server/restrictions.ts");
    expect(r).toMatch(/const refused = await db\.\$transaction\(async \(tx\) => \{\s*await tx\.\$queryRaw`SELECT id FROM "Test" WHERE id = \$\{testId\} FOR UPDATE`;/);
    expect(r).toContain("return liftRefusal(testId, presserOf(adminId, seen), tx);");
    expect(r).toContain('if (adminId) await recordAction(tx, adminId, "unpause-test", testId, now);');
  });

  it("two admins press Delete account at once: one deletes it, the other is refused naming them and the deletion's time", async () => {
    for (let i = 0; i < 3; i++) {
      const a = await admin(), b = await admin();
      const x = await makeUser({ name: "Nora Lane", dev: true });
      const [w, lost] = oneWins(await Promise.all([aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email" }), aact(b.cookie, "delete-account", { id: x.user.id, note: "Asked by email" })]));
      const winner = w === 0 ? a : b;
      const u = await db.user.findUniqueOrThrow({ where: { id: x.user.id } });
      expect(await db.adminAction.findMany({ where: { targetId: x.user.id, action: "delete-account" }, select: { adminId: true } })).toEqual([{ adminId: winner.user.id }]);
      expect(lost.body.error!.message).toBe(`That account was already deleted (by ${winner.user.email} at ${whenText(u.deletedAt!)}).`);
    }
  });

  it("two admins press Close now at once: the test closes once; the other is refused naming who closed it", async () => {
    for (let i = 0; i < 3; i++) {
      const a = await admin(), b = await admin();
      const s = await setup();
      expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking" })).status).toBe(200);
      const [w, lost] = oneWins(await Promise.all([aact(a.cookie, "close-paused", { id: s.testId }), aact(b.cookie, "close-paused", { id: s.testId })]));
      const winner = w === 0 ? a : b;
      const t = await db.test.findUniqueOrThrow({ where: { id: s.testId } });
      expect(t.adminStoppedById).toBe(winner.user.id);
      expect(lost.body.error!.message).toBe(`That test was already closed (by ${winner.user.email} at ${whenText(t.pauseClosedAt!)}).`);
      expect(await db.testEvent.count({ where: { testId: s.testId, text: "The test was closed" } })).toBe(1);
    }
  });

  it("Approve and Dismiss on a possible outage at once: the other is refused naming who decided it and how", async () => {
    for (let i = 0; i < 3; i++) {
      const a = await admin(), b = await admin();
      const start = new Date(Date.now() - 30 * 3_600_000 - Math.floor(Math.random() * 1e9)), end = new Date(start.getTime() + 40 * 60_000);
      const g = `gap:${start.toISOString()}`;
      await db.appState.create({ data: { key: g, value: end.toISOString() } });
      const [w, lost] = oneWins(await Promise.all([aact(a.cookie, "approve-gap", { id: g }), aact(b.cookie, "dismiss-gap", { id: g })]));
      const winner = w === 0 ? a : b, did = w === 0 ? "approved" : "dismissed";
      const rec = await db.adminAction.findFirstOrThrow({ where: { targetId: g } });
      expect(rec.adminId).toBe(winner.user.id);
      expect(lost.body.error!.message).toBe(`That possible outage was already ${did} (by ${winner.user.email} at ${whenText(rec.createdAt)}).`);
      expect(await db.adminAction.count({ where: { targetId: g } })).toBe(1); // the route doesn't record it a second time
    }
  });

  it("Allow 3 more changes, Approve on a chargeback hold and Approve on a payment-hold lift keep their record with the claim", () => {
    const r = src("lib/server/restrictions.ts");
    expect(r).toContain('await recordAction(tx, adminId, "allow-critical-changes", testId);');
    expect(r).toContain("throw (await allowedRefusal(testId, presserOf(adminId, seen), tx))");
    expect(r).toContain('if (r.count === 1 && by === "admin" && adminId) await recordAction(tx, adminId, "delete-account", userId);');
    expect(src("lib/server/chargeback.ts")).toContain('record: r.count === 1 && adminId ? await race.recordAction(tx, adminId, "approve-chargeback", devId) : null');
    expect(src("lib/server/holds.ts")).toContain('if (r.count === 1) await tx.accountEvent.create({ data: { userId: devId, kind: "hold-approved", byId: adminId, note, side: "", createdAt: at } });');
    expect(src("lib/server/pauseClosure.ts")).toMatch(/const cancelled = await db\.\$transaction\(async \(tx\) => \{[\s\S]{0,300}FOR UPDATE`;\s*const fresh/);
    // The route records every other action afterwards as before, never these a second time.
    expect(src("lib/server/adminRace.ts")).toContain('export const RECORDED_INSIDE = new Set(["unpause-test", "allow-critical-changes", "delete-account", "approve-chargeback", "approve-gap", "dismiss-gap"]);');
    expect(src("app/api/admin/[action]/route.ts")).toContain("!RECORDED_INSIDE.has(action)");
  });

  // (Owner, Nov 11, §380) Both are already what the other wanted: exactly one happens, and the other goes through silently (no refusal).
  it("a Decline and the tester's Withdraw at once: exactly one happens, the other is silent", async () => {
    for (let i = 0; i < 4; i++) {
      const { dev, testId } = await setup({ joinMode: "apply" });
      const ana = await makeUser({ tester: true, name: "Ana Silva" });
      expect((await act(testId, "apply", ana.cookie, { note: "hi" })).body).toEqual({ applied: true });
      const app = await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } });
      await settle();
      const rs = (await Promise.all([act(testId, "application", dev.cookie, { applicationId: app.id, action: "decline", seenAt: seen(), confirmed: true }), act(testId, "withdraw-application", ana.cookie, {})])) as Res[];
      expect(rs.map((r) => r.status)).toEqual([200, 200]);
      expect(rs.filter((r) => r.body.already === true)).toHaveLength(1);
      const now = await db.application.findUniqueOrThrow({ where: { id: app.id } });
      expect(now.status).toBe(rs[0].body.already ? "withdrawn" : "declined"); // never overwritten by the silent one
    }
  });

  it("an Accept from a page older than the tester's Withdraw is refused naming it, and joins nobody", async () => {
    const { dev, testId } = await setup({ joinMode: "apply" });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    await act(testId, "apply", ana.cookie, { note: "hi" });
    const app = await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } });
    expect(src("lib/server/joining.ts")).toContain('{ applicationId: a.id, applicationStatus: "accepted" })');
    expect((await act(testId, "withdraw-application", ana.cookie, {})).status).toBe(200);
    const r = await act(testId, "application", dev.cookie, { applicationId: app.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(r.body.error.message).toBe("Ana Silva withdrew their application.");
    expect(await db.contract.count({ where: { testId, testerId: ana.user.id } })).toBe(0);
  });

  // (Owner, Nov 11, §380) Both are already what the other wanted: one wins, the invite keeps its status, the other goes through silently.
  it("Cancel invite and the tester's No thanks at once: one wins, the invite keeps its status, the other is silent", async () => {
    for (let i = 0; i < 4; i++) {
      const { dev, testId } = await setup({ joinMode: "invite" });
      const ana = await makeUser({ tester: true, name: "Ana Silva" });
      expect((await act(testId, "invite", dev.cookie, { testerIds: [ana.user.id], seenAt: seen(), confirmed: true })).status).toBe(200);
      const inv = await db.invite.findFirstOrThrow({ where: { testId, testerId: ana.user.id } });
      await settle();
      const rs = (await Promise.all([
        act(testId, "cancel-invite", dev.cookie, { inviteId: inv.id, seenAt: seen(), confirmed: true }),
        json(await invitePOST(req(`/api/invites/${inv.id}`, { cookie: ana.cookie, body: {} }), { params: Promise.resolve({ id: inv.id }) })),
      ])) as Res[];
      expect(rs.map((r) => r.status)).toEqual([200, 200]);
      expect(rs.filter((r) => r.body.already === true)).toHaveLength(1);
      const w = rs[0].body.already ? 1 : 0;
      const now = await db.invite.findUniqueOrThrow({ where: { id: inv.id } });
      expect(now.status).toBe(w === 0 ? "cancelled" : "declined");
    }
  });
});

describe("§119 B1: each Pause and Stop quotes its own reason on the admin's test Timeline", () => {
  it("a Pause and a Stop within the same second: each line quotes its own reason, never the test's latest note", async () => {
    const a = await admin();
    const s = await setup();
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "Checking reports" })).status).toBe(200);
    expect((await aact(a.cookie, "stop-test", { id: s.testId, note: "Spam listing" })).status).toBe(200);
    expect((await db.test.findUniqueOrThrow({ where: { id: s.testId } })).adminNote).toBe("Spam listing"); // the test's one note is the Stop's
    const rows = await timeline(a.user.id, s.testId);
    expect(rows.find((r) => r.text.includes("paused this test"))!.text).toMatch(/paused this test: “Checking reports”$/);
    expect(rows.find((r) => r.text.includes("stopped this test"))!.text).toMatch(/stopped this test: “Spam listing”$/);
  });

  it("a Pause with no reason, then a Stop: the pause line has no quote", async () => {
    const a = await admin();
    const s = await setup();
    expect((await aact(a.cookie, "pause-test", { id: s.testId, note: "" })).status).toBe(200);
    expect((await aact(a.cookie, "stop-test", { id: s.testId, note: "Spam listing" })).status).toBe(200);
    const rows = await timeline(a.user.id, s.testId);
    expect(rows.find((r) => r.text.includes("paused this test"))!.text).toMatch(/paused this test$/);
  });
});

describe("§119 B2: the needs pop-up's device icon", () => {
  const dialog = (gaps: { languages: string[]; devices: string[] }) =>
    renderToStaticMarkup(createElement(GapDialog, { testId: "t", ask: "join", initial: gaps, needs: gaps, devName: "Nora Lane", send: async () => ({}) as never, onCovered: () => {}, onClose: () => {}, press: "Join" }));
  it("“A device this test runs on” shows the device icon (Monitor); a language, or both, keep the language icon", () => {
    const dev = dialog({ languages: [], devices: ["iOS"] });
    expect(dev).toMatch(/data-gap-icon="device"[^>]*>[\s\S]*A device this test runs on/);
    expect(dev).toContain("lucide-monitor");
    expect(dev).not.toContain('data-gap-icon="language"');
    const lang = dialog({ languages: ["Spanish"], devices: [] });
    expect(lang).toContain('data-gap-icon="language"');
    expect(lang).toContain("A language this test needs");
    expect(dialog({ languages: ["Spanish"], devices: ["iOS"] })).toContain('data-gap-icon="language"');
  });
});

describe("§119 B3: Delete account after the same admin's Suspend in another tab", () => {
  it("the Delete page loaded before the Suspend (not redrawn) stops once naming “You suspended … in another tab”; the second press deletes", async () => {
    const a = await admin();
    const x = await makeUser({ name: "Nora Lane", dev: true, tester: true });
    const pageB = (await accountState(x.user.id))!; // window B's Delete button sends this state's time
    await settle();
    expect((await aact(a.cookie, "suspend", { id: x.user.id, side: "developer", note: "Fraud reports", since: pageB.at }, "tab-A", "tab-A.1")).status).toBe(200);
    const stop = await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since: pageB.at }, "tab-B", "tab-B.1");
    expect(stop.status).toBe(409);
    expect(stop.body.error!.code).toBe("stop_once");
    expect(stop.body.error!.changes!.map((c) => c.text)).toEqual([expect.stringMatching(/^You suspended the developer side in another tab at \d{1,2}:\d{2}\s[AP]M\.$/)]);
    expect((await db.user.findUniqueOrThrow({ where: { id: x.user.id } })).deletedAt).toBeNull();
    expect((await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since: pageB.at, confirmed: true, boxAt: stop.body.error!.now }, "tab-B", "tab-B.1")).status).toBe(200);
  });

  it("an older page that sends only its tab (no page load) stops once too", async () => {
    const a = await admin();
    const x = await makeUser({ name: "Nora Lane", dev: true });
    const pageB = (await accountState(x.user.id))!;
    await settle();
    expect((await aact(a.cookie, "suspend", { id: x.user.id, note: "Fraud reports" }, "tab-A")).status).toBe(200);
    expect((await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since: pageB.at }, "tab-B")).body.error!.code).toBe("stop_once");
  });

  it("a page that redrew after the Suspend (it shows it) deletes straight away", async () => {
    const a = await admin();
    const x = await makeUser({ name: "Nora Lane", dev: true });
    expect((await aact(a.cookie, "suspend", { id: x.user.id, note: "Fraud reports" }, "tab-A", "tab-A.1")).status).toBe(200);
    await settle();
    const redrawn = (await accountState(x.user.id))!;
    expect(redrawn.suspended.developer).toBeTruthy(); // the redrawn page shows the suspension
    expect((await aact(a.cookie, "delete-account", { id: x.user.id, note: "Asked by email", since: redrawn.at }, "tab-B", "tab-B.2")).status).toBe(200);
  });
});

describe("§119 B4: recordings without a stored length can be dragged", () => {
  const player = (duration: number) => ({ duration, currentTime: 0, dataset: {} as Record<string, string | undefined> });
  it("no stored length (Infinity): it asks for a time past the end, learns the real length, goes back to the start and reports it", () => {
    const found: number[] = [];
    const finding = { current: false };
    const f = lengthFinder(finding, (s) => found.push(s));
    const v = player(Infinity);
    f.loaded(v);
    expect(v.currentTime).toBe(1e101);
    expect(found).toEqual([]);
    f.durationChanged(v); // still Infinity: keeps waiting
    expect(finding.current).toBe(true);
    v.duration = 83.4;
    f.durationChanged(v);
    expect(v.currentTime).toBe(0);
    expect(found).toEqual([83.4]);
    expect(v.dataset.lengthFound).toBe("83.4");
    f.durationChanged(v); // later changes (playing) don't move it again
    expect(found).toEqual([83.4]);
  });

  it("a recording with a stored length plays as before: the length at once, no seek", () => {
    const found: number[] = [];
    const f = lengthFinder({ current: false }, (s) => found.push(s));
    const v = player(12);
    f.loaded(v);
    expect(v.currentTime).toBe(0);
    expect(found).toEqual([12]);
  });

  it("every recording player uses it (the session's rows, sent attachments, written answers' files, the recorder's preview)", () => {
    expect(renderToStaticMarkup(createElement(RecordingVideo, { src: "/api/recordings/x/file" }))).toMatch(/^<video controls="" preload="metadata" src="\/api\/recordings\/x\/file" data-recording-video=""><\/video>$/);
    for (const f of ["app/app/sessions/[id]/RecordingUpload.tsx", "components/AttachmentList.tsx", "components/AnswerSets.tsx", "components/ScreenRecorder.tsx"]) {
      expect(src(f)).toContain("<RecordingVideo ");
      expect(src(f)).not.toContain("<video");
    }
  });
});
