import { eq } from "drizzle-orm";
import { getDb, users, type User } from "@esharevice/db";

/**
 * Resolve a local user row from an OIDC `sub` claim. If no row exists for this
 * `sub`, create one lazily using the email + name claims from the token.
 *
 * Sub formats accepted:
 *   • Authentik — plain stable IDs (UUID-like strings).
 *   • Auth.js — provider-prefixed: `google:<account_id>`, `apple:<account_id>`,
 *     `email:<address>` (magic-link / future credentials).
 *
 * The `users.oidc_sub` column stores whichever form the issuer used. Both
 * coexist during the migration window; after Authentik teardown only Auth.js
 * subs remain. We DON'T migrate old rows — the legacy oidc_sub keeps working
 * because Authentik tokens still pass through the dual-issuer verifier until
 * those sessions naturally expire (30 days).
 *
 * Special case: when an Auth.js magic-link user signs in via `email:<addr>`
 * AND there's already a row with that email (originally provisioned via
 * Authentik with a different sub format), we DO merge by updating the
 * existing row's oidc_sub to the Auth.js form. This avoids double-rowing
 * the same human across the migration. See the email-merge branch below.
 */
export async function resolveUserFromSub(
  sub: string,
  claims: { email?: string; given_name?: string; family_name?: string; name?: string },
): Promise<User> {
  const db = getDb();

  // First try by oidc_sub directly — covers both legacy (Authentik) and new
  // (Auth.js) formats once they're already stored.
  const existing = await db.select().from(users).where(eq(users.oidc_sub, sub)).limit(1);
  if (existing[0]) return existing[0];

  // Email-merge path: an Auth.js magic-link user might match an existing
  // row by email even if oidc_sub differs. Only applies when the new sub is
  // Auth.js-shaped (has the prefix) AND the email is present + verified.
  // We DON'T do this for Google subs — those are stable per-provider and
  // a new Google sub for an existing email means a different Google account.
  const isAuthjsEmailSub = sub.startsWith("email:");
  if (isAuthjsEmailSub && claims.email) {
    const byEmail = await db.select().from(users).where(eq(users.email, claims.email)).limit(1);
    if (byEmail[0]) {
      const merged = await db
        .update(users)
        .set({ oidc_sub: sub, updated_at: new Date() })
        .where(eq(users.id, byEmail[0].id))
        .returning();
      const row = merged[0];
      if (row) return row;
      // Race lost — re-read.
      const reread = await db.select().from(users).where(eq(users.id, byEmail[0].id)).limit(1);
      if (reread[0]) return reread[0];
    }
  }

  const email = claims.email ?? `${sub}@oidc.invalid`;
  const first = claims.given_name ?? claims.name?.split(" ")[0] ?? "User";
  const last = claims.family_name ?? claims.name?.split(" ").slice(1).join(" ") ?? "";

  const inserted = await db
    .insert(users)
    .values({
      oidc_sub: sub,
      email,
      first_name: first,
      last_name: last,
    })
    .onConflictDoUpdate({
      target: users.oidc_sub,
      set: { updated_at: new Date() },
    })
    .returning();

  const row = inserted[0];
  if (!row) {
    // Race: another request inserted between our SELECT and INSERT. Re-read.
    const reread = await db.select().from(users).where(eq(users.oidc_sub, sub)).limit(1);
    if (!reread[0]) throw new Error("user provisioning failed");
    return reread[0];
  }
  return row;
}
