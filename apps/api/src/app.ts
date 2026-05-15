import type { JWTPayload } from "jose";
import type { User } from "@esharevice/db";

/** The set of values our middleware attaches to Hono's context. */
export type Variables = {
  user: User | undefined;
  auth: { sub: string; claims: JWTPayload } | undefined;
};

/** Shared Hono generics for OpenAPIHono / route handlers across the app. */
export type AppEnv = { Variables: Variables };
