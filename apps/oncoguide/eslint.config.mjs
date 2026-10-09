import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
export default [
  { ignores: [".next/**", "out/**", ".generated/**", "next-env.d.ts", "public/**", "node_modules/**"] },
  { files: ["**/*.{ts,tsx}"], languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { "react-hooks": reactHooks }, rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" } },
];
