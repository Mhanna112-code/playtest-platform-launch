import { handle, ok, readJson } from "@/lib/server/http";
import { roomLeave, roomPoll, roomSend } from "@/lib/server/calls";
import { requireUser } from "@/lib/server/session";

// (Batch 21 section 1) The built-in call room's relay, adapted from the full app's /api/call/<slot>. GET polls: the other browser's connection messages after
// `after`, whether they're in the room, the measured minutes and the 2-minute warning; with `connected=1` it also counts as connected (the measured length).
// POST sends one message ({ kind, payload }) or leaves ({ kind: "leave" }). Every request is checked: only the call's two people, only while the room is open
// ("This call isn't available." otherwise, with the ending line for its two people).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireUser(req);
    const { id } = await params;
    const q = new URL(req.url).searchParams;
    const after = Math.max(0, Math.floor(Number(q.get("after") ?? 0) || 0));
    return ok(await roomPoll(u, id, after, q.get("connected") === "1"), { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const u = await requireUser(req);
    const body = await readJson(req);
    const { id } = await params;
    return ok(body.kind === "leave" ? await roomLeave(u, id) : await roomSend(u, id, body.kind, body.payload));
  });
}
