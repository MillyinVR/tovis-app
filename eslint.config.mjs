import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Generated / local tool output:
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "blob-report/**",
    "artifacts/**",
    // Local Claude sibling worktrees are already gitignored and may contain
    // their own generated .next trees; never lint across checkout boundaries.
    ".claude/**",
  ]),
]);

export default eslintConfig;
