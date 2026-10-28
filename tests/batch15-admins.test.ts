import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as adminPOST } from "@/app/api/admin/[action]/route";
import { adminPage, disputeRow, testRow, type ContactVM, type TestVM } from "@/lib/server/adminLists";
import { canView } from "@/lib/server/recordings";
import { json, makeUser, req } from "./helpers";
import { joined, sact, seen, setup } from "./fixtures";
import { pay } from "./b15";

// Batch 15 sections 8 and 21: admins see the disputed work, and which admin did what.
async function admin() {
  const a = await makeUser({ email: `admin-${randomUUID()}@playtest.test` });
  await db.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
  return a;
}
const aact = (cookie: string, action: string, body: Record<string, unknown>) => adminPOST(req(`/api/admin/${action}`, { cookie, body }), { params: Promise.resolve({ action }) }).then(json);

describe("which admin did what (section 21)", () => {
  it("a test row says who stopped it; a second admin's Decide names the first admin by email; a deleted admin reads 'an admin (deleted)'", async () => {
    const a = await admin(), b = await admin();
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["a", "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "5.00", tickedCents: 500, reason: "Half of it" })).status).toBe(200);
    expect((await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question in full.", seenAt: seen(), confirmed: true })).status).toBe(200);
    const d = await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } });
    expect((await aact(a.cookie, "decide", { id: d.id, total: "", note: "" })).status).toBe(200);
    expect((await aact(b.cookie, "decide", { id: d.id, total: "", note: "" })).body.error.message).toMatch(new RegExp(`^${a.user.email.replace(/[.]/g, "\\.")} already decided this dispute at `));
    expect((await disputeRow(await db.dispute.findUniqueOrThrow({ where: { id: d.id } }))).decided).toContain(`by ${a.user.email}`);
    expect((await aact(a.cookie, "stop-test", { id: testId, note: "Spam build" })).status).toBe(200);
    const row = async () => testRow(await db.test.findUniqueOrThrow({ where: { id: testId }, include: { developer: true, _count: { select: { contracts: true } } } }));
    expect((await row()).line).toContain(`stopped by ${a.user.email}`);
    await db.user.update({ where: { id: a.user.id }, data: { deletedAt: new Date() } });
    expect((await row()).line).toContain("stopped by an admin (deleted)");
    expect(await db.adminAction.count({ where: { adminId: a.user.id } })).toBe(2);
    void (null as unknown as TestVM);
  });

  it("Contact us: up to 50,000 characters, listed in a scroll box; 'Mark replied' says who, and a second admin is refused by name", async () => {
    const a = await admin(), b = await admin();
    const u = await makeUser({ tester: true });
    const m = await db.contactMessage.create({ data: { userId: u.user.id, topic: "Payments", message: "x".repeat(50_000) } });
    expect((await aact(a.cookie, "contact-replied", { id: m.id })).status).toBe(200);
    expect((await aact(b.cookie, "contact-replied", { id: m.id })).body.error.message).toMatch(new RegExp(`^${a.user.email.replace(/[.]/g, "\\.")} already marked this replied`));
    const rows = (await adminPage("contact", a.user.id, null)).rows as ContactVM[];
    const mine = rows.find((r) => r.id === m.id)!;
    expect(mine.message.length).toBe(50_000);
    expect(mine.replied).toMatch(new RegExp(`^Replied by ${a.user.email.replace(/[.]/g, "\\.")}`));
  });
});

describe("admins see the disputed work (section 8)", () => {
  it("the dispute row carries the piece (answers under their questions, attachments); admins can open its files", async () => {
    const a = await admin();
    const { dev, testId } = await setup();
    const { tester, sessionId } = await joined(testId);
    await sact(sessionId, "written", tester.cookie, { answers: ["A".repeat(10_000), "b"] });
    const sub = await db.submission.findFirstOrThrow({ where: { contractId: sessionId } });
    const file = await db.recording.create({ data: { contractId: sessionId, submissionId: sub.id, part: "written", filename: "notes.png", contentType: "image/png", sizeBytes: 1000, storageKey: `k-${randomUUID()}`, uploadedAt: new Date() } });
    expect((await pay(dev.cookie, { kind: "submission", id: sub.id, amount: "5.00", tickedCents: 500, reason: "Half of it" })).status).toBe(200);
    await sact(sessionId, "dispute", tester.cookie, { kind: "submission", id: sub.id, reason: "I answered every question in full.", seenAt: seen(), confirmed: true });
    const row = await disputeRow(await db.dispute.findFirstOrThrow({ where: { submissionId: sub.id } }));
    expect(row.work).toMatchObject({ kind: "submission", part: "written" });
    if (row.work?.kind === "submission") {
      expect(row.work.items.map((i) => i.question)).toEqual(["What did you like?", "Where did you get stuck?"]);
      expect(row.work.items[0].answer.length).toBe(10_000);
      expect(row.work.files.map((f) => f.filename)).toEqual(["notes.png"]);
    }
    expect(await canView(a.user.id, file.id)).toBeNull();
    expect(await canView(a.user.id, file.id, true)).not.toBeNull();
  });
});
