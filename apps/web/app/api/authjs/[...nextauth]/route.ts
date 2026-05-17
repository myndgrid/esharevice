/**
 * Auth.js v5 catch-all handler.
 *
 * Mounted at `/api/authjs/*` (basePath set in auth.ts) so it doesn't
 * collide with the legacy Authentik routes at `/api/auth/*`. Both
 * systems coexist during the migration window; the planned cleanup
 * deletes the legacy routes after the 7-day overlap.
 */
import { handlers } from "../../../../auth";

export const { GET, POST } = handlers;
