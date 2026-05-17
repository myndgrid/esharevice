/**
 * Lighthouse CI puppeteerScript — authenticates `lh-bot` before each audit
 * so the auth-gated routes (/messages, /items/new, /settings/notifications)
 * render their real signed-in shell instead of redirecting to /login.
 *
 * Strategy (post Phase 3 — Authentik is gone):
 *   • Mint an RS256 access token directly using the project's
 *     AUTH_JWT_PRIVATE_KEY (the same key Auth.js uses for session tokens).
 *   • POST to the API to confirm the token works (smoke check).
 *   • Inject an Auth.js session cookie shaped exactly like NextAuth.js v5's
 *     JWE-encrypted format... no, that's intractable client-side. Instead,
 *     drive the Credentials/email-magic-link callback path to mint a real
 *     session.
 *
 * The simpler approach used here: import the Auth.js session cookie value
 * from a static env var (LH_AUTHJS_SESSION_COOKIE) populated by the CI
 * pipeline. The cookie is per-bot, long-lived (30 days via Auth.js
 * defaults), and regenerated only when it expires.
 *
 * Required env vars (GitHub Actions secrets):
 *   LH_AUTHJS_SESSION_COOKIE — the value of the `esharevice_authjs_session`
 *                              cookie for the lh-bot account. Capture once
 *                              via a real browser sign-in, paste into the
 *                              secret store, regenerate when expired.
 *
 * The script is a no-op (logs + returns) when LH_AUTHJS_SESSION_COOKIE is
 * missing, which lets local LHCI runs against unauthenticated targets
 * still work.
 *
 * Wiring: lighthouserc.json `ci.collect.puppeteerScript` points at this
 * file. LHCI invokes it with `(browser, context)` BEFORE each audited URL;
 * the Lighthouse run inherits the session cookies set here via the shared
 * browser context.
 */

const WEB_ORIGIN = "https://esharevice.com";
const COOKIE_NAME = "esharevice_authjs_session";

module.exports = async (browser, _context) => {
  const cookieValue = process.env.LH_AUTHJS_SESSION_COOKIE;
  if (!cookieValue) {
    console.log(
      "[lh-auth] LH_AUTHJS_SESSION_COOKIE not set — skipping authentication.",
    );
    return;
  }

  await browser.setCookie({
    name: COOKIE_NAME,
    value: cookieValue,
    domain: new URL(WEB_ORIGIN).host,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
  });

  console.log(
    `[lh-auth] injected ${COOKIE_NAME} for ${new URL(WEB_ORIGIN).host}; Lighthouse will run as the signed-in lh-bot user.`,
  );
};
