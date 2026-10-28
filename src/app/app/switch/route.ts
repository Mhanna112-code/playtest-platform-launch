// (NEXT-UI 6) Following a link to a page for your other side (or pressing the header switch): change sides, then go straight there.
// (Batch 15 section 41, L5) The change itself is a POST from this site. A link (GET) answers with a small form: from one of this site's own pages it sends itself at
// once, so links keep working; from anywhere else (an email, another site) it waits for a press.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hasSide } from "@/lib/sides";
import { getUserFromRequest } from "@/lib/server/session";
import { appUrl } from "@/lib/server/auth";
import { sameOriginForm } from "@/lib/server/http";

const safeNext = (next: string | null) => (next && next.startsWith("/app") && !next.startsWith("//") && !next.startsWith("/app/switch") ? next : "/app");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.redirect(new URL("/login", url));
  const to = url.searchParams.get("to") === "tester" ? "tester" : "developer";
  const next = safeNext(url.searchParams.get("next"));
  const auto = req.headers.get("sec-fetch-site") === "same-origin";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Switching sides · Playtest</title>
<style>body{background:#0b0f1a;color:#e2e8f0;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}button{background:#c4f542;color:#0b0f1a;border:0;border-radius:10px;padding:10px 16px;font-weight:600;cursor:pointer}</style></head>
<body><form method="post" action="/app/switch" id="f"><input type="hidden" name="to" value="${esc(to)}"><input type="hidden" name="next" value="${esc(next)}"><button>Switch to your ${to} side and continue</button></form>${auto ? `<script>document.getElementById("f").submit()</script>` : ""}</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
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
