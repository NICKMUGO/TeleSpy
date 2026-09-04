import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";
import noHexColorLiterals from "./eslint-rules/no-hex-color-literals.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettierConfig,
  {
    // Colors may only be defined once, in app/globals.css under @theme.
    // Everywhere in .tsx a raw color literal is a design-system violation.
    files: ["**/*.tsx"],
    plugins: { local: noHexColorLiterals },
    rules: {
      "local/no-hex-color-literals": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
