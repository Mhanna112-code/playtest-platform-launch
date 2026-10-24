import { NextResponse, type NextRequest } from "next/server";

// Signed-out visitors go to the sign-in page. (Pages and APIs still check the session itself.)
export function middleware(req: NextRequest) {
  if (!req.cookies.get("pt_session")?.value) return NextResponse.redirect(new URL("/login", req.url));
  // The page's own address, for the layout (which side this tab shows).
  const headers = new Headers(req.headers);
  headers.set("x-path", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/app/:path*", "/admin/:path*", "/admin"] };
