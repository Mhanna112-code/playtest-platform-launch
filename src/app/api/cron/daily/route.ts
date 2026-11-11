import { runDaily } from "@/lib/server/holds";

// The daily job (Vercel Cron or any scheduler): Authorization: Bearer CRON_SECRET.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return new Response("CRON_SECRET isn't set", { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const out = await runDaily();
  // (Owner, Nov 11, §383) The timers lock stayed busy: nothing ran (logged); the next cron or a manual run does it.
  return out ? Response.json(out) : Response.json({ ran: false, error: "The timers lock stayed busy: the daily job didn't run." }, { status: 503 });
}
