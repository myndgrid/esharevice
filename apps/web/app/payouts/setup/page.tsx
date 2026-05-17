/**
 * `/payouts/setup` — Stripe Connect Express onboarding refresh URL.
 *
 * Stripe redirects here when an onboarding link expires (the 5-minute
 * AccountLink TTL) and the user clicks back to retry. Our job: fetch a
 * fresh onboarding link via POST /v1/payouts/account and redirect.
 *
 * Placeholder until PR 11 ships the full payouts dashboard. For now it
 * gives the user a friendly message + a link back to home where the
 * proper setup flow will live.
 */
import Link from "next/link";
import { Button, Card, CardContent } from "@esharevice/ui";

export const dynamic = "force-dynamic";

export default function PayoutsSetupPage(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center px-4 py-12">
      <Card>
        <CardContent>
          <div className="grid gap-4 text-center">
            <div
              aria-hidden
              className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand-deep"
            >
              <ArrowIcon />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Continue payouts setup</h1>
            <p className="text-sm text-fg-muted">
              Your previous Stripe onboarding link expired. We&apos;ll
              regenerate one — coming in PR 11. For now, contact support
              or call <code>POST /v1/payouts/account</code> directly to
              fetch a fresh link.
            </p>
            <div className="mt-2 flex justify-center gap-2">
              <Link href="/">
                <Button variant="brand" size="md">Back to home</Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function ArrowIcon(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
