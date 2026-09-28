import { NextRequest, NextResponse } from "next/server";

const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": [
    "camera=()",
    "microphone=()",
    "geolocation=()",
    "payment=()",
    "usb=(self)",
    "serial=(self)",
    "hid=(self)",
    "fullscreen=(self)",
  ].join(", "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "connect-src 'self' https: wss: ws:",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; "),
};

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(securityHeaders)) {
    response.headers.set(name, value);
  }

  response.headers.set("X-Morpheus-Request-Path", request.nextUrl.pathname);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
