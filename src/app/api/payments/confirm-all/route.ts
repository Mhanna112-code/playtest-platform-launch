import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { logConfirmed } from "@/lib/server/actionText";
import { db } from "@/lib/db";

// (Owner, Nov 3, batch 35 §147) "Confirm all": every charge waiting for "Confirm with your bank" as ONE payment with ONE bank check (opened inline under the button;
// it ends through /api/payments/confirm like any press's check). `cancel`: "Cancel this check" on an open Confirm all.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    if (u.deletedAt) throw new HttpError(403, "deleted", "This account was deleted.");
    const body = await readJson(req);
    const all = await import("@/lib/server/confirmAll");
    if (typeof body.cancel === "string") return ok(await all.cancelAll(u.id, body.cancel));
    const r = await all.confirmAllPress(u, body);
    // (§86) Each sent part it paid at once (the one payment, or one already confirmed at the bank) is answered, as a single Confirm answers it.
    // (Owner, Nov 3, batch 35 §163) One own line per charge it paid, calls included, as a single Confirm's: "You confirmed Ana Silva's $10.00 charge for her
    // written answers with your bank in another tab" (the other tabs show each; this tab never does).
    const ids = [...r.paidIds, ...("done" in r && r.oneId ? (await db.payment.findMany({ where: { coveredById: r.oneId, status: { in: ["charged", "not_set_up"] } }, select: { id: true } })).map((p) => p.id) : [])];
    for (const d of ids.length ? await db.payment.findMany({ where: { id: { in: [...new Set(ids)] }, contractId: { not: null } }, select: { id: true, kind: true, submissionId: true, callId: true, contractId: true, amountCents: true, repaysId: true } }) : []) await logConfirmed(u.id, body, d);
    return ok(r);
  });
}
