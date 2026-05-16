// Web-specific flat config. Inherits the workspace-root rules and
// layers Next.js's recommended presets on top via FlatCompat (since
// `eslint-config-next` 15.x is still in the legacy shareable-config
// format).
//
// Run via `eslint . --max-warnings 0` — replaces the deprecated
// `next lint` invocation.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import rootConfig from "../../eslint.config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  ...rootConfig,
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Next 15 auto-generates next-env.d.ts at the project root with a
    // triple-slash reference to .next/types — that's exactly the pattern
    // the Next preset's `@typescript-eslint/triple-slash-reference` rule
    // flags. Ignore the generated file (it's also gitignored, but ESLint
    // doesn't read .gitignore by default in flat config).
    ignores: ["next-env.d.ts"],
  },
];
