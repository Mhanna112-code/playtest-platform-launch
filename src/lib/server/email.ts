import { db } from "@/lib/db";

export type Email = { to: string; subject: string; text: string; html?: string };

export const outboxEnabled = () => process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_OUTBOX === "1";

/** (Batch 15 section 12) Production without the email key: nothing may silently land in the outbox table. */
export const NO_EMAIL_KEY = "Emails aren't being sent: RESEND_API_KEY is missing.";

/**
 * Send through Resend when RESEND_API_KEY is set; otherwise write it to the dev outbox (/dev/outbox). (Batch 15 section 12) In production without the key it throws and
 * logs, and never writes to the outbox unless ALLOW_DEV_OUTBOX=1 (staging).
 */
export async function sendEmail(e: Email) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_OUTBOX !== "1") {
      console.error(`[email] ${NO_EMAIL_KEY} (not sent: "${e.subject}")`);
      throw new Error(NO_EMAIL_KEY);
    }
    await db.outboxEmail.create({ data: { to: e.to, subject: e.subject, text: e.text, html: e.html ?? "" } });
    return { via: "outbox" as const };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || "Playtest <onboarding@resend.dev>", to: [e.to], subject: e.subject, text: e.text, html: e.html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => "")}`);
  return { via: "resend" as const };
}
