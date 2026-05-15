# Task: Fix silent sign-out caused by Next.js prefetching the logout link

**Created:** 2026-05-15 23:32 UTC
**Last Updated:** 2026-05-15 23:32 UTC
**Status:** Complete

## Objective

Stop `/api/auth/logout` from clearing auth cookies as a side-effect of Next.js's automatic `<Link>` prefetch. Symptom reported: "the home page renders unauthenticated even though I just logged in." Real cause: visiting `/profile` (which renders `<Link href="/api/auth/logout">`) triggered an RSC prefetch of the logout route; the route's 302 response carried `Set-Cookie` deletions which the browser applied immediately, evicting the session and access cookies. The subsequent cross-origin redirect to Authentik's `end_session_endpoint` failed CORS preflight, surfacing the misleading error:

```
Access to fetch at 'https://auth.esharevice.com/application/o/.../end-session/?...'
(redirected from 'https://app.esharevice.com/api/auth/logout?_rsc=…')
has been blocked by CORS policy: Response to preflight request doesn't pass
access control check: Redirect is not allowed for a preflight request.
```

The CORS error is a downstream symptom — the cookie clearing already happened before the redirect was attempted.

## Plan

1. Make `/api/auth/logout` POST-only — destructive operations must not be reachable via GET.
2. Replace `<Link href="/api/auth/logout">` in the profile page with a `<form method="post">` so clicking the button is the only way to trigger logout.
3. Defense-in-depth: add `prefetch={false}` to the remaining auth `<Link>` (login) so prefetch can't reintroduce the same class of bug.
4. Append a `[Security]` entry to the Living Bug Registry.

## Edge Cases to Handle

- Middleware already excludes `/api/auth/logout` from its matcher, so the POST change has no middleware-side fallout.
- The Button component spreads native HTML attributes, so `type="submit"` works without component changes.
- HTML buttons inside a `<form>` default to `type="submit"`, but we set it explicitly for clarity and to keep the intent obvious.

## Progress Log

### 2026-05-15 23:32 UTC
- Confirmed root cause by reading `app/api/auth/logout/route.ts`: the GET handler returned `NextResponse.redirect(...)` with `clearSessionCookieOn(response)` + `clearAccessCookieOn(response)`. Combined with Next 15's automatic `<Link>` prefetch, every page that mounted the logout link silently logged the user out.
- Changed the handler export from `GET` to `POST`. Added a comment explaining why GET is unsafe here.
- Replaced the `<Link>` in `app/profile/page.tsx` with a `<form action="/api/auth/logout" method="post">` wrapping a `<Button type="submit">`. The flex layout is preserved (form is a block-level element but works as a flex child without extra styling).
- Added `prefetch={false}` to the Sign in `<Link>` in `components/header.tsx`. The login route only sets a short-lived state cookie, so the impact of its prefetch is benign — but keeping the rule consistent across all auth links prevents future regressions.
- Added a `[Security]` bug-registry entry titled "Prefetched GET on a State-Clearing Route Silently Logs Users Out" and bumped the CLAUDE.md footer counter from 37 → 38 entries.
- `pnpm typecheck` green across all four workspace packages.

## Bugs / Issues Encountered

| Bug | Category | Resolution |
|---|---|---|
| Logout link prefetch silently signs users out | [Security] | Switched logout to POST + form submit; added bug-registry entry. |

## Files Changed

- `apps/web/app/api/auth/logout/route.ts` — `GET` → `POST` (with rationale comment).
- `apps/web/app/profile/page.tsx` — replaced `<Link href="/api/auth/logout">` with `<form method="post">`.
- `apps/web/components/header.tsx` — added `prefetch={false}` to the Sign in link.
- `CLAUDE.md` — appended `[Security]` registry entry; bumped footer counter and timestamp.

## Outcome

The home page can no longer be left in an unauthenticated state by merely visiting `/profile`. Logout now requires an explicit user submit. Future maintainers adding new auth-related routes will see the registry entry as a tripwire against the GET-side-effect anti-pattern.
