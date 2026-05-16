# Task: `/v1/conversations` 500-cascade post-SSE deploy

**Created:** 2026-05-16 13:45 UTC
**Last Updated:** 2026-05-16 14:05 UTC
**Status:** Complete. Production `/messages` loads cleanly; Sentry quiet since the second fix landed.

## Objective

Diagnose and fix the production 500 on `GET /v1/conversations` that surfaced after the SSE phase B-1 deploy. User reported the symptom: `/messages` shows "Couldn't load messages: Internal server error (500)" and the console additionally shows CORS-blocked image loads from `cdn.esharevice.com`.

## What happened (timeline)

| UTC | Event |
|---|---|
| 09:15 | SSE deploy lands (`8164bfc`). Phase B-1 of Messages live. |
| 13:30 | First production hit on `/v1/conversations` fires `PostgresError: cannot cast type record to uuid[]`. Sentry captures it (issue 7485255298). |
| 13:34 | Second production hit on `/v1/conversations/{id}/messages` fires `TypeError: byteLength received an instance of Date`. Sentry captures it (issue 7485261028). |
| 13:36 | Both issues climb in volume (12 and 3 hits respectively). |
| 13:40 | User reports the 500 on `/messages`. |
| 13:45 | Sentry triage via the admin API key in `.env.creds`. Two distinct root causes identified. |
| ~13:50 | First fix committed (`31082b3`) + built + pushed + rolled. Container reports healthy + on `:31082b3` tag. |
| 13:52 | New Sentry issue (7485275953): `Cannot read properties of undefined (reading 'map')` at `/v1/conversations`. Realised the previous deploy was a build-cache re-tag — the fix wasn't actually live. |
| ~14:00 | Forced rebuild with `--no-cache-filter check`. New digest `2be0571b…` (the real fix). Rolled. Container picks up the fix; the cast bug stops firing. |
| ~14:01 | Discovered the cast fix made the DISTINCT-ON query run successfully for the first time, exposing the `previewRows.rows` NPE (driver-shape mismatch). |
| ~14:03 | Second fix committed (`25538aa`) + built + rolled. Container on `1f5054f4…`. |
| 14:05 | Sentry quiet; user confirms `/messages` works. R2 CORS rule set in parallel to address the separate cdn image-load CORS errors. |

## Root causes

Three distinct bugs in the SSE-deploy slice, exposed in sequence:

1. **`sql\`= ANY(${jsArray}::uuid[])\`` renders a record.** Drizzle's parameter binding serialises a JS array as a Postgres record/tuple `(v1, v2, ...)`, not an array literal. The runtime cast `record → uuid[]` then errors. Same pattern would have hit `getSaversToNotify` too if it didn't already use the `notInArray` helper.
2. **Raw `Date` in `sql\`…\`` template hits `Buffer.byteLength`.** Drizzle's typed columns convert Date → ISO string for INSERTs and SELECTs, but raw `sql` template interpolation does NOT. postgres-js falls through to `Buffer.byteLength(date)` and throws.
3. **`db.execute(sql\`…\`)` returns rows array directly under postgres-js.** I'd typed it as `{ rows: T[] }` (node-postgres' shape) and called `.rows.map(...)` — NPE when the query actually ran.

Plus one DevOps trap that prolonged the incident:

4. **`docker buildx build --push` with an unchanged effective layer set can re-tag the existing manifest instead of rebuilding.** First "fix" deploy took 3.8 s and re-pushed the pre-fix manifest under the new commit tag. Container reported healthy and on the new tag, but ran the OLD code. `--no-cache-filter <stage>` forces a real rebuild.

## Fixes

| Commit | Fix |
|---|---|
| `31082b3` | `inArray()` + `sql.join(arr.map(x => sql\`${x}::uuid\`), sql\`, \`)` for IN-lists; `.toISOString()` on every cursor `Date` (4 sites across exchange-items, saves, conversations, messages). |
| `25538aa` | Treat `db.execute(sql\`…\`)` as the rows array directly; `as unknown as Row[]` to drop the wrong envelope assumption. |

## R2 CORS (parallel concern)

Browser console showed `cdn.esharevice.com` images CORS-blocked even though they're loaded via plain `<img>` tags. Root cause: the R2 bucket had no CORS configuration, so requests that did trigger a CORS check (Sentry instrumentation, DevTools "Disable cache", future `next/image`) failed. Set a rule via `PUT /accounts/.../r2/buckets/esharevice-images/cors` allowing GET/HEAD from production + dev origins. Verified live with a preflight: `Access-Control-Allow-Origin: https://esharevice.com`.

## Bug-registry entries added

Counter 43 → 47. Four entries:
- `[Type] Drizzle sql\`= ANY(${jsArray}::uuid[])\` renders a record, not an array`
- `[Type] Raw Date in Drizzle sql\`…\` template hits postgres-js byteLength`
- `[Type] db.execute(sql\`…\`) result shape differs by driver`
- `[Build] docker buildx --push can re-tag cached manifests instead of rebuilding`

## Files Changed

- `apps/api/src/routes/v1/conversations.ts` — `inArray` + `.toISOString()` + result-shape fix.
- `apps/api/src/routes/v1/saves.ts` — `.toISOString()` on the cursor `Date`.
- `apps/api/src/routes/v1/exchange-items.ts` — `.toISOString()` on the cursor `Date`.
- R2 bucket CORS rule (external, no repo change).

## Follow-ups still owed

- **Vitest integration test for `/v1/conversations`.** The two existing tests cover sharp-pipeline + idempotency + reserve-race; conversations has zero coverage. CI already brings up Postgres for the reserve-race test, so the same harness can host a conversations test that exercises the inArray + cursor paths.
- Consider asserting in CI that `docker buildx --push` actually produced new layers when the source changed — could grep the build log for "DONE" timings under 10 s + alert.

## Outcome

`/v1/conversations` + `/v1/conversations/{id}/messages` cleanly return 200 for authenticated requests. Sentry has no new error instances since `25538aa` deployed. `/messages` works in production. R2 CORS allows the home page + saved-page images to load cross-origin even when the browser does enforce CORS. Four bug-registry entries codify the gotchas so the next maintainer doesn't repeat them.
