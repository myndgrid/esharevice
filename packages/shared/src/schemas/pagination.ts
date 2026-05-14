import { z } from "zod";

// Cursor-based pagination (offset breaks under mobile infinite scroll).
export const CursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CursorQuery = z.infer<typeof CursorQuery>;

export const cursorPage = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
  });
