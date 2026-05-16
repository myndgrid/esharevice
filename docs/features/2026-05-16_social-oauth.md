# Feature: Social OAuth (Google + GitHub) via Authentik

**Created:** 2026-05-16 04:35 UTC
**Last Updated:** 2026-05-16 04:35 UTC
**Status:** Scaffolding shipped (blueprint template + env wiring + compose). Activation requires ~20 min of dashboard work — creating the OAuth apps in Google Cloud Console + GitHub, pasting client IDs/secrets into `infra/.env`, and renaming the template to `social.yaml`.

Once activated, the existing Authentik login screen at `https://auth.esharevice.com` gains "Sign in with Google" + "Sign in with GitHub" buttons. New users go through Authentik's default enrollment flow on first social sign-in (no separate signup form needed); returning users with the same email get matched to their existing account.

## Overview

This is end-to-end an Authentik feature. Our app's OIDC client config doesn't change — Authentik continues to be the issuer; we continue to verify its JWTs against the same JWKS. The only thing changing is *how* a user authenticates to Authentik (password ↔ social).

The repo ships scaffolding that lights up automatically once the user does the manual external steps:

- **Blueprint template** — [infra/authentik/blueprints/social.yaml.template](../../infra/authentik/blueprints/social.yaml.template). Lists `Google` + `GitHub` OAuth Sources tied to Authentik's default enrollment / authentication flows. `consumer_key` + `consumer_secret` read from env via Authentik's `!Env` YAML tag.
- **Compose env wiring** — [infra/docker-compose.yml](../../infra/docker-compose.yml) threads `GOOGLE_OAUTH_CLIENT_ID/SECRET` + `GITHUB_OAUTH_CLIENT_ID/SECRET` into both `authentik-server` + `authentik-worker` with empty defaults. Worker is the one that actually applies blueprints, so it needs the env too.
- **Env documentation** — [infra/.env.example](../../infra/.env.example) documents the variables + the URLs to register with Google / GitHub.

## Setup procedure (user task, ~20 min total)

### 1. Create the Google OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com).
2. Pick (or create) a project for esharevice.
3. **APIs & Services → OAuth consent screen** — pick "External," fill in app name, support email, dev contact. Add scope `email`, `profile`, `openid`. Add your domain to "Authorized domains."
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://auth.esharevice.com`
   - Authorized redirect URIs: `https://auth.esharevice.com/source/oauth/callback/google/`
5. Save the **Client ID** + **Client secret** that pop up after creation.

### 2. Create the GitHub OAuth app

1. Open [GitHub → Settings → Developer settings → OAuth Apps → New OAuth App](https://github.com/settings/developers).
2. Fill in:
   - Application name: `e-Sharevice`
   - Homepage URL: `https://esharevice.com`
   - Authorization callback URL: `https://auth.esharevice.com/source/oauth/callback/github/`
3. Save. Then **Generate a new client secret** and copy it (shown ONCE — paste before you navigate away).

### 3. Paste the four secrets into `/opt/esharevice/infra/.env` on the VPS

```dotenv
GOOGLE_OAUTH_CLIENT_ID=<from-step-1>
GOOGLE_OAUTH_CLIENT_SECRET=<from-step-1>
GITHUB_OAUTH_CLIENT_ID=<from-step-2>
GITHUB_OAUTH_CLIENT_SECRET=<from-step-2>
```

### 4. Activate the blueprint

On the VPS:

```bash
cd /opt/esharevice/infra/authentik/blueprints
cp social.yaml.template social.yaml
cd ../..
docker compose up -d --force-recreate authentik-server authentik-worker
```

The worker reads `social.yaml` from `/blueprints/custom/` on boot and applies it. Apply succeeds when `!Env` references resolve to non-empty strings (so make sure step 3 was written + the .env was saved before this step).

### 5. Verify

- Open `https://auth.esharevice.com` in a fresh incognito window.
- The login screen should show **Sign in with Google** + **Sign in with GitHub** buttons under the username/password form.
- Test the Google flow end-to-end: click → Google consent → return to esharevice landing page authenticated.
- Test the GitHub flow.
- The first social sign-in for an email address auto-creates an Authentik user; the API's lazy `resolveUserFromSub` provisions our `users` row on the first authenticated request. Same plumbing as password sign-up.

## Modules / Files Involved

| File | Role |
|---|---|
| [infra/authentik/blueprints/social.yaml.template](../../infra/authentik/blueprints/social.yaml.template) | Draft blueprint; rename to `social.yaml` to activate |
| [infra/docker-compose.yml](../../infra/docker-compose.yml) | Threads OAuth env into both authentik containers |
| [infra/.env.example](../../infra/.env.example) | Documents the four new env vars |

## Edge Cases & Gotchas

- **Blueprint applier fails on empty `consumer_key`.** That's why we ship `.template` — to prevent every worker restart from logging a failed apply. Renaming to `.yaml` is the explicit "I've filled in the env" signal.
- **`prompt=create` from the Sign-up CTA still works.** Authentik's enrollment flow accepts the OIDC standard prompt parameter; clicking Sign up + then "Sign in with Google" lands the user on enrollment for first-time Google users.
- **Account linking by email.** `user_matching_mode: email_link` means a returning user who first signed up via password and then comes back via Google (same email) gets linked to the existing account. Inverted: if a user wants two distinct accounts on the same email, they can't here — that's intentional.
- **Authentik blueprint applier reports SUCCESS on parse failure.** Existing bug-registry entry (`[Build] IaC / Blueprint Tools Report 'SUCCESS' on Parse Failure`). After step 4, verify the Source actually exists via the admin API:
  ```bash
  curl -sS -H "Authorization: Bearer $authentik_token" \
    https://auth.esharevice.com/api/v3/sources/oauth/ | jq '.results[].slug'
  ```
  You should see `google` and `github` in the list. If not, run `Importer.validate()` against the blueprint to surface the field-level error.
- **Logout flow unchanged.** End-session at Authentik clears its SSO cookie regardless of how the user signed in.
- **Callback URLs are fixed per Authentik provider type.** Don't try `/source/google/callback/` or other permutations — Authentik routes to `/source/oauth/callback/<slug>/` and rejects anything else.

## Environment Variables Required

| Variable | Notes |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | From Google Cloud Console → OAuth 2.0 Client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Same screen |
| `GITHUB_OAUTH_CLIENT_ID` | From GitHub → Developer settings → OAuth Apps |
| `GITHUB_OAUTH_CLIENT_SECRET` | Same screen (shown once on creation) |

Empty defaults are wired in `docker-compose.yml`, so leaving these unset is safe — Authentik just continues to show only the password login form.

## Changelog

| Date | Change |
|---|---|
| 2026-05-16 04:35 UTC | Initial documentation; scaffolding live (template + compose env + runbook). Activation pending the dashboard steps. |
