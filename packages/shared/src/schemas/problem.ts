import { z } from "zod";

// RFC 7807 problem+json — the ONLY error shape the API returns.
export const Problem = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
});
export type Problem = z.infer<typeof Problem>;
