import { db } from "@/lib/db";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { accountGate, logAccountChange } from "@/lib/server/accountChanges";

/** "Off", "Daily", "Weekly", "Monthly": the email setting as a change line says it. */
const prefLabel = (p: string) => (p === "off" ? "Off" : p.charAt(0).toUpperCase() + p.slice(1));

// How you're notified by email (the full app's "How you're notified").
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const b = await readJson(req);
    const emailPref = ["daily", "weekly", "monthly", "off"].includes(b.emailPref as string) ? (b.emailPref as string) : "";
    if (!emailPref) throw new HttpError(400, "bad_pref", "Choose how often to be emailed.");
    // (Owner, Nov 3, batch 35 §157) Like the other settings: a change made in another tab or device since this page opened stops the first Save once ("Email:
    // Daily → Off"); the same value saved elsewhere isn't news. The change is recorded for the other tabs.
    await accountGate(u.id, b, "settings", { emailPref: prefLabel(emailPref) });
    const was = (await db.user.findUniqueOrThrow({ where: { id: u.id }, select: { emailPref: true } })).emailPref;
    await db.user.update({ where: { id: u.id }, data: { emailPref } });
    await logAccountChange(u.id, typeof b.tab === "string" ? b.tab : "", { scopes: ["settings"], field: "emailPref", label: "Email", before: prefLabel(was), after: prefLabel(emailPref) });
    return ok({ ok: true, at: new Date().toISOString() });
  });
}
