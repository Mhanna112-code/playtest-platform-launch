import { handle, ok, readJson } from "@/lib/server/http";
import { payOwed } from "@/lib/server/holds";
import { requireUser } from "@/lib/server/session";

// "Pay what you owe": retries every failed charge still owed; lifts the payment hold when all are paid.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    return ok(await payOwed(u, await readJson(req)));
  });
}
