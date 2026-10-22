import { db } from "@/lib/db";
import { emailDecision, summaryDue } from "@/lib/rules";
import { appUrl } from "./auth";
import { sendEmail } from "./email";

// Every update goes to the person's bell. Email follows their setting: each update (default), one daily summary,
// or none. Sign-in links (sent elsewhere) and payment receipts (always: true) always send.
// A failed email never undoes the action: it is logged and the action stands.

export async function notify(to: string, subject: string, lines: string[], path: string, opts: { always?: boolean } = {}) {
  const user = await db.user.findUnique({ where: { email: to }, select: { id: true, emailPref: true } });
  if (user) await db.notification.create({ data: { userId: user.id, text: subject, link: path } });
  const decision = emailDecision(user?.emailPref ?? "each", !!opts.always);
  if (decision !== "send") return;
  try {
    await sendEmail({ to, subject, text: [...lines.filter(Boolean), "", `${appUrl()}${path}`, "", "Playtest"].join("\n") });
  } catch (e) {
    console.error("[email] failed:", subject, (e as Error).message);
  }
}

/** A bell notification only (no email), e.g. the Open until heads-ups. */
export async function bell(userId: string, text: string, link: string) {
  await db.notification.create({ data: { userId, text, link } });
}

/** Summary emails for people on daily / weekly / monthly: one email listing their new notifications. */
export async function sendSummaries(now = new Date()) {
  const users = await db.user.findMany({ where: { emailPref: { in: ["daily", "weekly", "monthly"] }, notifications: { some: { summarizedAt: null } } }, select: { id: true, email: true, emailPref: true, lastSummaryAt: true } });
  for (const u of users) {
    if (!summaryDue(u.emailPref, u.lastSummaryAt, now)) continue;
    const items = await db.notification.findMany({ where: { userId: u.id, summarizedAt: null }, orderBy: { createdAt: "asc" }, take: 100 });
    if (!items.length) continue;
    try {
      await sendEmail({ to: u.email, subject: `Your Playtest summary: ${items.length} update${items.length === 1 ? "" : "s"}`, text: [...items.map((n) => `• ${n.text}${n.link ? ` ${appUrl()}${n.link}` : ""}`), "", "Playtest"].join("\n") });
      await db.notification.updateMany({ where: { id: { in: items.map((n) => n.id) } }, data: { summarizedAt: now } });
      await db.user.update({ where: { id: u.id }, data: { lastSummaryAt: now } });
    } catch (e) {
      console.error("[email] summary failed:", (e as Error).message);
    }
  }
  return users.length;
}
