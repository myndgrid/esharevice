# Why `node-linker=hoisted`?

**Last Updated:** 2026-05-13 01:00 UTC

The `.npmrc` at the repo root sets:

```ini
node-linker=hoisted
```

This switches pnpm from its default **isolated** linking (where each package gets a strict `node_modules/.pnpm/...` symlink tree) to **hoisted** linking (npm-style flat `node_modules/`).

## Why

Several TypeScript type packages declare transitive types via `///<reference types="...">` directives. With pnpm's default isolated layout, these references can't reliably resolve from consumer code because the transitive `@types/*` packages live deep inside `.pnpm/<pkg>/node_modules/@types/` — TypeScript's standard auto-discovery walks `node_modules/@types/` only.

This bit us hard during the Express attempt (now in the bug registry as `[Build] @types/express + pnpm Isolated Linking + TS Bundler Resolution = Broken Type Inference`). Hoisted linking puts every `@types/*` in `node_modules/@types/` at the workspace root where TypeScript finds them with zero gymnastics.

## What we lose

Strict per-package dependency enforcement. With isolated, importing a package you didn't declare as a dep is a runtime error. With hoisted, it might "just work" because the package is in the flat tree — making accidental phantom deps possible.

We accept this trade. For a small monorepo with one engineer working across packages, the type-resolution win is worth more than the phantom-dep discipline. ESLint's `import/no-extraneous-dependencies` rule catches the most common cases anyway.

## Don't remove this

If you're tempted to delete `.npmrc`, read the full bug-registry entry first. Removing it will appear to work locally (cached) but breaks fresh installs and CI.

## When to revisit

- If we add a publishing pipeline (the monorepo packages become npm-published, not workspace-only) — phantom deps become a real shipping risk.
- If the ecosystem evolves and `@types/express`-style packages stop using `///<reference>` directives in favour of explicit `import` statements (slow but happening).
- If pnpm adds a "hoisted-types-only" mode (proposed but not yet merged upstream).
