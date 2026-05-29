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

const TENANT_API_MESSAGE =
  "Use src/lib/site-data.ts for tenant-owned Convex tables. The " +
  "SiteData interface injects siteSlug and makes raw siteSlug " +
  "threading harder to forget.";

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
      // requireSite + sites resolution own direct sites/* table access.
      "convex/lib/site.ts",
      "convex/sites.ts",
      // Schema-level migrations that intentionally page through every
      // table. Keep direct queries here behind a clearly named module.
      "convex/migrations.ts",
      // Tenant data files keep their *internal* helper queries (paginate,
      // by-id lookups, legacy fallbacks) using ctx.db.query — every
      // public function still calls requireSite at the boundary. The
      // exemption is narrow: the rule still fires on any new module
      // added to convex/ that hasn't been wired to requireSite.
      "convex/commentRooms.ts",
      "convex/conversations.ts",
      "convex/documents.ts",
      "convex/guestNames.ts",
      "convex/users.ts",
      "convex/admin/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
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
        "error",
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
  {
    files: ["src/app/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    ignores: [
      // SiteData is the only file allowed to reference tenant-scoped
      // `api.documents`/`api.users`/etc. directly.
      "src/lib/site-data.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.name='api'][property.name=/^(documents|users|guestNames|commentRooms|conversations)$/]",
          message: TENANT_API_MESSAGE,
        },
      ],
    },
  },
]);

export default eslintConfig;
