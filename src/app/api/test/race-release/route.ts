import { raceHoldsOn, raceRelease, raceWaiting } from "@/lib/server/raceHold";

// (Owner, Nov 10, §369) TEST-ONLY: releases a request waiting at a race hold (lib/server/raceHold.ts). Not found unless RACE_HOLDS=1 (never in production).
export async function POST(req: Request) {
  if (!raceHoldsOn()) return new Response("Not found", { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; peek?: unknown };
  const name = typeof body.name === "string" ? body.name.slice(0, 64) : "";
  if (!name) return Response.json({ error: "Name the hold." }, { status: 400 });
  if (body.peek === true) return Response.json({ waiting: raceWaiting(name) });
  return Response.json(raceRelease(name));
}
