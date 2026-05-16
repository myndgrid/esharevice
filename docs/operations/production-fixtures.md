# Production fixtures + automation accounts

**Created:** 2026-05-16 18:48 UTC
**Last Updated:** 2026-05-16 18:48 UTC
**Status:** Authoritative reference for production state that lives "outside the code" — automation accounts in Authentik, pinned database rows that CI depends on, and similar long-lived load-bearing state. Update this file whenever you create, rotate, or retire any of the listed resources.

If you delete or rename anything below without updating the consumers, CI will break or audits will skew. Each entry calls out its consumers explicitly.

---

## Automation accounts

### `lh-bot` — Lighthouse CI authenticator

| Property | Value |
|---|---|
| Authentik primary key | `8` |
| Username | `lh-bot` |
| Email | `lh-bot@esharevice.com` |
| Display name | Lighthouse CI Bot |
| Group | `esharevice-users` (`3aad09a1-2499-4df5-97b0-7a72407ef641`) |
| Created | 2026-05-16 18:11 UTC |
| Created by | [docs/features/2026-05-16_lighthouse-ci-public-routes.md](../features/2026-05-16_lighthouse-ci-public-routes.md) work |

**Purpose.** Authenticates Lighthouse CI runs against the three auth-gated audit targets (`/messages`, `/items/new`, `/settings/notifications`). The puppeteerScript at [scripts/lighthouse-auth.cjs](../../scripts/lighthouse-auth.cjs) drives Authentik's flow-executor JSON API with this user's credentials, then injects the resulting session cookies into Lighthouse's browser context.

**Credentials.** Username + password live in:
- `.env.creds` at the repo root, keys `lh_bot_username` + `lh_bot_password` (gitignored).
- GitHub Actions repo secrets `LH_USER` + `LH_PASSWORD` on `myndgrid/esharevice`.

**Rotating the password.** Three places to update, in order:
1. Set the new password via Authentik admin (`POST /api/v3/core/users/8/set_password/` with `{"password": "<new>"}`).
2. Update `.env.creds` lines.
3. `gh secret set LH_PASSWORD --repo myndgrid/esharevice` with the new value piped on stdin.

**Watching out for it.**
- It WILL show up in any user-count reports until you filter `WHERE oidc_sub NOT LIKE '%lh-bot%'` or similar.
- It has zero seeded data (no listings, no conversations, no saves) — the auth-gated audits measure empty-state pages. If we want to measure populated states, seed via the API; document the data here.
- The session cookies it generates are real production sessions. The script obtains them on every CI run; they expire on their own per Authentik's session policy. We don't persist them.

---

## Database fixtures

### Lorem Ipsum demo listing — pinned Lighthouse audit target

| Property | Value |
|---|---|
| `exchange_items.id` | `62756a14-5e08-4700-9f4f-1cf9dc14a1bf` |
| `provider` | `demo_user` |
| `service` | `Lorem Ipsum` |
| `description` (head) | "Lorem Ipsum is simply dummy text of the printing and typesetting industry…" |
| `archived_at` | `NULL` (must stay this way) |
| `reserved` | `false` |

**Purpose.** The Lighthouse CI audit at [lighthouserc.json](../../lighthouserc.json) hard-codes this listing's URL (`/items/62756a14-5e08-4700-9f4f-1cf9dc14a1bf`) as the public item-detail audit target. Pinning to a stable listing was chosen over rotating to "newest item" so the audit's score history is comparable across CI runs and doesn't get noised by listing-content variance.

**Don't.**
- ❌ Archive this listing — it'll 404 the CI audit.
- ❌ Reserve it — changes the page's button state, can shift perf metrics.
- ❌ Replace its image — changes LCP timing and can shift the perf score.
- ❌ Soft-delete or hard-delete.

**If you need to delete it anyway.** Edit `lighthouserc.json`'s `ci.collect.url` array, swap `/items/<this-id>` for a new pinned URL pointing at another listing (ideally also tagged as a stable fixture), and update this doc.

**Owner.** Owned by an Authentik user whose `oidc_sub` maps to `demo_user`. The original posting user; not `lh-bot`.

---

## Pointers back into this doc

- [CLAUDE.md](../../CLAUDE.md) — Project Architecture section references this file.
- [docs/features/2026-05-16_lighthouse-ci-public-routes.md](../features/2026-05-16_lighthouse-ci-public-routes.md) — feature doc that depends on both fixtures above.

## Changelog

| Date | Change |
|---|---|
| 2026-05-16 18:48 UTC | Initial doc — captured `lh-bot` user + Lorem Ipsum demo-listing pin. |
