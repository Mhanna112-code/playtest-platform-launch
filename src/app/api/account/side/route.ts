import { db } from "@/lib/db";
import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

// (NEXT-UI 6 / 15) Switch to a side the account has, or add the other side to it ("Start testing too").
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const b = await readJson(req);
    const side = b.side === "developer" || b.side === "tester" ? b.side : null;
    if (!side) throw new HttpError(400, "bad_side", "Choose developer or tester.");
    const has = side === "developer" ? u.isDeveloper : u.isTester;
    if (!has && b.add !== true) throw new HttpError(409, "no_side", "Your account doesn't have that side yet.");
    await db.user.update({ where: { id: u.id }, data: { side, ...(side === "developer" ? { isDeveloper: true } : { isTester: true }) } });
    if (side === "tester") await db.testerProfile.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id, devices: [], languages: [], categories: [] } });
    return ok({ ok: true });
  });
}
