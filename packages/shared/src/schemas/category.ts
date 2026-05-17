import { z } from "zod";

/**
 * Category — leaf taxonomy a listing tags itself with. The 40-row seed
 * lives in packages/db/drizzle/0007_0001_listing_taxonomy.sql.
 *
 * `parent_slug` groups categories into the top-level marketplace strip
 * (Tools / Kitchen / Wheels / etc). `display_order` is the stable sort.
 */
export const Category = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  parent_slug: z.string().min(1).max(64).nullable(),
  icon: z.string().min(1).max(64).nullable(),
  display_order: z.number().int(),
});
export type Category = z.infer<typeof Category>;

/** Skinny shape embedded in exchange-item responses to save the round-trip. */
export const CategoryRef = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
});
export type CategoryRef = z.infer<typeof CategoryRef>;
