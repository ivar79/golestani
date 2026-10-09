import { NextRequest, NextResponse } from "next/server";

const TOKEN_COOKIE = "golestani_token";
const PROTECTED_PREFIXES = ["/dashboard", "/panel", "/admin"];

export function proxy(request: NextRequest) {
  const token = request.cookies.get(TOKEN_COOKIE)?.value;
  const { pathname } = request.nextUrl;

  // Admin login uses its own password flow, not the public /login page —
  // exempt it from the guard or admins get bounced in a redirect loop.
  if (pathname === "/admin/login") {
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );

  if (isProtected && !token) {
    // Admin accounts authenticate through the password flow on /admin/login,
    // and the OTP flow on /login REJECTS admin phones with 403. Sending an
    // expired admin session to /login was a dead end: the OTP page offers no
    // link to /admin/login, so the admin had to know the URL by hand.
    const url = request.nextUrl.clone();
    url.pathname = pathname.startsWith("/admin") ? "/admin/login" : "/login";
    return NextResponse.redirect(url);
  }

  if (pathname === "/login" && token) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/panel/:path*", "/admin/:path*", "/login"],
};
