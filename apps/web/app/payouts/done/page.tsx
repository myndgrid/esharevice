/**
 * `/payouts/done` — Stripe Connect Express onboarding return URL.
 *
 * Stripe redirects here after the user submits or skips the onboarding flow.
 * "Done" doesn't necessarily mean `status='active'` — Stripe may need a few
 * minutes (sometimes hours) to verify identity. The mirror row's status
 * comes from the `account.updated` webhook, not from this redirect.
 *
 * This is a placeholder until PR 11 ships the full payouts dashboard with
 * status timeline + "Open Stripe dashboard" CTA. For now it gives the user
 * a friendly landing instead of a 404.
 */
import Link from "next/link";
import { Button, Card, CardContent } from "@esharevice/ui";

export const dynamic = "force-dynamic";

export default function PayoutsDonePage(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center px-4 py-12">
      <Card>
        <CardContent>
          <div className="grid gap-4 text-center">
            <div
              aria-hidden
              className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand-deep"
            >
              <CheckIcon />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Payouts setup submitted</h1>
            <p className="text-sm text-fg-muted">
              Stripe is verifying your information. You can start accepting
              bookings once it&apos;s done — usually within a few minutes.
              We&apos;ll email you if Stripe needs anything else.
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

function CheckIcon(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
