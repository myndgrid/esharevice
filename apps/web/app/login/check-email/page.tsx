/**
 * Magic-link interstitial. Auth.js redirects here after a successful
 * Resend send (`pages.verifyRequest` in auth.ts). The user clicks the
 * link in their inbox, which hits /api/authjs/callback/resend?token=...
 * and lands them at their `redirectTo`. This page is purely informational.
 */
import { Card, CardContent } from "@esharevice/ui";

export const dynamic = "force-dynamic";

export default function CheckEmailPage(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-4 py-12">
      <Card>
        <CardContent>
          <div className="grid gap-4 text-center">
            <div aria-hidden className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand-deep">
              <EnvelopeIcon />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
            <p className="text-sm text-fg-muted">
              We just sent you a sign-in link. Click it on the same device to
              continue — the link works once and expires in 24 hours.
            </p>
            <p className="text-xs text-fg-subtle">
              Don&apos;t see it? Check your spam folder, or{" "}
              <a href="/login" className="text-brand underline">
                request another link
              </a>
              .
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function EnvelopeIcon(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}
