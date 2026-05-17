"use server";

import { signOut } from "../../auth";

/**
 * Server action: invoke Auth.js's signOut. Clears the session cookie and
 * redirects to `/` by default. The form on profile/page.tsx posts to this
 * directly so we don't need to embed CSRF tokens in the form body.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
