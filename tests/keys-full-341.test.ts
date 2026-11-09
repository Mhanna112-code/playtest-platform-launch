import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { NO_FREE_KEY, noFreeKeyFor } from "@/lib/keys";
import { keysFullNow, noFreeKeyTests } from "@/lib/server/accessKeys";
import { joinRefusal } from "@/lib/server/joining";
import { findTests } from "@/lib/server/tests";
import { joinPageV } from "@/lib/server/pulseV";
import { KeysNotice } from "@/app/app/tests/[id]/KeysNotice";
import { makeUser } from "./helpers";
import { act, seen, settle, setup } from "./fixtures";

// (Owner, Nov 9, §341) A test that uses access keys with NO free key while a spot is open is FULL to testers (Find, the join page, Join / Apply / Accept invite),
// but nothing closes (applications, rejoin asks and invites stay); the developer's Accept / Invite-that-joins get the key line; the developer's page says how to
// reopen the spot; adding a key makes it joinable again and tells invitees a spot opened.
(globalThis as unknown as { React: typeof React }).React = React;
const unassigned = (testId: string) => db.accessKey.create({ data: { testId, value: `U-${Math.random().toString(36).slice(2, 8)}`, status: "unassigned" } });
const addFreeKey = async (testId: string, cookie: string) => {
  const version = (await db.test.findUniqueOrThrow({ where: { id: testId } })).version;
  // The Save's own rule: free keys for every open spot (3 spots, nobody in).
  const r = await act(testId, "edit", cookie, { version, fields: {}, keysAdd: ["NEW-1", "NEW-2", "NEW-3"], keysRemove: [], confirmed: true, payRulesOk: true });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r;
};

describe("§341 no free access key: full to testers", () => {
  it("the rule: uses keys, none free, a spot open", async () => {
    const { testId } = await setup({ spots: 3 });
    expect(await keysFullNow(db, testId)).toBe(false); // no keys at all
    await unassigned(testId);
    expect(await keysFullNow(db, testId)).toBe(true);
    expect((await noFreeKeyTests(db, [testId])).has(testId)).toBe(true);
    await db.accessKey.create({ data: { testId, value: "F-1", status: "free" } });
    expect(await keysFullNow(db, testId)).toBe(false);
  });

  it("tester presses: Join refused as full, out of Find; the join page's version changes when a key is added; it's joinable again", async () => {
    const { dev, testId } = await setup({ spots: 3 });
    await unassigned(testId);
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    const anaUser = await db.user.findUniqueOrThrow({ where: { id: ana.user.id } });
    expect(await joinRefusal(ana.user.id, testId)).toBe("This test is full.");
    const r = await act(testId, "join", ana.cookie, { listingVersion: (await db.test.findUniqueOrThrow({ where: { id: testId } })).listingVersion, seenAt: seen(), confirmed: true });
    expect(r.body.error?.message).toBe("This test is full.");
    expect((await findTests(anaUser as never)).some((t) => t.id === testId)).toBe(false);
    const v1 = await joinPageV(ana.user.id, testId);

    expect((await addFreeKey(testId, dev.cookie)).status).toBe(200);
    await settle();
    expect(await joinRefusal(ana.user.id, testId)).toBe("");
    expect((await findTests(anaUser as never)).some((t) => t.id === testId)).toBe(true);
    expect(await joinPageV(ana.user.id, testId)).not.toBe(v1);
  });

  it("Apply refused as full; waiting applications and invites are NOT closed; the developer's Accept gets the key line; an invited tester hears a spot opened once a key is added", async () => {
    const { dev, testId } = await setup({ joinMode: "apply", spots: 3 });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    const ben = await makeUser({ tester: true, name: "Ben Cole" });
    const cam = await makeUser({ tester: true, name: "Cam Lee" });
    expect((await act(testId, "apply", ana.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    expect((await act(testId, "invite", dev.cookie, { seenAt: seen(), testerIds: [cam.user.id], confirmed: true })).status).toBe(200);
    await unassigned(testId);
    await settle();
    // Ben's Apply: full. Ana's application and Cam's invite stay.
    expect((await act(testId, "apply", ben.cookie, { seenAt: seen(), confirmed: true })).body.error?.message).toBe("This test is full.");
    expect((await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } })).status).toBe("pending");
    expect((await db.invite.findFirstOrThrow({ where: { testId, testerId: cam.user.id } })).status).toBe("sent");
    // Cam (invited) is told it's full right now, as for a real full.
    expect(await joinRefusal(cam.user.id, testId)).toMatch(/is full right now\.$/);
    // The developer's Accept: the key line.
    const app = await db.application.findFirstOrThrow({ where: { testId, testerId: ana.user.id } });
    const acc = await act(testId, "application", dev.cookie, { applicationId: app.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(acc.body.error?.message).toBe(NO_FREE_KEY);
    expect((await db.application.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("pending");
    // A key added: a spot opened for the invitee (once), and the Accept goes through.
    expect((await addFreeKey(testId, dev.cookie)).status).toBe(200);
    await settle();
    expect(await db.notification.count({ where: { userId: cam.user.id, text: { contains: "spot" } } })).toBe(1);
    expect((await act(testId, "application", dev.cookie, { applicationId: app.id, action: "accept", seenAt: seen(), confirmed: true })).status).toBe(200);
  });

  it("the developer's Invite that would join an applicant names them with the key line (§338)", async () => {
    const { dev, testId } = await setup({ joinMode: "apply", spots: 3 });
    const ana = await makeUser({ tester: true, name: "Ana Silva" });
    const loaded = seen();
    await settle();
    expect((await act(testId, "apply", ana.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    await unassigned(testId);
    await settle();
    const r = await act(testId, "invite", dev.cookie, { seenAt: loaded, testerIds: [ana.user.id], confirmed: true });
    expect(r.status).toBe(200);
    expect(r.body.message).toContain(noFreeKeyFor("Ana Silva"));
  });

  it("the developer's test page: one line while it lasts, linking to Edit's keys", () => {
    const html = (keys: { free: { id: string; value: string }[]; open: number }, canEdit = true) =>
      renderToStaticMarkup(createElement(KeysNotice, { testId: "t1", keys: { ...keys, inUse: [] }, canEdit }));
    expect(html({ free: [], open: 1 })).toContain('data-keys-full="">Add an access key <a href="/app/tests/t1/edit#keys" class="underline">in Edit</a> to reopen this spot.</p>');
    expect(html({ free: [], open: 2 })).toContain("to reopen these 2 spots.");
    expect(html({ free: [{ id: "k", value: "K-1" }], open: 1 })).not.toContain("data-keys-full");
    expect(html({ free: [], open: 0 })).not.toContain("data-keys-full");
    expect(html({ free: [], open: 1 }, false)).not.toContain("data-keys-full");
  });
});
