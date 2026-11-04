import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ACCOUNT_CLOSED, BLOCKED_SINCE, inviteRestore, RATED_THIS_TEST, WHY_IN_TEST } from "@/lib/server/invites";
import { INVITE_TICKS_PREFIX, dropAllInviteTicks, inviteTicksKey, notTickedLine, readInviteTicks, restoredTicks, writeInviteTicks } from "@/lib/inviteTicks";
import type { StoreLike } from "@/lib/keepTyped";
import { makeUser } from "./helpers";
import { act, joined, setup } from "./fixtures";

// (Owner, Nov 4, §173) The invite panel's ticks survive a reload in the same tab; on restore anyone who can't be invited any more is dropped and named.

const src = (p: string) => fs.readFileSync(path.join(__dirname, "..", "src", p), "utf8").replace(/\r\n/g, "\n");

function memStore(init: Record<string, string> = {}): StoreLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}
const brokenStore: StoreLike = {
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); },
  removeItem: () => { throw new Error("blocked"); },
  key: () => { throw new Error("blocked"); },
  get length(): number { throw new Error("blocked"); },
};

describe("§173: the tab's kept invite ticks", () => {
  it("are kept per account and test, emptied when the ticks empty, and all go at a sign-in or sign-out", () => {
    const s = memStore({ "pt-typed:u1:developer:/app/tests/t1": "{}", other: "x" });
    const k1 = inviteTicksKey("u1", "t1");
    expect(k1).toBe(`${INVITE_TICKS_PREFIX}u1:t1`);
    expect(inviteTicksKey("u2", "t1")).not.toBe(k1);
    expect(readInviteTicks(s, k1)).toEqual([]);
    writeInviteTicks(s, k1, ["a", "b"]);
    writeInviteTicks(s, inviteTicksKey("u1", "t2"), ["c"]);
    expect(readInviteTicks(s, k1)).toEqual(["a", "b"]);
    // A successful Invite empties the ticks: the kept copy goes.
    writeInviteTicks(s, k1, []);
    expect(s.data.has(k1)).toBe(false);
    // Junk reads as nothing.
    s.setItem(k1, "{not json");
    expect(readInviteTicks(s, k1)).toEqual([]);
    s.setItem(k1, JSON.stringify(["a", 3, "", "a", "b"]));
    expect(readInviteTicks(s, k1)).toEqual(["a", "b"]);
    // Sign-in / sign-out: every kept tick in the tab goes; other keys stay.
    dropAllInviteTicks(s);
    expect([...s.data.keys()].sort()).toEqual(["other", "pt-typed:u1:developer:/app/tests/t1"]);
  });

  it("never throws without storage", () => {
    expect(readInviteTicks(null, "k")).toEqual([]);
    expect(readInviteTicks(brokenStore, "k")).toEqual([]);
    expect(() => writeInviteTicks(brokenStore, "k", ["a"])).not.toThrow();
    expect(() => writeInviteTicks(null, "k", [])).not.toThrow();
    expect(() => dropAllInviteTicks(brokenStore)).not.toThrow();
    expect(() => dropAllInviteTicks(null)).not.toThrow();
  });

  it("restore: only the still-invitable come back (with anything ticked meanwhile); the dropped are named in one line", () => {
    const answer = { keep: [{ id: "a" }, { id: "c" }], drop: [{ id: "b", name: "Ana Silva", why: WHY_IN_TEST }, { id: "d", name: "Dee Moss", why: "can't join this test" }] };
    expect(restoredTicks(["a", "b", "c", "d", "ghost"], ["z", "c"], answer)).toEqual({ ticked: ["z", "c", "a"], dropped: answer.drop });
    // A dropped name not among the kept ids is never shown.
    expect(restoredTicks(["a"], [], answer)).toEqual({ ticked: ["a"], dropped: [] });
    expect(notTickedLine(answer.drop)).toBe("Not ticked any more: Ana Silva (already in this test), Dee Moss (can't join this test).");
    expect(notTickedLine([])).toBe("");
  });

  it("the server keeps only people the panel can still invite, and names everyone else with the panel's own reasons", async () => {
    const { dev, testId } = await setup();
    const mk = (name: string, pronoun = "she") => makeUser({ tester: true, name, pronoun }).then((u) => u.user);
    const ok = await mk("Okay Person");
    const invited = await mk("Ivy Invited");
    await db.invite.create({ data: { testId, testerId: invited.id } });
    const inTest = (await joined(testId, "Ana Silva")).tester.user;
    const applicant = await mk("Abe Applied", "he");
    await db.application.create({ data: { testId, testerId: applicant.id, listing: {}, kind: "apply" } });
    const suspended = await mk("Sue Suspended");
    await db.user.update({ where: { id: suspended.id }, data: { testerSuspendedAt: new Date() } });
    const rated = await mk("Rae Rated");
    await db.contract.create({ data: { testId, testerId: rated.id, listingVersion: 1, title: "Harbor Run", buildUrl: "", description: "", questions: [], deadlineDays: 7, dueAt: new Date(Date.now() + 7 * 86_400_000), status: "left", endKind: "rated" } });
    const blocked = await mk("Bo Blocked");
    await db.block.create({ data: { blockerId: dev.user.id, blockedId: blocked.id } });
    const gone = await mk("Gus Gone");
    await db.user.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    const notTester = await makeUser({ dev: true, name: "Dana Dev" });

    const ids = [ok.id, invited.id, inTest.id, applicant.id, suspended.id, rated.id, blocked.id, gone.id, notTester.user.id, "nobody"];
    const r = await inviteRestore(dev.user.id, testId, ids);
    expect(r.keep.map((x) => x.id)).toEqual([ok.id]);
    // The kept row carries what the panel needs for someone outside its current lists.
    expect(r.keep[0]).toMatchObject({ name: "Okay Person", grey: null, devices: ["Windows PC"], languages: ["English"] });
    expect(typeof r.keep[0].availability).toBe("string");
    expect(r.drop).toEqual([
      { id: invited.id, name: "Ivy Invited", why: "already invited, waiting for her to join" },
      { id: inTest.id, name: "Ana Silva", why: WHY_IN_TEST },
      { id: applicant.id, name: "Abe Applied", why: "applied: answer him in Needs you" },
      { id: suspended.id, name: "Sue Suspended", why: "can't join this test" },
      { id: rated.id, name: "Rae Rated", why: RATED_THIS_TEST.charAt(0).toLowerCase() + RATED_THIS_TEST.slice(1) },
      { id: blocked.id, name: "Bo Blocked", why: BLOCKED_SINCE },
      { id: gone.id, name: "Deleted account", why: ACCOUNT_CLOSED },
    ]);
    expect(notTickedLine(r.drop.slice(0, 2))).toBe("Not ticked any more: Ivy Invited (already invited, waiting for her to join), Ana Silva (already in this test).");

    // Through the test page's route; only the test's own developer.
    const viaRoute = await act(testId, "invite-restore", dev.cookie, { testerIds: [ok.id, inTest.id] });
    expect(viaRoute.status).toBe(200);
    expect(viaRoute.body.keep.map((x: { id: string }) => x.id)).toEqual([ok.id]);
    expect(viaRoute.body.drop).toEqual([{ id: inTest.id, name: "Ana Silva", why: WHY_IN_TEST }]);
    const other = await makeUser({ dev: true, name: "Other Dev" });
    expect((await act(testId, "invite-restore", other.cookie, { testerIds: [ok.id] })).status).toBe(404);
    expect(await inviteRestore(dev.user.id, testId, [])).toEqual({ keep: [], drop: [] });
  }, 60_000);

  it("the panel: kept as ticks change (only once the restore answered), cleared on a successful Invite and at every sign-in / sign-out; the search box isn't kept", () => {
    const panel = src("app/app/tests/[id]/InvitePanel.tsx");
    expect(panel).toContain("if (ticksReady) writeInviteTicks(tabStore(), ticksKey, ticked);");
    expect(panel).toContain("`/api/tests/${p.testId}/invite-restore`, { testerIds: kept }");
    // A successful Invite: the ticks empty and the kept copy goes at once (a restore still on its way never brings them back).
    const sent = panel.slice(panel.indexOf("    if (r) {\n      setConfirm(null);\n      setMsg(r.message);"));
    expect(sent.slice(0, 400)).toContain("setTicked([]);");
    expect(sent.slice(0, 400)).toContain("restoring.current = false;");
    expect(sent.slice(0, 400)).toContain("writeInviteTicks(tabStore(), ticksKey, []);");
    expect(panel).toContain('{dropped.length > 0 && <p className="note" data-invite-dropped="">{notTickedLine(dropped)}</p>}');
    // The search box is never kept.
    expect(panel).not.toMatch(/writeInviteTicks\([^)]*\bq\b/);
    expect(panel.match(/writeInviteTicks\(/g)?.length).toBe(2);
    // The page passes the signed-in account (the key names it).
    expect(src("app/app/tests/[id]/page.tsx")).toContain("userId={u.id}");
    // Sign-in / sign-out: SessionWatch's forgetTyped (announceAuth and every account change) drops them with the typed snapshots.
    const watch = src("components/SessionWatch.tsx");
    const forget = watch.slice(watch.indexOf("function forgetTyped()"));
    expect(forget.slice(0, 200)).toContain("dropAllInviteTicks(tabStore());");
  });
});
