import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Multi-tenant guardrails. These rules start as warnings while Phase 2
// threads `requireSite` through every public Convex function, then
// flip to `error` once the function surface is fully scoped. The
// allowlists name the modules that own the helpers themselves.

const RAW_DB_QUERY_MESSAGE =
  "Direct ctx.db.query is reserved for the requireSite helper " +
  "(convex/lib/site.ts) and operator scripts. Public Convex " +
  "functions must derive siteId via requireSite(ctx) and filter " +
  "by it.";

const RAW_BLOB_IMPORT_MESSAGE =
  "Import from src/lib/blob.ts. Direct put/del from @vercel/blob " +
  "skips the sites/<siteSlug>/ key prefix and creates a cross-site " +
  "leak surface.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".claude/**",
    "convex/_generated/**",
    "src/app/.well-known/workflow/v1/flow/**",
    // Old Claude session worktrees keep their own copies of the source
    // tree; ESLint should not descend into them.
    ".claude/**",
  ]),
  {
    files: ["convex/**/*.ts"],
    ignores: [
      "convex/_generated/**",
      "convex/lib/site.ts",
      // sites.ts is the resolution + onboarding layer that owns
      // direct sites-table access. requireSite uses it.
      "convex/sites.ts",
      "convex/migrations.ts",
      "convex/admin/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "CallExpression[callee.property.name='query'][callee.object.property.name='db']",
          message: RAW_DB_QUERY_MESSAGE,
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    ignores: ["src/lib/blob.ts", "scripts/publish/**", "scripts/ingest-*.ts", "scripts/build-*.ts", "scripts/admin/**"],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          paths: [
            {
              name: "@vercel/blob",
              message: RAW_BLOB_IMPORT_MESSAGE,
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
