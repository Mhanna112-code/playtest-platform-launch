import { HttpError, handle, ok, readJson } from "@/lib/server/http";
import { openDispute } from "@/lib/server/payments";
import { leaveTest, sendWritten } from "@/lib/server/tests";
import { requireActive } from "@/lib/server/users";

type Ctx = { params: Promise<{ id: string; action: string }> };

// Tester actions on their own session (contract).
export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const { id, action } = await params;
    const u = await requireActive(req);
    const body = await readJson(req);
    switch (action) {
      case "leave":
        return ok(await leaveTest(u, id));
      case "dispute": {
        const d = await openDispute(u, id, body);
        return ok({ id: d.id });
      }
      case "written": {
        const s = await sendWritten(u, id, body);
        return ok({ id: s.id });
      }
    }
    throw new HttpError(404, "not_found", "That action doesn't exist.");
  });
}
