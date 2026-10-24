import { db } from "@/lib/db";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

// How you're notified by email (the full app's "How you're notified").
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const b = await readJson(req);
    const emailPref = ["each", "daily", "weekly", "monthly", "off"].includes(b.emailPref as string) ? (b.emailPref as string) : "";
    if (!emailPref) throw new HttpError(400, "bad_pref", "Choose how often to be emailed.");
    await db.user.update({ where: { id: u.id }, data: { emailPref } });
    return ok({ ok: true });
  });
}
