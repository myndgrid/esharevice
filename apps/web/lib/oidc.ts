import * as oauth from "oauth4webapi";
import { getEnv } from "./env";

/**
 * Cached OIDC discovery result. The issuer URL doesn't change at runtime,
 * so we discover once per process and reuse.
 */
let _config: oauth.AuthorizationServer | null = null;

export async function getAuthServer(): Promise<oauth.AuthorizationServer> {
  if (_config) return _config;
  const issuerUrl = new URL(getEnv().OIDC_ISSUER);
  const res = await oauth.discoveryRequest(issuerUrl, { algorithm: "oidc" });
  _config = await oauth.processDiscoveryResponse(issuerUrl, res);
  return _config;
}

export function getClient(): oauth.Client {
  const env = getEnv();
  return {
    client_id: env.OIDC_CLIENT_ID,
    client_secret: env.OIDC_CLIENT_SECRET,
    token_endpoint_auth_method: "client_secret_post",
  };
}

export function getClientAuth(): oauth.ClientAuth {
  return oauth.ClientSecretPost(getEnv().OIDC_CLIENT_SECRET);
}
