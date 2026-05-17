-- 0006_0001 — Nullable password_hash column on users for the Auth.js
-- Credentials provider.
--
-- Why nullable: every user who signed in via Authentik (Google OAuth, magic
-- link, future Apple Sign-In) does NOT have a password. Setting NOT NULL
-- with a placeholder would let anyone authenticate with that placeholder.
-- The Auth.js Credentials handler enforces `password_hash IS NOT NULL` at
-- query time before checking bcrypt.compare(); rows without a hash fall
-- through to "no such user" so the social-only path stays password-less.
--
-- Format: bcrypt cost-12+ output (60 chars beginning with `$2a$` / `$2b$`).
-- Generated server-side via `bcrypt.hash(password, 12)` — never trust the
-- client to hash. The column is text, not citext: hash comparison is
-- case-sensitive by definition.
--
-- This is part of the Authentik → Auth.js migration (see
-- tasks/2026-05-16_premium-marketplace-redesign-plan.md §Backend Systems —
-- Authentication). The column ships standalone in PR 1a as additive schema;
-- the Auth.js Credentials wire-up follows in PR 1b. Until the Credentials
-- provider is wired, every row stays NULL and the column is a no-op.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "password_hash" text;
