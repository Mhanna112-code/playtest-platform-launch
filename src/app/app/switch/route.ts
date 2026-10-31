// (Owner, Oct 30, batch 34 §5) The side switch. Only its POST (the header's switch button, and the notice's "Switch to your … side" on a page of the other
// side) changes sides, with the Account page's button (api/account/side). The GET (old links in emails) just opens the page asked for, never switching:
// a page of the other side shows the notice with the button. (Batch 15 section 41, L5) The POST must come from this site.
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
