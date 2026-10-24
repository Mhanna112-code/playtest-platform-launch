// (NEXT-UI 6) Following a link to a page for your other side (or pressing the header switch): change sides, then go straight there.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hasSide } from "@/lib/sides";
import { getUserFromRequest } from "@/lib/server/session";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? "/app";
  const safe = next.startsWith("/app") && !next.startsWith("//") && !next.startsWith("/app/switch") ? next : "/app";
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.redirect(new URL("/login", url));
  const to = url.searchParams.get("to");
  if ((to === "developer" || to === "tester") && hasSide(user, to)) await db.user.update({ where: { id: user.id }, data: { side: to } });
  return NextResponse.redirect(new URL(safe, url));
}
