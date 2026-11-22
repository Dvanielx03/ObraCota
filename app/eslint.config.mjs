import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

/** jsx-a11y's recommended rules, reported as warnings so they are visible without blocking the build. */
const a11yWarnings = Object.fromEntries(Object.keys(jsxA11y.flatConfigs.recommended.rules).map(rule => [rule, "warn"]));

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Hooks rules block: a broken hook order or a stale dependency is a bug, not a style choice.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // These four only matter for the React Compiler, which this app does not enable; the patterns
      // they flag (state set in an effect, refs read while rendering) are valid React. Kept visible.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      ...a11yWarnings,
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/**", "test-results*/**", "scratch-shots/**", "playwright-report/**"]),
]);
