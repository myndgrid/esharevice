"use server";

import { signIn } from "../../auth";

/**
 * Server action: kick off the Google OAuth handshake. Auth.js redirects to
 * Google, which 302s back to /api/authjs/callback/google. Our signIn
 * callback runs there and provisions the local users row.
 */
export async function signInGoogleAction(formData: FormData): Promise<void> {
  const callbackUrl = formData.get("callbackUrl");
  await signIn("google", {
    redirectTo: typeof callbackUrl === "string" && callbackUrl ? callbackUrl : "/",
  });
}

/**
 * Server action: send a magic-link email via Resend. Auth.js handles the
 * Resend POST, persists the verification token, and 302s to /login/check-email.
 * The user clicks the link in their inbox; that hits /api/authjs/callback/resend
 * with the token, the signIn callback runs, and the user lands wherever
 * redirectTo pointed.
 */
export async function signInResendAction(formData: FormData): Promise<void> {
  const email = formData.get("email");
  const callbackUrl = formData.get("callbackUrl");
  if (typeof email !== "string" || !email.includes("@")) {
    // Auth.js will redirect to /login?error=Default with no useful detail
    // if the email validation fails — better to fail closed here.
    return;
  }
  await signIn("resend", {
    email,
    redirectTo: typeof callbackUrl === "string" && callbackUrl ? callbackUrl : "/",
  });
}
