import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { asc } from "drizzle-orm";
import { getDb, categories } from "@esharevice/db";
import { Category } from "@esharevice/shared";
import { env } from "../../env.js";
import type { AppEnv } from "../../app.js";

const route = new OpenAPIHono<AppEnv>();

const CategorySchema = Category.openapi("Category");
const ListResponseSchema = z
  .object({ items: z.array(Category) })
  .openapi("CategoryList");
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

// 24-hour cache. Categories ship with the 0007 seed and rarely change; the
// list endpoint is hot on every landing-page render. Cache header lets
// downstream Cloudflare/Caddy/browser caches do the heavy lifting.
const ONE_DAY_SECONDS = 60 * 60 * 24;

// ─────────────────────── GET /v1/categories
route.openapi(
  createRoute({
    method: "get",
    path: "/categories",
    tags: ["categories"],
    summary: "List all listing categories (40-row taxonomy, cached 24h).",
    description:
      "Returns the full category taxonomy sorted by `display_order`. " +
      "Gated by FEATURE_LISTING_TYPES — returns 404 until the flag flips. " +
      "Cache for 24h client-side; categories ship with migration 0007 and " +
      "rarely change.",
    responses: {
      200: { description: "OK", content: { "application/json": { schema: ListResponseSchema } } },
      404: { description: "Not enabled", content: problemContent },
    },
  }),
  async (c) => {
    if (!env.FEATURE_LISTING_TYPES) {
      throw new HTTPException(404, { message: "Not Found" });
    }
    const db = getDb();
    const rows = await db
      .select()
      .from(categories)
      .orderBy(asc(categories.display_order), asc(categories.name));
    c.header("Cache-Control", `public, max-age=${ONE_DAY_SECONDS}, s-maxage=${ONE_DAY_SECONDS}`);
    return c.json(
      {
        items: rows.map((r) =>
          CategorySchema.parse({
            id: r.id,
            slug: r.slug,
            name: r.name,
            parent_slug: r.parent_slug,
            icon: r.icon,
            display_order: r.display_order,
          }),
        ),
      },
      200,
    );
  },
);

export default route;
