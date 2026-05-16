import { z } from "zod";

/** Response shape for `GET /v1/exchange-items/{id}/save`. */
export const SaveState = z.object({
  saved: z.boolean(),
});
export type SaveState = z.infer<typeof SaveState>;
