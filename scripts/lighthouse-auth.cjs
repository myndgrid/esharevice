/**
 * Lighthouse CI puppeteerScript — authenticates lh-bot before each audit
 * so the auth-gated routes (/messages, /items/new, /settings/notifications)
 * render their real signed-in shell instead of redirecting to login.
 *
 * Strategy: drive Authentik's flow-executor JSON API directly rather than
 * clicking the Lit-rendered login form. The form's visible inputs live
 * inside Lit shadow roots while the light-DOM <input>s are decoys; chasing
 * them with Puppeteer selectors was brittle across stage transitions.
 * The JSON API is stable + version-controlled and the credentials are
 * one shared secret pair instead of per-form-selector hardcodes.
 *
 * Required env vars (set as GitHub Actions secrets):
 *   LH_USER       — Authentik username, e.g. "lh-bot"
 *   LH_PASSWORD   — that user's password
 *
 * The script is a no-op (logs + returns) when either var is missing,
 * which lets local LHCI runs against unauthenticated targets still work.
 *
 * Wiring: lighthouserc.json `ci.collect.puppeteerScript` points at this
 * file. LHCI invokes it with `(browser, context)` BEFORE each audited URL;
 * the Lighthouse run inherits the session cookies set here via the shared
 * browser context.
 *
 * Bug-registry: the Django CSRF middleware Authentik uses reads its
 * configured CSRF header (`CSRF_HEADER_NAME = HTTP_X_AUTHENTIK_CSRF`),
 * NOT the Django default `HTTP_X_CSRFTOKEN`. POSTing the consent stage
 * without the right header name returns `ak-stage-flow-error` with only
 * a `request_id` — opaque from the client. Fix is the `X-Authentik-CSRF`
 * header in the POST.
 */
const crypto = require("node:crypto");

const WEB_ORIGIN = "https://esharevice.com";
const AUTH_ORIGIN = "https://auth.esharevice.com";
const FLOW_AUTHENTICATION = "default-authentication-flow";
const FLOW_CONSENT = "default-provider-authorization-implicit-consent";

module.exports = async (browser, _context) => {
  const user = process.env.LH_USER;
  const password = process.env.LH_PASSWORD;
  if (!user || !password) {
    console.log("[lh-auth] LH_USER or LH_PASSWORD not set — skipping authentication.");
    return;
  }

  // ─────────────────────── Tiny per-host cookie jar
  const jars = { [new URL(WEB_ORIGIN).host]: new Map(), [new URL(AUTH_ORIGIN).host]: new Map() };
  const captureCookies = (url, headers) => {
    const host = new URL(url).host;
    const jar = jars[host];
    if (!jar) return;
    const setCookieValues =
      headers.getSetCookie?.() || (headers.get("set-cookie") ? [headers.get("set-cookie")] : []);
    for (const sc of setCookieValues) {
      const [pair] = sc.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) jar.set(name, value);
    }
  };
  const cookieHeader = (url) => {
    const host = new URL(url).host;
    return [...jars[host]].map(([k, v]) => `${k}=${v}`).join("; ");
  };

  const jsonHeaders = () => ({
    cookie: cookieHeader(AUTH_ORIGIN),
    accept: "application/json",
    "content-type": "application/json",
    // Django CSRF expects the value from `authentik_csrf` cookie via this
    // header — see the file-level comment for why this name specifically.
    "X-Authentik-CSRF": jars[new URL(AUTH_ORIGIN).host].get("authentik_csrf") || "",
    referer: AUTH_ORIGIN + "/",
  });

  // ─────────────────────── 1. Start our web's login route so it seeds esharevice_oidc_state
  let r = await fetch(`${WEB_ORIGIN}/api/auth/login?return_to=/`, { redirect: "manual" });
  captureCookies(WEB_ORIGIN, r.headers);
  const authorizeUrl = r.headers.get("location");
  if (!authorizeUrl) throw new Error("[lh-auth] /api/auth/login didn't redirect");

  // 2. Follow into Authentik authorize endpoint — sets authentik_session
  r = await fetch(authorizeUrl, { redirect: "manual" });
  captureCookies(authorizeUrl, r.headers);
  const flowStartUrl = AUTH_ORIGIN + r.headers.get("location");
  // 3. Hit the flow-start URL to seed the executor with `next=`
  r = await fetch(flowStartUrl, { redirect: "manual", headers: { cookie: cookieHeader(AUTH_ORIGIN) } });
  captureCookies(flowStartUrl, r.headers);
  const queryArg = encodeURIComponent(flowStartUrl.split("?")[1] || "");

  // 4. ak-stage-identification
  await fetch(`${AUTH_ORIGIN}/api/v3/flows/executor/${FLOW_AUTHENTICATION}/?query=${queryArg}`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ component: "ak-stage-identification", uid_field: user }),
  }).then((res) => {
    captureCookies(AUTH_ORIGIN, res.headers);
    return res.json();
  });

  // 5. ak-stage-password — returns xak-flow-redirect → /application/o/authorize/?...
  let stage = await fetch(`${AUTH_ORIGIN}/api/v3/flows/executor/${FLOW_AUTHENTICATION}/?query=${queryArg}`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ component: "ak-stage-password", password }),
  }).then((res) => {
    captureCookies(AUTH_ORIGIN, res.headers);
    return res.json();
  });
  if (stage.component !== "xak-flow-redirect") {
    throw new Error(`[lh-auth] expected xak-flow-redirect after password, got: ${stage.component}`);
  }

  // 6. Follow the post-auth redirect to start the consent flow
  r = await fetch(AUTH_ORIGIN + stage.to, {
    redirect: "manual",
    headers: { cookie: cookieHeader(AUTH_ORIGIN) },
  });
  captureCookies(AUTH_ORIGIN, r.headers);
  const consentStartUrl = AUTH_ORIGIN + r.headers.get("location");
  const consentQuery = encodeURIComponent(consentStartUrl.split("?")[1] || "");
  await fetch(consentStartUrl, { headers: { cookie: cookieHeader(AUTH_ORIGIN) } }).then((res) =>
    captureCookies(AUTH_ORIGIN, res.headers),
  );

  // 7. GET consent — returns ak-stage-consent with a one-time `token`
  stage = await fetch(`${AUTH_ORIGIN}/api/v3/flows/executor/${FLOW_CONSENT}/?query=${consentQuery}`, {
    headers: { cookie: cookieHeader(AUTH_ORIGIN), accept: "application/json" },
  }).then((res) => {
    captureCookies(AUTH_ORIGIN, res.headers);
    return res.json();
  });
  if (stage.component !== "ak-stage-consent") {
    throw new Error(`[lh-auth] expected ak-stage-consent, got: ${stage.component}`);
  }

  // 8. POST consent with the one-time token + the X-Authentik-CSRF header
  stage = await fetch(`${AUTH_ORIGIN}/api/v3/flows/executor/${FLOW_CONSENT}/?query=${consentQuery}`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ component: "ak-stage-consent", token: stage.token }),
  }).then((res) => {
    captureCookies(AUTH_ORIGIN, res.headers);
    return res.json();
  });
  if (stage.component !== "xak-flow-redirect") {
    throw new Error(`[lh-auth] consent didn't redirect — got: ${stage.component}`);
  }

  // 9. /api/auth/callback?code=...&state=... — exchanges code for tokens + sets
  //    esharevice_session + esharevice_at on esharevice.com
  r = await fetch(stage.to, {
    redirect: "manual",
    headers: { cookie: cookieHeader(WEB_ORIGIN) },
  });
  captureCookies(WEB_ORIGIN, r.headers);
  if (![200, 302, 303, 307].includes(r.status)) {
    throw new Error(`[lh-auth] callback exchange failed with status ${r.status}`);
  }

  // 10. Inject the resulting esharevice.com cookies into the Puppeteer browser
  //     context. Lighthouse will fetch each audited URL with these in scope.
  const cookies = [...jars[new URL(WEB_ORIGIN).host]].map(([name, value]) => ({
    name,
    value,
    domain: new URL(WEB_ORIGIN).host,
    path: "/",
    secure: true,
    httpOnly: name === "esharevice_session" || name === "esharevice_at",
    sameSite: "Lax",
  }));
  await browser.setCookie(...cookies);
  console.log(
    `[lh-auth] authenticated as ${user}; injected ${cookies.length} cookies (${cookies.map((c) => c.name).join(", ")})`,
  );
};
