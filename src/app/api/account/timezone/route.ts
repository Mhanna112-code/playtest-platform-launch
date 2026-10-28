import { db } from "@/lib/db";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { readTimeZone } from "@/lib/server/passwords";
import { requireUser } from "@/lib/server/session";

// (Owner, Oct 30, batch 15 section 11) The browser's IANA time zone for this account (bell lines and emails are written in it). Works for every account, restricted or not.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const tz = readTimeZone((await readJson(req, 1000)).timeZone);
    if (!tz) throw new HttpError(400, "bad_zone", "That time zone isn't known.");
    if (tz !== u.timeZone) await db.user.update({ where: { id: u.id }, data: { timeZone: tz } });
    return ok({ timeZone: tz });
  });
}
