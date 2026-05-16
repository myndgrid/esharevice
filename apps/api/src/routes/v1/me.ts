import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { getDb, users } from "@esharevice/db";
import { EmailPrefs, EmailPrefsUpdate, UserPublic } from "@esharevice/shared";
import { requireAuth } from "../../middleware/auth.js";
import type { AppEnv } from "../../app.js";

const meRoute = new OpenAPIHono<AppEnv>();

const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number(),
    detail: z.string().optional(),
    instance: z.string().optional(),
  })
  .openapi("Problem");
const problemContent = { "application/problem+json": { schema: ProblemSchema } };

const UserPublicSchema = UserPublic.openapi("UserPublic");
const EmailPrefsSchema = EmailPrefs.openapi("EmailPrefs");
const EmailPrefsUpdateSchema = EmailPrefsUpdate.openapi("EmailPrefsUpdate");

meRoute.openapi(
  createRoute({
    method: "get",
    path: "/me",
    tags: ["users"],
    summary: "Return the authenticated user's profile.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth] as const,
    responses: {
      200: { description: "OK", content: { "application/json": { schema: UserPublicSchema } } },
      401: { description: "Unauthenticated", content: { "application/problem+json": { schema: ProblemSchema } } },
    },
  }),
  (c) => {
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    return c.json(
      UserPublic.parse({
        id: u.id,
        email: u.email,
        first_name: u.first_name,
        last_name: u.last_name,
        created_at: u.created_at.toISOString(),
      }),
      200,
    );
  },
);

// ─────────────────────── GET /v1/me/email-prefs
//
// Current per-category email opt-in state for the authenticated user.
// Drives the toggles on the preferences page.
meRoute.openapi(
  createRoute({
    method: "get",
    path: "/me/email-prefs",
    tags: ["users"],
    summary: "Read the authenticated user's email preferences.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth] as const,
    responses: {
      200: { description: "OK", content: { "application/json": { schema: EmailPrefsSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
    },
  }),
  async (c) => {
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const db = getDb();
    const rows = await db
      .select({
        new_message: users.email_new_message_enabled,
        reserved: users.email_reserved_enabled,
        saved_item_changed: users.email_saved_item_changed_enabled,
      })
      .from(users)
      .where(eq(users.id, u.id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new HTTPException(404, { message: "Not Found" });
    return c.json(EmailPrefs.parse(row), 200);
  },
);

// ─────────────────────── PATCH /v1/me/email-prefs
//
// Update one or more email preference toggles. Body is partial — only
// present keys are written. Returns the resulting full state.
meRoute.openapi(
  createRoute({
    method: "patch",
    path: "/me/email-prefs",
    tags: ["users"],
    summary: "Update the authenticated user's email preferences.",
    security: [{ Bearer: [] }],
    middleware: [requireAuth] as const,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: EmailPrefsUpdateSchema } },
      },
    },
    responses: {
      200: { description: "OK", content: { "application/json": { schema: EmailPrefsSchema } } },
      401: { description: "Unauthenticated", content: problemContent },
    },
  }),
  async (c) => {
    const u = c.get("user");
    if (!u) throw new HTTPException(401, { message: "no user attached" });
    const body = c.req.valid("json");
    const db = getDb();

    const patch: {
      email_new_message_enabled?: boolean;
      email_reserved_enabled?: boolean;
      email_saved_item_changed_enabled?: boolean;
      updated_at: Date;
    } = { updated_at: new Date() };
    if (body.new_message !== undefined) patch.email_new_message_enabled = body.new_message;
    if (body.reserved !== undefined) patch.email_reserved_enabled = body.reserved;
    if (body.saved_item_changed !== undefined)
      patch.email_saved_item_changed_enabled = body.saved_item_changed;

    const updated = await db
      .update(users)
      .set(patch)
      .where(eq(users.id, u.id))
      .returning({
        new_message: users.email_new_message_enabled,
        reserved: users.email_reserved_enabled,
        saved_item_changed: users.email_saved_item_changed_enabled,
      });
    const row = updated[0];
    if (!row) throw new HTTPException(404, { message: "Not Found" });
    return c.json(EmailPrefs.parse(row), 200);
  },
);

export default meRoute;
