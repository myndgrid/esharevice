// Root ESLint flat config — picked up by api / db / shared / ui via
// the lint script `eslint . --max-warnings 0`. apps/web has its own
// `eslint.config.mjs` that wraps Next's preset and inherits the same
// base rules.
//
// Why minimal: this repo wasn't actually being linted in CI for the
// past 8+ commits (ESLint 9 dropped .eslintrc support; nothing had
// been migrated). The goal of this config is "catch obvious bugs +
// be additive over time" — not "boil the ocean." Start strict on
// safety (unused-vars, no-fallthrough) and relaxed on style (allow
// console, allow any). Tighten later.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Global ignores — applied to every config block below.
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/build/**",
      "Repo/**", // legacy reference-only directory
      "**/*.config.{js,mjs,cjs,ts}", // skip config files themselves (Tailwind, Next, etc.)
    ],
  },

  // JS recommended (no-undef, no-unused-vars, etc.).
  js.configs.recommended,

  // TypeScript recommended — non-type-checked so parserOptions.project
  // isn't required. Type-checked rules can be turned on per package
  // later if we want them.
  ...tseslint.configs.recommended,

  {
    rules: {
      // We use console intentionally for operational logging (api boot,
      // background-task failures the user shouldn't see). The bug-
      // registry pattern is "warn but don't break." Linting console
      // would just produce noise.
      "no-console": "off",

      // `any` is uncommon in this codebase but does appear in a few
      // legitimate places (idempotency cache shapes, generic env
      // value transforms). Warn so they're visible without breaking.
      "@typescript-eslint/no-explicit-any": "warn",

      // Unused vars are real bugs; allow the underscore prefix for the
      // standard "intentionally unused" pattern (e.g. unused middleware
      // `next` parameter, server-action `_prev` state).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
);
