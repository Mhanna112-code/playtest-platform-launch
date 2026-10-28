import { handle, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { removeVisit } from "@/lib/server/testVisits";

// (Owner, Oct 28, batch 17 §18) "Remove" (×) on a "Tests visited" card: drops it from the list, no confirm. Opening the test's join page again brings it back.
export async function POST(req: Request, { params }: { params: Promise<{ testId: string }> }) {
  return handle(async () => {
    const u = await requireUser(req);
    const { testId } = await params;
    await removeVisit(u.id, testId);
    return ok({ removed: true });
  });
}
