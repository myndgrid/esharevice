import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

let _db: Database | null = null;
let _client: ReturnType<typeof postgres> | null = null;

export function getDb(connectionString?: string): Database {
  if (_db) return _db;
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  _client = postgres(url, { max: 10 });
  _db = drizzle(_client, { schema, casing: "snake_case" });
  return _db;
}

export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.end({ timeout: 5 });
    _client = null;
    _db = null;
  }
}
