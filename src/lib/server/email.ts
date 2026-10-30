import { db } from "@/lib/db";
import { T, safeZone } from "@/lib/tz";
import { appUrl } from "./auth";
import { emailHtml, type EmailButton } from "./emailLayout";

/**
 * (Batch 30 §19) Every email is sent as HTML in the shared branded layout (emailLayout.ts) with its plain text alongside. `button`: the email's main link as a button
 * (when its address is a line of the text, the button takes that line's place). `settings`: the footer's "Notification settings" link (default on; off for confirm / reset).
 */
export type Email = { to: string; subject: string; text: string; button?: EmailButton; settings?: boolean };

/** The site's address for the layout's links and logo (APP_URL; the public site when it can't be read). */
const siteBase = () => {
  try {
    return appUrl();
  } catch {
    return "https://playtestplatform.com";
  }
};
/** (Batch 30 §19) The email's HTML version. */
export const htmlOf = (e: Email) => emailHtml(e.subject, e.text, { button: e.button, settings: e.settings ?? true, base: siteBase() });

export const outboxEnabled = () => process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_OUTBOX === "1";

/** (Batch 15 section 12) Production without the email key: nothing may silently land in the outbox table. */
export const NO_EMAIL_KEY = "Emails aren't being sent: RESEND_API_KEY is missing.";

// (Owner, Oct 29, batch 23 sections 1 and 2) Emails never get lost: every email is stored first (EmailQueue), then sent. A failure (Resend down, the daily limit, a bad key)
// keeps it pending with the error and a next try; the 5-minute sweep (retryEmails) tries again after 5, 15 and 30 minutes, then hourly, for 48 hours, and then marks it
// failed for good (kept, never deleted). Each email is sent at most once: a try claims the row first, and Resend's Idempotency-Key is the row's id. Resend's daily limit
// waits for the next day's first sweep without burning tries. The owner hears: a red box on the admin console, one admin bell line per incident, and /api/health's
// "degraded: emails" keyword for the uptime monitor (which alerts through its own system, so it works while Resend is down).

/** The waits after each failed try, in minutes: 5, 15, 30, then hourly. */
export const EMAIL_RETRY_MINUTES = [5, 15, 30, 60] as const;
/** How long an email is tried before it is failed for good. */
export const EMAIL_RETRY_HOURS = 48;
/** /api/health says "degraded: emails" once emails have been failing this long. */
export const EMAIL_DEGRADED_MINUTES = 15;
/** The keyword the uptime service's keyword monitor watches for. */
export const EMAIL_DEGRADED_KEYWORD = "degraded: emails";
/** A try holds its row this long (another sweep leaves it alone meanwhile). */
const CLAIM_MS = 10 * 60_000;
/** At most this many emails per sweep (the sweep runs every 5 minutes). */
const PER_SWEEP = 40;
const HOUR = 3_600_000;
/** AppState keys: the open incident (its start) and the daily limit's wait. */
export const EMAIL_INCIDENT_KEY = "email-incident";
export const EMAIL_CAP_KEY = "email-cap-until";

/** (Batch 23 section 2) The red box's plain words for Resend's daily limit. */
export const EMAIL_CAP_LINE = "Resend's daily limit was reached (free plan: 100 a day). Emails will go out tomorrow, or upgrade the plan.";
/**
 * The admins' bell line, once per incident: "Emails aren't sending (since 3:10 PM EST)". (Batch 24, a batch 23 leftover) An incident that started on an earlier day (in
 * the admin's own time zone) names the day, as the red box does after 20 hours: "Emails aren't sending (since Wed, Oct 28 at 3:10 PM EST)".
 */
export const emailsDownBell = (since: Date, now: Date = since, tz?: string | null) => {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: safeZone(tz) });
  return `Emails aren't sending (since ${T(since, day(since) < day(now) ? "dayTime" : "time")})`;
};
/** (Batch 24, a batch 23 leftover) The red box's words when the waiting emails' error is the missing key (nothing from Resend to quote). */
export const NO_KEY_DEPLOY_LINE = "RESEND_API_KEY isn't set on this deploy.";

/** The wait after the n-th failed try (1-based). */
export const retryDelayMs = (attempts: number) => EMAIL_RETRY_MINUTES[Math.min(Math.max(attempts, 1), EMAIL_RETRY_MINUTES.length) - 1] * 60_000;
/** The start of the next UTC day (Resend's daily limit resets then). */
export const nextUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

type Answer = { ok: true } | { ok: false; status: number; body: string };
type Row = { id: string; to: string; subject: string; text: string; html: string };
/** Tests replace the transport (they never reach Resend); null = the real one. */
let transport: ((row: Row, key: string) => Promise<Answer>) | null = null;
export const setEmailTransportForTests = (t: typeof transport) => {
  transport = t;
};

async function post(row: Row, key: string): Promise<Answer> {
  if (transport) return transport(row, key);
  if (process.env.VITEST) return { ok: false, status: 0, body: "Tests never send real emails." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      // (Batch 23 section 1) The row id as Resend's idempotency key: a try repeated after a lost answer is never sent twice.
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `email-${row.id}` },
      // (Batch 30 §19) An email stored before the branded layout (no html) gets it now, without a button.
      body: JSON.stringify({ from: process.env.EMAIL_FROM || "Playtest <onboarding@resend.dev>", to: [row.to], subject: row.subject, text: row.text, html: row.html || htmlOf({ to: row.to, subject: row.subject, text: row.text }) }),
    });
    return res.ok ? { ok: true } : { ok: false, status: res.status, body: await res.text().catch(() => "") };
  } catch (e) {
    return { ok: false, status: 0, body: (e as Error).message || "No answer from Resend." };
  }
}

/** Resend's daily (or monthly) sending limit: HTTP 429 naming a quota. A plain rate limit (429, too many at once) is retried as usual. */
export const isCapError = (status: number, body: string) => status === 429 && /quota|daily|monthly/i.test(body);

/** Resend's answer, short: "429: You have reached your daily email sending quota" (its JSON message when there is one). */
export function shortError(status: number, body: string) {
  let msg = body.trim();
  try {
    const j = JSON.parse(body) as { message?: unknown; error?: unknown };
    if (typeof j.message === "string") msg = j.message;
    else if (typeof j.error === "string") msg = j.error;
  } catch {
    // not JSON: the text itself
  }
  msg = msg.replace(/\s+/g, " ").replace(/\.$/, "");
  const out = status ? `${status}${msg ? `: ${msg}` : ""}` : msg || "No answer from Resend";
  return out.length > 160 ? `${out.slice(0, 157)}...` : out;
}

const key = () => process.env.RESEND_API_KEY?.trim() ?? "";

async function capUntil(now: Date) {
  const row = await db.appState.findUnique({ where: { key: EMAIL_CAP_KEY } });
  const at = row ? new Date(row.value) : null;
  return at && !isNaN(at.getTime()) && at > now ? at : null;
}

/**
 * Send through Resend when RESEND_API_KEY is set (stored first, then sent; a failure waits for the sweep); otherwise write it to the dev outbox (/dev/outbox).
 * (Batch 15 section 12) In production without the key it never writes to the outbox (unless ALLOW_DEV_OUTBOX=1, staging): (batch 23) it is stored as waiting, with
 * the missing key as its error, so it goes out once the key is set. Never throws for a failed send: the email waits instead.
 */
export async function sendEmail(e: Email, now = new Date()) {
  const k = key();
  const html = htmlOf(e);
  if (!k && outboxEnabled()) {
    await db.outboxEmail.create({ data: { to: e.to, subject: e.subject, text: e.text, html } });
    return { via: "outbox" as const };
  }
  const cap = k ? await capUntil(now) : null;
  const row = await db.emailQueue.create({
    data: {
      to: e.to, subject: e.subject, text: e.text, html, giveUpAt: new Date(now.getTime() + EMAIL_RETRY_HOURS * HOUR + (cap ? cap.getTime() - now.getTime() : 0)),
      // The new row is this try's claim; during a daily-limit wait it simply waits with the others.
      nextTryAt: cap ?? new Date(now.getTime() + CLAIM_MS), ...(cap ? { lastError: EMAIL_CAP_LINE, errorKind: "cap" } : {}),
    },
  });
  if (cap) {
    await startIncident(now);
    return { via: "queued" as const, id: row.id };
  }
  const sent = await deliver(row, k, now);
  return { via: sent ? ("resend" as const) : ("queued" as const), id: row.id };
}

/** One try of a claimed row: sent, or the failure recorded (a next try, the daily limit's wait, or failed for good). True when it went. */
async function deliver(row: Row & { attempts?: number; giveUpAt: Date }, k: string, now: Date) {
  const r: Answer = k ? await post(row, k) : { ok: false, status: 0, body: NO_EMAIL_KEY };
  if (r.ok) {
    await db.emailQueue.update({ where: { id: row.id }, data: { status: "sent", sentAt: now, lastTriedAt: now, attempts: { increment: 1 }, lastError: "", errorKind: "", nextTryAt: now } });
    await endIncidentIfClear();
    return true;
  }
  if (!k) console.error(`[email] ${NO_EMAIL_KEY} (waiting: "${row.subject}")`);
  else console.error(`[email] not sent (${r.status}):`, row.subject);
  if (k && isCapError(r.status, r.body)) {
    // (Batch 23 section 1) The daily limit: everything waits until the next day's first sweep; the wait doesn't count against the 48 hours.
    const until = nextUtcDay(now);
    await db.appState.upsert({ where: { key: EMAIL_CAP_KEY }, create: { key: EMAIL_CAP_KEY, value: until.toISOString() }, update: { value: until.toISOString() } });
    await db.emailQueue.update({ where: { id: row.id }, data: { lastError: EMAIL_CAP_LINE, errorKind: "cap", lastTriedAt: now, nextTryAt: until, giveUpAt: new Date(row.giveUpAt.getTime() + (until.getTime() - now.getTime())) } });
  } else {
    const attempts = (row.attempts ?? 0) + 1;
    const error = k ? shortError(r.status, r.body) : NO_EMAIL_KEY;
    const done = now >= row.giveUpAt;
    await db.emailQueue.update({
      where: { id: row.id },
      data: { attempts, lastError: error, errorKind: "", lastTriedAt: now, ...(done ? { status: "failed", failedAt: now } : { nextTryAt: new Date(Math.min(now.getTime() + retryDelayMs(attempts), row.giveUpAt.getTime())) }) },
    });
    if (done) {
      await endIncidentIfClear();
      return false;
    }
  }
  await startIncident(now);
  return false;
}

/**
 * (Batch 23 section 1) The 5-minute sweep's step: every waiting email whose next try is due is claimed (so an overlapping sweep or a new send never takes it too) and tried
 * once. Nothing is tried during the daily limit's wait. Returns how many went.
 */
export async function retryEmails(now = new Date()) {
  const k = key();
  if (!k && outboxEnabled()) return 0;
  if (await capUntil(now)) return 0;
  const due = await db.emailQueue.findMany({ where: { status: "pending", nextTryAt: { lte: now } }, orderBy: { createdAt: "asc" }, take: PER_SWEEP });
  let sent = 0;
  for (const row of due) {
    const claimed = await db.emailQueue.updateMany({ where: { id: row.id, status: "pending", nextTryAt: row.nextTryAt }, data: { nextTryAt: new Date(now.getTime() + CLAIM_MS) } });
    if (claimed.count !== 1) continue;
    if (await deliver(row, k, now)) sent++;
    else if (await capUntil(now)) break; // the daily limit: the rest wait with it
  }
  await endIncidentIfClear();
  return sent;
}

/** Emails waiting after a failure (pending with an error). */
const WAITING = { status: "pending", lastError: { not: "" } } as const;

/** (Batch 23 section 2) The admins' bell, once per incident (an AppState row holds its start; in-app, so it doesn't depend on Resend). */
async function startIncident(now: Date) {
  try {
    await db.appState.create({ data: { key: EMAIL_INCIDENT_KEY, value: now.toISOString() } });
  } catch {
    return; // already open
  }
  const { adminUsers, bell } = await import("./notify");
  // Since the oldest email still waiting (the red box's "since"), or now.
  const oldest = await db.emailQueue.findFirst({ where: WAITING, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const since = oldest && oldest.createdAt < now ? oldest.createdAt : now;
  for (const a of await adminUsers()) {
    const tz = (await db.user.findUnique({ where: { id: a.id }, select: { timeZone: true } }))?.timeZone;
    await bell(a.id, emailsDownBell(since, now, tz), "/admin#emails", undefined, { own: true });
  }
}
/** The incident ends when nothing is waiting any more (all sent, or failed for good). */
async function endIncidentIfClear() {
  if (!(await db.emailQueue.count({ where: WAITING }))) await db.appState.deleteMany({ where: { key: EMAIL_INCIDENT_KEY } });
}

/** (Batch 23 section 2) For the admin console's red box: what's waiting (since when, Resend's last answer) and what failed for good (not cleared). */
export async function emailHealth() {
  const [waiting, oldest, latest, failedCount, failed] = await Promise.all([
    db.emailQueue.count({ where: WAITING }),
    db.emailQueue.findFirst({ where: WAITING, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.emailQueue.findFirst({ where: WAITING, orderBy: [{ lastTriedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], select: { lastError: true, errorKind: true } }),
    db.emailQueue.count({ where: { status: "failed", clearedAt: null } }),
    db.emailQueue.findMany({ where: { status: "failed", clearedAt: null }, orderBy: { failedAt: "desc" }, take: 50, select: { id: true, to: true, subject: true, failedAt: true, createdAt: true, lastError: true } }),
  ]);
  return { waiting, since: oldest?.createdAt ?? null, error: latest?.lastError ?? "", cap: latest?.errorKind === "cap", failedCount, failed };
}

/**
 * "Emails aren't sending: 12 waiting since 3:10 PM. Resend says: 503: Service unavailable." (the daily limit in plain words; the missing key: "RESEND_API_KEY isn't set
 * on this deploy."). `since` is on the reader's own clock.
 */
export function emailsDownLine(waiting: number, since: string, error: string, cap: boolean) {
  return `Emails aren't sending: ${waiting} waiting since ${since}. ${cap ? EMAIL_CAP_LINE : error === NO_EMAIL_KEY ? NO_KEY_DEPLOY_LINE : `Resend says: ${error.replace(/\.$/, "")}.`}`;
}

/** (Batch 23 section 2) Admin: the failed-for-good list is cleared from the red box (the emails are kept). */
export async function clearFailedEmails(now = new Date()) {
  const r = await db.emailQueue.updateMany({ where: { status: "failed", clearedAt: null }, data: { clearedAt: now } });
  return { cleared: r.count };
}

/** (Batch 23 section 2) /api/health's keyword: emails have been failing for 15 minutes or more (the oldest waiting email is that old). */
export async function emailsDegraded(now = new Date()) {
  const oldest = await db.emailQueue.findFirst({ where: WAITING, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  return !!oldest && now.getTime() - oldest.createdAt.getTime() >= EMAIL_DEGRADED_MINUTES * 60_000;
}
