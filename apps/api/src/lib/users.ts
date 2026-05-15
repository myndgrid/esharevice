import { eq } from "drizzle-orm";
import { getDb, users, type User } from "@esharevice/db";

/**
 * Resolve a local user row from an OIDC `sub` claim. If no row exists for this `sub`,
 * create one lazily using the email + name claims from the token. The `sub` is the
 * stable Authentik user ID; users.email may change in Authentik over time, so it's
 * stored but not the primary key.
 */
export async function resolveUserFromSub(
  sub: string,
  claims: { email?: string; given_name?: string; family_name?: string; name?: string },
): Promise<User> {
  const db = getDb();
  const existing = await db.select().from(users).where(eq(users.oidc_sub, sub)).limit(1);
  if (existing[0]) return existing[0];

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
