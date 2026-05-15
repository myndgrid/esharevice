import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { UserPublic } from "@esharevice/shared";
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

const UserPublicSchema = UserPublic.openapi("UserPublic");

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

export default meRoute;
