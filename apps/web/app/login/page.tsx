/**
 * Branded /login page — replaces Authentik's hosted flow with a Next.js
 * page that matches the marketplace visual system (sky-500 brand + Inter
 * + Card primitive).
 *
 * Forms POST to server actions that call Auth.js `signIn()`. Auth.js then
 * handles the OAuth dance (Google → consent → callback) or the magic-link
 * email send (Resend) before returning to /api/authjs/callback/* and
 * setting the session cookie. The user lands back here on errors, or on
 * `/login/check-email` after a magic-link send.
 *
 * The legacy Authentik path (`/api/auth/login`) remains live during the
 * migration window; the home/header still link there, this page is reached
 * via the new Auth.js URLs (`/api/authjs/signin/*`) and direct navigation.
 *
 * Plan: tasks/2026-05-16_premium-marketplace-redesign-plan.md §Auth surfaces.
 */
import { Button, Card, CardContent } from "@esharevice/ui";
import { signInGoogleAction, signInResendAction } from "./actions";

export const dynamic = "force-dynamic";

// `return_to` is accepted as an alias for `callbackUrl` so legacy Authentik
// callers (which used return_to) keep working through the cutover without
// having to rewrite every redirect. callbackUrl wins when both are set.
type SearchParams = { error?: string; callbackUrl?: string; return_to?: string };

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: "We couldn't sign you in. The account may not be authorized yet.",
  Verification: "The magic-link expired or has already been used. Request a new one below.",
  Configuration: "Sign-in isn't configured on this environment. Reach out to support.",
  Default: "Something went wrong signing you in. Try again, or use a different method.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const errorKey = params.error;
  const errorMsg = errorKey ? ERROR_MESSAGES[errorKey] ?? ERROR_MESSAGES.Default : null;
  // Resolve the post-login destination. Auth.js convention is `callbackUrl`;
  // legacy callers use `return_to`. callbackUrl wins when both are present.
  const callbackUrl = params.callbackUrl ?? params.return_to ?? "/";

  // Auth.js exposes the configured provider IDs by importing the auth
  // config and calling `.providers`. We avoid that import here to keep
  // the page server-render-only without pulling the full Auth.js setup —
  // env presence is the canonical check.
  const googleEnabled = Boolean(process.env["AUTH_GOOGLE_ID"]);
  const emailEnabled = Boolean(process.env["RESEND_API_KEY"]);

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-4 py-12">
      <Card>
        <CardContent>
          <div className="grid gap-6">
            <header className="grid gap-2 text-center">
              <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
              <p className="text-sm text-fg-muted">
                Sign in to e-Sharevice. New here? Sign in with Google or your email and we&apos;ll set up the rest.
              </p>
            </header>

            {errorMsg && (
              <p
                role="alert"
                className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                {errorMsg}
              </p>
            )}

            {googleEnabled && (
              <form action={signInGoogleAction}>
                <input type="hidden" name="callbackUrl" value={callbackUrl} />
                <Button type="submit" variant="brand" size="lg" className="w-full">
                  <GoogleIcon /> Continue with Google
                </Button>
              </form>
            )}

            {googleEnabled && emailEnabled && (
              <div className="flex items-center gap-3">
                <hr className="flex-1 border-border" />
                <span className="text-xs uppercase tracking-wide text-fg-subtle">or</span>
                <hr className="flex-1 border-border" />
              </div>
            )}

            {emailEnabled ? (
              <form action={signInResendAction} className="grid gap-3">
                <input type="hidden" name="callbackUrl" value={callbackUrl} />
                <label htmlFor="email" className="grid gap-1.5">
                  <span className="text-sm font-medium text-fg">Email</span>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="w-full rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-brand focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg"
                  />
                </label>
                <Button type="submit" variant="brand" size="lg" className="w-full">
                  Send magic link
                </Button>
                <p className="text-center text-xs text-fg-subtle">
                  We&apos;ll email you a one-time sign-in link. No password needed.
                </p>
              </form>
            ) : (
              !googleEnabled && (
                <p className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-center text-sm text-fg-muted">
                  Sign-in isn&apos;t configured yet. Check back soon.
                </p>
              )
            )}

            <p className="text-center text-xs text-fg-subtle">
              By continuing you agree to our terms and privacy policy.
            </p>
          </div>
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-xs text-fg-subtle">
        Trouble signing in?{" "}
        <a href="mailto:hello@esharevice.com" className="text-brand underline">
          Email us
        </a>
        .
      </p>
    </main>
  );
}

function GoogleIcon(): React.ReactElement {
  // Google's official 18px multicolour mark, inlined so it follows the
  // button's color scheme without a network round-trip.
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#fff"
        fillOpacity="0"
      />
      <path
        d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9081c1.7018-1.5668 2.6836-3.8741 2.6836-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9081-2.2581c-.806.54-1.8368.8595-3.0483.8595-2.344 0-4.3282-1.5831-5.036-3.7104H.957v2.3318C2.4382 15.9832 5.4818 18 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.4109 5.4109 0 0 1 3.6818 9c0-.5932.1023-1.1700.2823-1.71V4.9582H.957A8.997 8.997 0 0 0 0 9c0 1.4523.3477 2.8268.957 4.0418L3.964 10.71z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.957 4.9582L3.964 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795z"
        fill="#EA4335"
      />
    </svg>
  );
}
