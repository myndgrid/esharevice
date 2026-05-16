import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { env, r2Configured } from "../env.js";

/**
 * Cloudflare R2 is S3-compatible. The endpoint is
 *   https://<account_id>.r2.cloudflarestorage.com
 * and the region must be `auto` (R2 ignores it but the SDK requires one).
 *
 * The S3 access_key_id / secret_access_key for R2 are created in the
 * Cloudflare dashboard under R2 → Manage R2 API tokens. As of 2026 the
 * public Cloudflare API does NOT expose creating these — they're dashboard-only.
 * See the bug-registry entry in CLAUDE.md.
 */
let _client: S3Client | null = null;

export function getR2(): S3Client {
  if (!r2Configured()) {
    throw new Error(
      "R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, CDN_BASE_URL in env.",
    );
  }
  if (_client) return _client;
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return _client;
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const client = getR2();
  await client.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET!,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Long-lived immutable cache — keys are content-hashed, so any change
      // produces a new key and the old URL is naturally invalidated.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

/** Returns true if the object exists in the bucket, false otherwise. */
export async function objectExists(key: string): Promise<boolean> {
  const client = getR2();
  try {
    await client.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET!, Key: key }));
    return true;
  } catch (err) {
    if (err && typeof err === "object" && "name" in err && err.name === "NotFound") {
      return false;
    }
    // 403 on a missing object also means absent (R2 sometimes returns this).
    if (
      err &&
      typeof err === "object" &&
      "$metadata" in err &&
      (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
    ) {
      return false;
    }
    throw err;
  }
}
