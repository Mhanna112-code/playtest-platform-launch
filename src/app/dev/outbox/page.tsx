import { notFound } from "next/navigation";
import { Brand } from "@/components/Brand";
import { db } from "@/lib/db";
import { outboxEnabled } from "@/lib/server/email";
import { getPageUser } from "@/lib/server/page-auth";
import { isAdmin } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dev outbox · Playtest" };

// Emails written instead of sent (no RESEND_API_KEY). Only outside production, or with ALLOW_DEV_OUTBOX=1, and (batch 15 section 41, M3) only for an admin: it shows
// reset links.
export default async function Outbox() {
  if (!outboxEnabled()) notFound();
  const u = await getPageUser();
  if (!u || !isAdmin(u)) notFound();
  const mails = await db.outboxEmail.findMany({ orderBy: { createdAt: "desc" }, take: 40 });
  return (
    <main className="wrap space-y-4">
      <Brand />
      <h1>Dev outbox</h1>
      <p className="note">Emails aren&apos;t sent in this environment. The newest is first; sign-in links work once.</p>
      {mails.length === 0 && <p className="note">No emails yet.</p>}
      {mails.map((m) => (
        <div className="panel !space-y-1" key={m.id}>
          <p className="note">
            To {m.to} · {m.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC
          </p>
          <b>{m.subject}</b>
          {m.text.split("\n").map((line, i) =>
            /^https?:\/\//.test(line) ? (
              <a key={i} href={line} className="block break-all">
                {line}
              </a>
            ) : (
              <p key={i} className="text-sm">{line || " "}</p>
            ),
          )}
        </div>
      ))}
    </main>
  );
}
