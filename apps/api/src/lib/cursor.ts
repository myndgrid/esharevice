// Cursor-based pagination — an opaque base64-encoded JSON object containing
// the (created_at, id) tuple of the last item on the current page.

export type Cursor = { ts: string; id: string };

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(s: string | undefined | null): Cursor | null {
  if (!s) return null;
  try {
    const decoded = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      typeof decoded.ts === "string" &&
      typeof decoded.id === "string"
    ) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}
