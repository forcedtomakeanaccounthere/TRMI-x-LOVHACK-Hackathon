import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// Used by apps/backend and packages/shared. apps/frontend has its own config.
export default defineConfig([
  globalIgnores(["**/dist/**", "**/node_modules/**", "apps/frontend/**", "apps/ai/**"]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-restricted-syntax": [
        "error",
        {
          // npx and npm are .cmd shims on Windows, which these calls can't launch without a shell.
          selector:
            "CallExpression:matches([callee.name=/^(execFile|execFileSync|spawn|spawnSync)$/], [callee.property.name=/^(execFile|execFileSync|spawn|spawnSync)$/])[arguments.0.value=/^(npx|npm)$/]",
          message: "This fails with ENOENT on Windows. Use execSync with the full command string.",
        },
      ],
    },
  },
]);
