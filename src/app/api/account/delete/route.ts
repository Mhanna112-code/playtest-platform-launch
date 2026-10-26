import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { clearSessionCookie } from "@/lib/server/session";
import { requireUser } from "@/lib/server/session";
import { deleteAccount } from "@/lib/server/restrictions";

// (Design doc 9) Delete your account: tests stop, invites and applications are cancelled, history stays, and holds, chargebacks
// and what is owed are never cleared. Every open tab of the account is sent to the login page with a red notice.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const b = await readJson(req);
    if (b.confirmed !== true) throw new HttpError(400, "confirm", "Confirm that you want to delete your account.");
    await deleteAccount(u.id, "self");
    return ok({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
  });
}
