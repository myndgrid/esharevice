import { z } from "zod";

/**
 * Per-user transactional-email preferences. One boolean per category;
 * false = "don't email me about this." Mirrored 1-1 with the
 * `email_<category>_enabled` columns on `users`.
 */
export const EmailPrefs = z.object({
  new_message: z.boolean(),
  reserved: z.boolean(),
  saved_item_changed: z.boolean(),
});
export type EmailPrefs = z.infer<typeof EmailPrefs>;

/** PATCH body — every key optional; only present keys are updated. */
export const EmailPrefsUpdate = EmailPrefs.partial();
export type EmailPrefsUpdate = z.infer<typeof EmailPrefsUpdate>;

/** Recognised unsubscribe categories — must match the EmailCategory union in apps/api/src/lib/email.ts. */
export const EmailCategoryEnum = z.enum(["new_message", "reserved", "saved_item_changed"]);
export type EmailCategoryEnum = z.infer<typeof EmailCategoryEnum>;
