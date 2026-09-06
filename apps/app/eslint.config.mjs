import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Preserve the tenant-boundary guardrails independently of Next's ESLint preset.
export default [
  { ignores: ["node_modules/**", "dist/**", ".vercel/**", "convex/_generated/**", "playwright-report/**", "test-results/**"] },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { "@typescript-eslint": tseslint.plugin, "react-hooks": reactHooks },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn", "react-hooks/set-state-in-effect": "warn" },
  },
  {
    files: ["convex/**/*.ts"],
    ignores: ["convex/lib/site.ts", "convex/sites.ts", "convex/migrations.ts", "convex/commentRooms.ts", "convex/conversations.ts", "convex/documents.ts", "convex/guestNames.ts", "convex/users.ts", "convex/admin/**"],
    rules: { "no-restricted-syntax": ["error", {
      selector: "CallExpression[callee.property.name='query'][callee.object.property.name='db']",
      message: "Resolve the site with requireSite and scope public Convex access by siteId.",
    }] },
  },
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    ignores: ["scripts/publish/**", "scripts/ingest-*.ts", "scripts/build-*.ts", "scripts/admin/**"],
    rules: { "no-restricted-imports": ["error", { paths: [{
      name: "@vercel/blob",
      message: "Use server/blob.ts so writes retain the sites/<siteSlug>/ prefix.",
    }] }] },
  },
];
