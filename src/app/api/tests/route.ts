import { handle, ok, readJson } from "@/lib/server/http";
import { createTest } from "@/lib/server/tests";
import { requireActive, requireConfirmed, requireCurrentTerms } from "@/lib/server/users";

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireActive(req, { devSide: true, what: "Post" });
    requireConfirmed(u);
    const body = await readJson(req, 900_000); // (batch 15 sections 3 and 17) 20 questions and the steps at 20,000 characters each
    await requireCurrentTerms(u, body); // (batch 18 section 1) updated Terms: the box's tick first
    const t = await createTest(u, body);
    return ok({ id: t.id });
  });
}
