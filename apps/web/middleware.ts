/**
 * Auth.js manages its own session cookie + token rotation internally
 * (see `apps/web/auth.ts`). After Phase 3 of the Authentik teardown,
 * this middleware is a no-op pass-through — we keep the file because
 * Next.js's matcher config still excludes `_next/static`, `_next/image`,
 * and `favicon.ico` from the App Router's response-streaming pipeline
 * even when the function body is empty, and removing the file entirely
 * would change those baseline behaviours.
 *
 * If a future feature needs request-level middleware (geo routing,
 * security headers, rate limiting), this is the file to extend.
 */
import { NextResponse, type NextRequest } from "next/server";

export function middleware(_req: NextRequest): NextResponse {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/authjs|\\.well-known/jwks\\.json).*)",
  ],
};
