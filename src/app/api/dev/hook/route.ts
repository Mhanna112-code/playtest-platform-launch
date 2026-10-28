import { db } from "@/lib/db";
import { fakeOn } from "@/lib/server/stripe";

// TEST-ONLY hook for scripts/media.cjs (the report's recordings). It exists only while the local fake Stripe is on (STRIPE_FAKE=1, no real key, a localhost APP_URL:
// see fakeOn), and it only touches throwaway accounts (…@playtest.test). It runs ONE account's share of the daily job, so a recording never runs the whole job:
// - "retry": the daily automatic retry of what a held developer owes (batch 11 section 4);
// - "renew": that developer's subscription renewal, or its lapse after the retries (batch 8);
// - "summaries": the emails their notifications become (the summary, or with email Off only the must-send lines).
export async function POST(req: Request) {
  if (!fakeOn()) return new Response("Not found", { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; email?: string; now?: string };
  const email = String(body.email ?? "");
  if (!/@playtest\.test$/.test(email)) return Response.json({ error: "Only throwaway …@playtest.test accounts." }, { status: 400 });
  const u = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!u) return Response.json({ error: "No such account." }, { status: 404 });
  const now = body.now ? new Date(body.now) : new Date();
  if (body.action === "retry") return Response.json({ result: await (await import("@/lib/server/holds")).retryOwed(u.id, now, "daily") });
  if (body.action === "renew") return Response.json({ result: await (await import("@/lib/server/subscription")).renewSubscriptions(now, [u.id]) });
  if (body.action === "summaries") return Response.json({ result: await (await import("@/lib/server/notify")).sendSummaries(now, [u.id]) });
  return Response.json({ error: "Unknown action." }, { status: 400 });
}
