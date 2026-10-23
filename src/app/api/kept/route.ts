import { handle, ok, readJson } from "@/lib/server/http";
import { getKept, setKept } from "@/lib/server/kept";
import { requireUser } from "@/lib/server/session";

// (NEXT-UI 10) Kept forms: what's typed and not sent, per person and form.
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    return ok(await getKept(u.id, new URL(req.url).searchParams.get("key")));
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const body = await readJson(req);
    return ok(await setKept(u.id, body.key, body.data));
  });
}
