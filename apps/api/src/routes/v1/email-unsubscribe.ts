import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { getDb, users } from "@esharevice/db";
import { EmailCategoryEnum } from "@esharevice/shared";
import type { AppEnv } from "../../app.js";

/**
 * Public unauthenticated POST that flips an email preference to false for
 * the user identified by their opaque `email_token` and the supplied
 * `category`. The token is the per-user capability — possession of it is
 * the authorisation; no session required.
 *
 * Why POST and not GET: GET endpoints with side effects get prefetched
 * (link previews, browser scanners, security tools). The web-side
 * `/unsubscribe` route renders a confirmation page on GET; users press a
 * "Confirm unsubscribe" form there which POSTs to this endpoint. That
 * one-extra-click prevents bots and over-eager link previews from
 * accidentally unsubscribing the user.
 *
 * RFC 8058 one-click POST (List-Unsubscribe-Post: List-Unsubscribe=One-Click)
 * is intentionally NOT supported yet — it'd require pre-confirming the
 * token + a CSRF-free POST body, and we don't have the email volume yet
 * to need Gmail/iOS one-click. Easy to add later by relaxing this route.
 */
const route = new OpenAPIHono<AppEnv>();

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

const UnsubscribeBody = z
  .object({
    token: z.string().uuid(),
    category: EmailCategoryEnum,
  })
  .openapi("UnsubscribeBody");

route.openapi(
  createRoute({
    method: "post",
    path: "/email/unsubscribe",
    tags: ["email"],
    summary: "Opt the recipient out of a transactional-email category via their unsubscribe token.",
    request: {
      body: { required: true, content: { "application/json": { schema: UnsubscribeBody } } },
    },
    responses: {
      204: { description: "Unsubscribed" },
      400: { description: "Bad token or category", content: problemContent },
      404: { description: "Token not recognised", content: problemContent },
    },
  }),
  async (c) => {
    const { token, category } = c.req.valid("json");
    const db = getDb();

    const patch =
      category === "new_message"
        ? { email_new_message_enabled: false, updated_at: new Date() }
        : category === "reserved"
          ? { email_reserved_enabled: false, updated_at: new Date() }
          : { email_saved_item_changed_enabled: false, updated_at: new Date() };

    const updated = await db
      .update(users)
      .set(patch)
      .where(eq(users.email_token, token))
      .returning({ id: users.id });
    if (updated.length === 0) {
      // Return 404 (not 401/403) so we don't confirm or deny whether a
      // particular token shape is "live" to anyone who might be fishing.
      throw new HTTPException(404, { message: "Token not recognised" });
    }
    return new Response(null, { status: 204 });
  },
);

export default route;
