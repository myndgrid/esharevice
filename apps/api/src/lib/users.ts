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

  // Email-merge path: an Auth.js user might match an existing row by email
  // even when the sub differs. Fires for any Auth.js-shaped sub (google: /
  // apple: / email:) AND when the existing row's oidc_sub is NOT itself
  // Auth.js-shaped (i.e. it's a legacy Authentik sub). This is the
  // migration path — same human signs into the SAME email via Auth.js
  // now, we update their canonical sub from the Authentik UUID to the
  // provider-prefixed Auth.js form.
  //
  // Google + Apple both enforce 1:1 email-to-account, so an email
  // collision IS the same human. For magic-link, email IS the identity.
  //
  // We deliberately DON'T cross-merge between Auth.js providers (e.g.
  // signup via google:1234 then sign-in via email:same@addr). That would
  // silently flip the canonical sub mid-session and break the original
  // provider's future logins. Those collisions surface as 23505 →
  // AccessDenied; a future "account linking" feature can resolve them.
  const isAuthjsSub =
    sub.startsWith("google:") || sub.startsWith("apple:") || sub.startsWith("email:");
  if (isAuthjsSub && claims.email) {
    const byEmail = await db.select().from(users).where(eq(users.email, claims.email)).limit(1);
    if (byEmail[0]) {
      const existingIsAuthjs =
        byEmail[0].oidc_sub.startsWith("google:") ||
        byEmail[0].oidc_sub.startsWith("apple:") ||
        byEmail[0].oidc_sub.startsWith("email:");
      if (!existingIsAuthjs) {
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
      // Existing row is already Auth.js-shaped — refuse the merge. Fall
      // through to the INSERT below which fails on the email UNIQUE
      // constraint; caller surfaces AccessDenied.
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
