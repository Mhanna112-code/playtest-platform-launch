import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as excerptsPOST } from "@/app/api/excerpts/route";
import { ACCOUNT_WAS_DELETED, displayName } from "@/lib/format";
import { DELETED_NO_EXCERPT, devDeletedNoExcerpt, requestExcerpt } from "@/lib/server/excerpts";
import { bell, notify, sendSummaries } from "@/lib/server/notify";
import { retryEmails, sendEmail, setEmailTransportForTests } from "@/lib/server/email";
import { deleteAccount } from "@/lib/server/restrictions";
import { maybePromptRating } from "@/lib/server/ratings";
import { reportPerson } from "@/lib/server/reports";
import { blockUser } from "@/lib/server/blocks";
import { tombstoneOf } from "@/lib/server/reuseEmail";
import { json, makeUser, req } from "./helpers";
import { joined, sact, seen, settle, setup } from "./fixtures";

// (Owner, Nov 9, §360) Deleted-account fixes, from the audit (audit-nov9/p5-forced-deletion): (1) no email ever goes to a deleted account's address; (2) live pages
// say "Deleted account" (the tester's Payments page named the deleted developer); (3) a new excerpt request to or for a deleted account is refused; (6) the
// "Rate <name> on …" bell line for a deleted account goes; (7) a deleted account's profile reads "This account was deleted." with no Report or Block.

const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../src", f), "utf8");
afterEach(() => { setEmailTransportForTests(null); vi.unstubAllEnvs(); });
const transport = (ok: boolean) => {
  vi.stubEnv("RESEND_API_KEY", "re_test_only");
  vi.stubEnv("EMAIL_LOCAL_ONLY_TO", "");
  const send = vi.fn(async (_row: { id: string; text: string; html: string }, _key: string) => (ok ? { ok: true as const } : { ok: false as const, status: 503, body: "Test outage" }));
  setEmailTransportForTests(send);
  return send;
};
const ANSWER = "The harbour level felt great, but the second boss was far too hard for me.";
const pay = (cookie: string, body: Record<string, unknown>) => reviewPOST(req("/api/review", { cookie, body: { payKey: randomUUID(), seenAt: seen(), confirmed: true, ...body } })).then(json);
const ask = (cookie: string, submissionId: string) => excerptsPOST(req("/api/excerpts", { cookie, body: { action: "request", submissionId, index: 0, text: "the second boss was far too hard" } })).then(json);

async function paidWork() {
  const s = await setup();
  const j = await joined(s.testId);
  await sact(j.sessionId, "written", j.tester.cookie, { answers: [ANSWER, "Nowhere really, it was smooth."] });
  await settle();
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  expect((await pay(s.dev.cookie, { kind: "submission", id: sub.id, amount: "10.00", tickedCents: 1000 })).status).toBe(200);
  return { ...s, ...j, sub };
}

describe("§360 (1) nothing is ever emailed to a deleted account's address", () => {
  it("no summary, end-of-day or immediate email: receipts and updates included; lines waiting at the deletion are never sent", async () => {
    const { user } = await makeUser({ tester: true });
    await db.user.update({ where: { id: user.id }, data: { emailPref: "daily" } });
    // Waiting at the deletion: an update, a payment line and an always line.
    await notify(user.email, "Nora Lane invited you to “Harbor Run”", ["Invited"], "/app", {});
    await notify(user.email, "Payment received: $10.00", ["Actual receipt"], "/app/payments", { payment: true });
    await bell(user.id, "Your tester account is active again", "/app", undefined, { always: true });
    await deleteAccount(user.id, "self");
    expect(await db.notification.count({ where: { userId: user.id, summarizedAt: null } })).toBe(0);
    // After it: more lines, an immediate one too.
    await notify(user.email, "Payment received: $4.00", ["Another receipt"], "/app/payments", { payment: true });
    await notify(user.email, "A chargeback was opened", ["Now"], "/app/payments", { now: true, always: true, payment: true });
    await bell(user.id, "“Harbor Run” was stopped", "/app", undefined, { always: true });
    expect(await db.notification.count({ where: { userId: user.id, summarizedAt: null } })).toBe(0);
    await sendSummaries(new Date(Date.now() + 2 * 86_400_000), [user.id]);
    await sendSummaries(new Date(Date.now() + 2 * 86_400_000));
    expect(await db.outboxEmail.count({ where: { to: user.email } })).toBe(0);
    expect(await db.emailQueue.count({ where: { to: user.email } })).toBe(0);
    // Straight through sendEmail too: by the account, by its address, or to a freed address's tombstone.
    expect((await sendEmail({ to: user.email, subject: "Hi", text: "x", recipientId: user.id })).via).toBe("suppressed");
    expect((await sendEmail({ to: user.email, subject: "Hi", text: "x" })).via).toBe("suppressed");
    expect((await sendEmail({ to: tombstoneOf(user.email, user.id), subject: "Hi", text: "x" })).via).toBe("suppressed");
    expect(await db.outboxEmail.count({ where: { to: user.email } })).toBe(0);
  });

  it("a summary queued before the deletion (a receipt in it) is cancelled whole at its retry", async () => {
    const { user } = await makeUser({ dev: true });
    await db.user.update({ where: { id: user.id }, data: { emailPref: "off" } });
    await notify(user.email, "Payment receipt: $10.00", ["Actual payment"], "/app/payments", { payment: true });
    transport(false);
    await sendSummaries(new Date(), [user.id]);
    const queued = await db.emailQueue.findFirstOrThrow({ where: { to: user.email } });
    await db.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
    const send = transport(true);
    await retryEmails(new Date(Date.now() + 20 * 60_000));
    expect(send).not.toHaveBeenCalled();
    expect((await db.emailQueue.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("cancelled");
  });

  it("a live account is still emailed as before", async () => {
    const { user } = await makeUser({ tester: true });
    await notify(user.email, "Payment received: $10.00", ["Actual receipt"], "/app/payments", { payment: true });
    await sendSummaries(new Date(), [user.id]);
    expect((await db.outboxEmail.findFirstOrThrow({ where: { to: user.email } })).text).toContain("Payment received: $10.00");
  });
});

describe("§360 (2) live pages say Deleted account", () => {
  it("the tester's Payments page names a deleted developer Deleted account (it showed the real name)", () => {
    const page = src("app/app/payments/page.tsx");
    expect(page).not.toContain("<Cut text={c.test.developer.name || c.test.developer.email}");
    expect(page).toContain("c.test.developer.deletedAt ? displayName(c.test.developer)");
    expect(displayName({ name: "Dirk Vale", email: "d@x.test", deletedAt: new Date() })).toBe("Deleted account");
  });

  it("the call page's status line names the other side by displayName (Deleted account once deleted)", () => {
    const blocks = src("lib/server/blocks.ts");
    expect(blocks).toContain("const otherName = amTester ? displayName(c.test.developer) : tester ? displayName(tester) : \"\";");
  });
});

describe("§360 (3) a new excerpt request to or for a deleted account is refused", () => {
  it("the developer deleted their account: refused with the line, and the session page offers no request", async () => {
    const s = await paidWork();
    await deleteAccount(s.dev.user.id, "self");
    const r = await ask(s.tester.cookie, s.sub.id);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "developer_deleted", message: devDeletedNoExcerpt("Harbor Run", "she") });
    expect(devDeletedNoExcerpt("Harbor Run", "he")).toBe("Harbor Run's developer deleted his account, so nobody can allow an excerpt from it.");
    expect(await db.excerpt.count({ where: { submissionId: s.sub.id } })).toBe(0);
    expect(src("app/app/sessions/[id]/page.tsx")).toContain("!u.testerSuspendedAt && !devGone ? await excerptChoices(written) : []");
  });

  it("a deleted tester's old tab: refused", async () => {
    const s = await paidWork();
    await db.user.update({ where: { id: s.tester.user.id }, data: { deletedAt: new Date() } });
    const t = await db.user.findUniqueOrThrow({ where: { id: s.tester.user.id } });
    await expect(requestExcerpt(t, { submissionId: s.sub.id, index: 0, text: "the second boss was far too hard" })).rejects.toMatchObject({ code: "deleted", message: DELETED_NO_EXCERPT });
  });
});

describe("§360 (6) the Rate bell line for a deleted account goes", () => {
  it("the tester's Rate <developer> prompt is removed when the developer deletes; no new one is made", async () => {
    const s = await paidWork();
    await db.contract.update({ where: { id: s.sessionId }, data: { status: "ended", endKind: "closed", endedAt: new Date() } });
    await maybePromptRating(s.sessionId);
    const name = displayName(await db.user.findUniqueOrThrow({ where: { id: s.dev.user.id } }));
    const prompt = await db.notification.findFirst({ where: { userId: s.tester.user.id, text: { startsWith: `Rate ${name} on` } } });
    expect(prompt, "the prompt was made while both accounts were live").not.toBeNull();
    await bell(s.tester.user.id, `Reminder: rate ${name} on “Harbor Run”`, "/app#ratings-to-give", undefined, { side: "tester", group: "ratings", reminder: `rate:${s.sessionId}` });
    await deleteAccount(s.dev.user.id, "self");
    expect(await db.notification.count({ where: { userId: s.tester.user.id, OR: [{ text: { startsWith: `Rate ${name}` } }, { text: { startsWith: `Reminder: rate ${name}` } }] } })).toBe(0);
    await db.contract.update({ where: { id: s.sessionId }, data: { ratePromptedAt: null } });
    await maybePromptRating(s.sessionId);
    expect(await db.notification.count({ where: { userId: s.tester.user.id, text: { startsWith: "Rate " } } })).toBe(0);
  });
});

describe("§360 (7) a deleted account's profile", () => {
  it("both profiles show only \"This account was deleted.\" (no Report, Block or Chat with); an old tab's Report and Block are refused", async () => {
    expect(ACCOUNT_WAS_DELETED).toBe("This account was deleted.");
    for (const f of ["app/app/testers/[id]/page.tsx", "app/app/developers/[id]/page.tsx"]) {
      const page = src(f);
      expect(page, f).toContain("if (p.deletedAt && !isAdmin(viewer)) return <>{watch}<ProfileUnavailable line={ACCOUNT_WAS_DELETED} /></>;");
      // Before the Report and Block buttons render.
      expect(page.indexOf("ACCOUNT_WAS_DELETED} />"), f).toBeLessThan(page.indexOf("<ReportButton"));
    }
    const viewer = await makeUser({ dev: true, tester: true });
    const gone = await makeUser({ tester: true, dev: true });
    await deleteAccount(gone.user.id, "self");
    await expect(reportPerson(viewer.user, { userId: gone.user.id, note: "They were rude in the chat." })).rejects.toMatchObject({ code: "deleted", message: ACCOUNT_WAS_DELETED });
    await expect(blockUser(viewer.user, gone.user.id)).rejects.toMatchObject({ code: "deleted", message: ACCOUNT_WAS_DELETED });
    expect(await db.block.count({ where: { blockerId: viewer.user.id, blockedId: gone.user.id } })).toBe(0);
  });
});
