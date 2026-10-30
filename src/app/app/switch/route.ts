import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hasSide } from "@/lib/sides";
import { getUserFromRequest } from "@/lib/server/session";
import { appUrl } from "@/lib/server/auth";
import { sameOriginForm } from "@/lib/server/http";

const safeNext = (next: string | null) => (next && next.startsWith("/app") && !next.startsWith("//") && !next.startsWith("/app/switch") ? next : "/app");
export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.redirect(new URL("/login", url));
  // Old email links still work, but only an explicit switch POST changes sides.
  return NextResponse.redirect(new URL(safeNext(url.searchParams.get("next")), url));
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  if (!sameOriginForm(req, appUrl(req))) return new Response("Forbidden", { status: 403 });
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.redirect(new URL("/login", url), 303);
  const form = await req.formData().catch(() => null);
  const to = String(form?.get("to") ?? url.searchParams.get("to") ?? "");
  const next = safeNext(String(form?.get("next") ?? url.searchParams.get("next") ?? ""));
  if ((to === "developer" || to === "tester") && hasSide(user, to)) await db.user.update({ where: { id: user.id }, data: { side: to } });
  return NextResponse.redirect(new URL(next, url), 303);
}
