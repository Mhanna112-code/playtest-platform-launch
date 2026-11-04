import { handle, ok, readJson } from "@/lib/server/http";
import { getKept, patchKept, setKept } from "@/lib/server/kept";
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
    const body = await readJson(req, 1_200_000); // (batch 15) a Post / Edit draft with 20 questions of 20,000 characters, or a 20,000-character written draft with its questions (§186; was 50,000)
    // (Batch 35 §120) Per-field drafts: only the units this tab changed ("units"); the whole form otherwise ("data").
    if (body.units !== undefined) return ok(await patchKept(u.id, body.key, body.units, { mark: body.mark, questions: body.questions }));
    return ok(await setKept(u.id, body.key, body.data));
  });
}
