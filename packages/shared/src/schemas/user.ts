import { z } from "zod";

// Authentik is the identity provider — the app never accepts a password.
// User rows are provisioned lazily on first sight of a valid OIDC `sub`.

export const UserPublic = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  first_name: z.string().min(1).max(80),
  last_name: z.string().min(1).max(80),
  created_at: z.string().datetime(),
});
export type UserPublic = z.infer<typeof UserPublic>;

// Profile fields a user may update on themselves.
export const UserProfileUpdate = z.object({
  first_name: z.string().min(1).max(80).optional(),
  last_name: z.string().min(1).max(80).optional(),
  postal_code: z.string().min(2).max(16).optional(),
});
export type UserProfileUpdate = z.infer<typeof UserProfileUpdate>;
