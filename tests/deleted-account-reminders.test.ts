import { afterEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { bell, notify, sendSummaries } from "@/lib/server/notify";
import { retryEmails, setEmailTransportForTests } from "@/lib/server/email";
import { payoutProblem, payoutReminders } from "@/lib/server/restrictions";
import { maybePromptRating } from "@/lib/server/ratings";
import { joined, sact, seen, setup } from "./fixtures";
import { makeUser } from "./helpers";
import { tombstoneOf } from "@/lib/server/reuseEmail";

afterEach(() => { setEmailTransportForTests(null); vi.unstubAllEnvs(); });
const transport = (ok: boolean) => {
  vi.stubEnv("RESEND_API_KEY", "re_test_only");
  vi.stubEnv("EMAIL_LOCAL_ONLY_TO", "");
  const send = vi.fn(async (_row: { id: string; text: string; html: string }, _key: string) => ok ? { ok: true as const } : { ok: false as const, status: 503, body: "Test outage" });
  setEmailTransportForTests(send);
  return send;
};

// (Owner, Nov 9, §360; replaces the Nov 7 rule that still emailed a deleted account its receipts and updates) Nothing is emailed to a deleted account any more.
it("stops new reminders and payout-problem reminders after deletion, and (§360) no payment notice is emailed either", async () => {
  const { user } = await makeUser({ tester: true });
  await db.user.update({ where: { id: user.id }, data: { deletedAt: new Date(), emailPref: "off", stripeAccountId: `acct_${user.id}`, payoutProblemAt: new Date(Date.now() - 4 * 86_400_000) } });
  await bell(user.id, "Review reminder", "/app", undefined, { reminder: "review", always: true });
  await bell(user.id, "Legacy rating prompt", "/app", undefined, { group: "ratings", always: true });
  await notify(user.email, "Payout setup prompt", ["Finish setup"], "/app", { group: "payout", always: true });
  await notify(user.email, "Immediate reminder", ["Reminder"], "/app", { reminder: "call", now: true, always: true });
  await payoutReminders();
  expect(await payoutProblem(`acct_${user.id}`)).toBe(false);
  expect(await db.notification.count({ where: { userId: user.id } })).toBe(0);
  await notify(user.email, "Payment received: $10.00", ["Actual receipt"], "/app/payments", { payment: true });
  await sendSummaries(new Date(), [user.id]);
  expect(await db.outboxEmail.count({ where: { to: user.email } })).toBe(0);
});

it("does not open a tester rating prompt after deletion, even when the submitted work is settled", async () => {
  const { testId } = await setup({ liveRateCents: null });
  const j = await joined(testId, "Deleted Rating Tester", "they");
  expect((await sact(j.sessionId, "written", j.tester.cookie, { answers: ["a", "b"], seenAt: seen(), confirmed: true })).status).toBe(200);
  const sub = await db.submission.findFirstOrThrow({ where: { contractId: j.sessionId } });
  await db.review.create({ data: { submissionId: sub.id, contractId: j.sessionId, amountCents: 1000, agreedCents: 1000, reason: "Sample settled work", payKey: `deleted-rate-${sub.id}` } });
  await db.user.update({ where: { id: j.tester.user.id }, data: { deletedAt: new Date() } });
  await db.contract.update({ where: { id: j.sessionId }, data: { status: "left", endedAt: new Date() } });
  await maybePromptRating(j.sessionId);
  expect((await db.contract.findUniqueOrThrow({ where: { id: j.sessionId } })).ratePromptedAt).toBeNull();
  expect(await db.notification.count({ where: { userId: j.tester.user.id, text: { startsWith: "Rate " } } })).toBe(0);
});

it("cancels an immediate reminder already queued before deletion without trying the transport again", async () => {
  const { user } = await makeUser();
  transport(false);
  await notify(user.email, "Call reminder", ["Your call starts soon"], "/app", { reminder: "call", now: true, always: true });
  const queued = await db.emailQueue.findFirstOrThrow({ where: { to: user.email } });
  await db.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
  const send = transport(true);
  await retryEmails(new Date(Date.now() + 20 * 60_000));
  expect(send).not.toHaveBeenCalled();
  expect((await db.emailQueue.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("cancelled");
});

// (§360; was: the receipt was re-sent without the reminder) A queued summary of an account deleted since is cancelled whole.
it("cancels a queued mixed summary (a reminder and a receipt) whole once the account is deleted", async () => {
  const { user } = await makeUser({ dev: true });
  await db.user.update({ where: { id: user.id }, data: { emailPref: "off" } });
  await bell(user.id, "Review this sample tomorrow", "/app", undefined, { reminder: "review", always: true });
  await notify(user.email, "Payment receipt: $10.00", ["Actual payment"], "/app/payments", { payment: true });
  transport(false);
  await sendSummaries(new Date(), [user.id]);
  const queued = await db.emailQueue.findFirstOrThrow({ where: { to: user.email } });
  expect(queued.text).toContain("Review this sample tomorrow");
  await db.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
  const send = transport(true);
  await retryEmails(new Date(Date.now() + 20 * 60_000));
  expect(send).not.toHaveBeenCalled();
  expect((await db.emailQueue.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("cancelled");
  expect(await db.emailQueue.count({ where: { to: user.email, status: "sent" } })).toBe(0);
});

it("recovers an older queued reminder's source notice when it predates queue metadata", async () => {
  const { user } = await makeUser();
  await db.notification.create({ data: { userId: user.id, text: "Legacy reminder", link: "/app", reminderKey: "legacy" } });
  const q = await db.emailQueue.create({ data: { to: user.email, subject: "Legacy reminder", text: "Legacy reminder\nhttp://localhost:3400/app", giveUpAt: new Date(Date.now() + 86_400_000) } });
  await db.user.update({ where: { id: user.id }, data: { deletedAt: new Date(), email: tombstoneOf(user.email, user.id) } });
  const send = transport(true);
  await retryEmails(new Date(Date.now() + 1000));
  expect(send).not.toHaveBeenCalled();
  expect((await db.emailQueue.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("cancelled");
});

it.each(["ratings", "payout"])("suppresses legacy %s prompts without reminder keys in queued and not-yet-generated summaries", async (groupKey) => {
  const { user } = await makeUser();
  await db.user.update({ where: { id: user.id }, data: { emailPref: "off" } });
  const n = await db.notification.create({ data: { userId: user.id, text: "Legacy account prompt", link: "/app", groupKey, mustEmail: true } });
  const q = await db.emailQueue.create({ data: { to: user.email, subject: n.text, text: n.text, giveUpAt: new Date(Date.now() + 86_400_000) } });
  await db.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
  const send = transport(true);
  await retryEmails(new Date(Date.now() + 1000));
  await sendSummaries(new Date(), [user.id]);
  expect(send).not.toHaveBeenCalled();
  expect((await db.emailQueue.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("cancelled");
});

it("does not confuse a deleted recipient with a new account that reuses the same address", async () => {
  const { user } = await makeUser();
  transport(false);
  await notify(user.email, "Same reminder", ["Old account"], "/app", { reminder: "review", now: true, always: true });
  await db.user.update({ where: { id: user.id }, data: { deletedAt: new Date(), email: tombstoneOf(user.email, user.id) } });
  const fresh = await makeUser({ email: user.email });
  await notify(fresh.user.email, "Same reminder", ["New account"], "/app", { reminder: "review", now: true, always: true });
  const send = transport(true);
  await retryEmails(new Date(Date.now() + 20 * 60_000));
  expect(send).toHaveBeenCalledTimes(1);
  const sent = await db.emailQueue.findFirstOrThrow({ where: { recipientId: fresh.user.id } });
  expect(sent).toMatchObject({ status: "sent", text: expect.stringContaining("New account") });
});

it("a required review reminder between Weekly summaries is an account update, not a payment update", async () => {
  const { user } = await makeUser();
  await db.user.update({ where: { id: user.id }, data: { emailPref: "weekly", lastSummaryAt: new Date() } });
  await bell(user.id, "Review sample work tomorrow", "/app", undefined, { reminder: "review", always: true });
  await sendSummaries(new Date(), [user.id]);
  expect((await db.outboxEmail.findFirstOrThrow({ where: { to: user.email } })).subject).toBe("Your Playtest account updates: 1");
});
