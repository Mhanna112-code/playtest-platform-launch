import { db } from "@/lib/db";

export type Email = { to: string; subject: string; text: string; html?: string };

export const outboxEnabled = () => process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_OUTBOX === "1";

/** Send through Resend when RESEND_API_KEY is set; otherwise write it to the dev outbox (/dev/outbox). */
export async function sendEmail(e: Email) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
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
