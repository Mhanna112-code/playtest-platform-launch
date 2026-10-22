import { NextResponse, type NextRequest } from "next/server";

// Signed-out visitors go to the sign-in page. (Pages and APIs still check the session itself.)
export function middleware(req: NextRequest) {
  if (!req.cookies.get("pt_session")?.value) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/app/:path*", "/admin/:path*", "/admin"] };
