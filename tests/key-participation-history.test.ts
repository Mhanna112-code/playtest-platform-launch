import { blockUser } from "@/lib/server/blocks";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { db } from "@/lib/db";
import { contractHistory } from "@/lib/server/contractHistory";
import { keyBoxes, releaseTesterKeys } from "@/lib/server/accessKeys";
import { deleteAccount } from "@/lib/server/restrictions";
import { act, joined, sact, seen, setup } from "./fixtures";

describe("released keys and participation dates in Terms history", () => {
  it.each(["keep", "switch"])("records the parts/price offer and dated %s choice for the developer", async (choice) => {
    const { dev, testId } = await setup();
    const j = await joined(testId, "Terms Tester", "they");
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect((await act(testId, "edit", dev.cookie, { version: t.version, fields: { writtenCents: "12.00" }, seenAt: seen(), confirmed: true })).status).toBe(200);
    const offer = await db.termsOffer.findFirstOrThrow({ where: { contractId: j.sessionId, status: "open" } });
    expect((await sact(j.sessionId, "terms", j.tester.cookie, { choice, offerId: offer.id, seenAt: seen(), confirmed: true })).status).toBe(200);
    const decided = await db.termsOffer.findUniqueOrThrow({ where: { id: offer.id } });
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    const history = (await contractHistory(testId, [c], true)).get(c.id)!;
    expect(history.find((e) => e.id === offer.id)).toMatchObject({ at: offer.createdAt, label: "New parts and prices offered" });
    expect(history.find((e) => e.id === `choice-${offer.id}`)).toMatchObject({ at: decided.decidedAt, label: choice === "keep" ? "Kept existing parts and prices" : "Switched to new parts and prices", value: offer.diff });
    expect(c.writtenCents).toBe(choice === "keep" ? 1000 : 1200);
  });
  it.each(["leave", "end early", "stop", "block", "delete"])("%s releases the key and preserves its assignment and departure date", async (action) => {
    const { dev, testId } = await setup({ spots: 2, accessKeys: "HISTORY-K1\nHISTORY-K2" });
    const j = await joined(testId, "History Tester", "they");
    if (action === "leave") expect((await sact(j.sessionId, "leave", j.tester.cookie, { seenAt: seen(), confirmed: true })).status).toBe(200);
    else if (action === "end early") expect((await act(testId, "end-early", dev.cookie, { contractId: j.sessionId, reason: "The sample work is complete.", seenAt: seen(), confirmed: true })).status).toBe(200);
    else if (action === "stop") expect((await act(testId, "stop", dev.cookie, {reason:"The sample test is complete.",seenAt:seen(),confirmed:true})).status).toBe(200);
    else if (action === "block") await blockUser(j.tester.user,dev.user.id);
    else await deleteAccount(j.tester.user.id, "self");
    const key = await db.accessKey.findFirstOrThrow({ where: { testId, value: "HISTORY-K1" } });
    expect(key).toMatchObject({ status: "unassigned", contractId: null, assignedAt: null });
    expect((await keyBoxes(testId)).inUse).toHaveLength(0);
    expect((await keyBoxes(testId)).free.map(k=>k.value)).not.toContain("HISTORY-K1");
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    const h = (await contractHistory(testId, [c])).get(c.id)!;
    expect(h.find((e) => e.label === "Access key assigned")?.value).toBe("HISTORY-K1");
    expect(h.some((e) => e.label === (action === "end early" ? "Work ended early" : action === "stop" || action === "block" ? "Work ended" : "Left test"))).toBe(true);
    expect(h.every((e) => e.at instanceof Date)).toBe(true);
    expect(h.some((e) => /NDA/.test(e.label))).toBe(false);
  });

  it("rejoining gets a free key, retaining the old assignment, departure and rejoin dates", async () => {
    const { dev, testId } = await setup({ spots: 3, accessKeys: "OLD-KEY\nOTHER-KEY\nNEW-KEY" });
    const j = await joined(testId, "Returning Tester", "they");
    await sact(j.sessionId, "leave", j.tester.cookie, { seenAt: seen(), confirmed: true });
    await joined(testId, "Another Tester", "they"); // takes OTHER-KEY; OLD-KEY stays unassigned
    const t = await db.test.findUniqueOrThrow({ where: { id: testId } });
    expect((await act(testId, "rejoin-ask", j.tester.cookie, { listingVersion: t.listingVersion, seenAt: seen(), confirmed: true, anyway: true, ndaAccepted: true })).status).toBe(200);
    const ask = await db.application.findFirstOrThrow({ where: { testId, testerId: j.tester.user.id, kind: "rejoin", status: "pending" } });
    const rejoin = await act(testId, "application", dev.cookie, { applicationId: ask.id, action: "accept", seenAt: seen(), confirmed: true });
    expect(rejoin.status).toBe(200);
    expect(await db.accessKey.findFirst({ where: { contractId: j.sessionId } })).toMatchObject({ value: "NEW-KEY" });
    const c = await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } });
    const h = (await contractHistory(testId, [c])).get(c.id)!;
    expect(h.filter((e) => e.value).map((e) => e.value)).toEqual(["OLD-KEY", "NEW-KEY"]);
    expect(h.filter((e) => !e.value).map((e) => e.label)).toEqual(["Joined", "Left test", "Rejoined"]);
  });

  it("preserves legacy assignments before clearing inactive keys, and does not duplicate on repeat", async () => {
    const { testId } = await setup({ spots: 2, accessKeys: "LEGACY-KEY\nSPARE-KEY" });
    const j = await joined(testId, "Legacy Tester", "they");
    await db.contractNote.deleteMany({ where: { contractId: j.sessionId, kind: "key_assigned" } });
    const assigned = await db.accessKey.findFirstOrThrow({ where: { contractId: j.sessionId } });
    await db.contract.update({ where: { id: j.sessionId }, data: { status: "left", endedAt: new Date() } });
    expect((await keyBoxes(testId)).inUse).toHaveLength(0);
    await db.$transaction((tx) => releaseTesterKeys(tx, j.sessionId));
    const notes = await db.contractNote.findMany({ where: { contractId: j.sessionId, kind: "key_assigned" } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ text: "LEGACY-KEY", createdAt: assigned.assignedAt });
  });

  it("keeps question-change history and omits NDA acceptance from the roster heading and Terms history", () => {
    const dev = fs.readFileSync(new URL("../src/app/app/tests/[id]/page.tsx", import.meta.url), "utf8");
    const tester = fs.readFileSync(new URL("../src/app/app/sessions/[id]/page.tsx", import.meta.url), "utf8");
    expect(dev).toContain("QuestionsChangedEntry");
    expect(dev).toContain("data-participation-history");
    expect(tester).toContain("data-participation-history");
    expect(dev).not.toContain("NDA accepted");
    expect(tester).not.toContain(" and accepted the NDA");
  });
});
