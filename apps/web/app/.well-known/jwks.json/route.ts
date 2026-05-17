/**
 * JWKS endpoint — exposes the public counterpart of AUTH_JWT_PRIVATE_KEY
 * as a JSON Web Key Set so the Hono API (and any other verifier) can
 * check tokens this app signs.
 *
 * Derives the public JWK at runtime from the private key — no second env
 * var to keep in sync. The key never leaves this process; only `n`, `e`,
 * `kty`, `kid`, `alg`, `use` ship in the response.
 *
 * Cached with a long max-age. The key only rotates when AUTH_JWT_PRIVATE_KEY
 * itself is replaced, which invalidates every active session anyway.
 *
 * Path: /.well-known/jwks.json
 * Convention: matches OIDC's JWKS endpoint discovery so any standard library
 * (jose, openid-client, etc.) finds it without extra config.
 */
import { NextResponse } from "next/server";
import { exportJWK, importPKCS8 } from "jose";

export const dynamic = "force-dynamic";

const ONE_DAY = 60 * 60 * 24;

export async function GET(): Promise<NextResponse> {
  const pemBase64 = process.env["AUTH_JWT_PRIVATE_KEY"];
  if (!pemBase64) {
    // Don't 500 here — emit an empty key set so a fresh-clone dev environment
    // without the key wired up doesn't break callers. The API's verifier
    // will fail any token against an empty JWKS, which is the right behavior.
    return NextResponse.json(
      { keys: [] },
      {
        status: 200,
        headers: { "cache-control": `public, max-age=60` },
      },
    );
  }

  const pem = Buffer.from(pemBase64, "base64").toString("utf8");
  const privateKey = await importPKCS8(pem, "RS256", { extractable: true });
  const publicJwk = await exportJWK(privateKey);

  // exportJWK on a private key returns the public *and* private components.
  // Strip everything but the public bits so we never accidentally leak `d`,
  // `p`, `q`, `dp`, `dq`, `qi`.
  const { kty, n, e } = publicJwk;
  const safe = {
    kty,
    n,
    e,
    alg: "RS256",
    use: "sig",
    kid: "authjs-rs256",
  };

  return NextResponse.json(
    { keys: [safe] },
    {
      status: 200,
      headers: {
        "cache-control": `public, max-age=${ONE_DAY}, s-maxage=${ONE_DAY}`,
        // Explicit content-type for any client that expects RFC 7517.
        "content-type": "application/jwk-set+json; charset=utf-8",
      },
    },
  );
}
