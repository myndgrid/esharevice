import { z } from "zod";

// Server-stored shape (response from the API).
export const ExchangeItem = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  provider: z.string().min(1).max(120),
  service: z.string().min(1).max(120),
  date: z.string(),
  exchange: z.string().min(1).max(240),
  description: z.string().min(1).max(4000),
  rate_type: z.string().max(40).nullable(),
  img_url: z.string().url().nullable(),
  img_hash: z.string().length(64).nullable(),
  reserved: z.boolean(),
  reserved_by: z.string().uuid().nullable(),
  reserved_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ExchangeItem = z.infer<typeof ExchangeItem>;

// Body for POST /v1/exchange-items (image is multipart, validated separately).
export const ExchangeItemCreate = z.object({
  provider: z.string().min(1).max(120),
  service: z.string().min(1).max(120),
  date: z.string().min(1),
  exchange: z.string().min(1).max(240),
  description: z.string().min(1).max(4000),
  rate_type: z.string().max(40).optional(),
});
export type ExchangeItemCreate = z.infer<typeof ExchangeItemCreate>;

// Body for PUT /v1/exchange-items/:id (all fields optional).
export const ExchangeItemUpdate = ExchangeItemCreate.partial();
export type ExchangeItemUpdate = z.infer<typeof ExchangeItemUpdate>;
