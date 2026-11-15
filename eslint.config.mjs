// One flat config for every workspace. Each workspace's `lint` script runs
// scripts/lint-ratchet.ts, which lints the workspace with this file.
//
// Severity policy: a rule that was clean when it was added is an error. A rule
// with a backlog is listed in RATCHETED and reports warnings; lint-ratchet.ts
// fails when a workspace has more warnings for a rule than its checked-in
// eslint-baseline.json allows (no entry means zero), and when the baseline is
// higher than the real count, so the backlog can only shrink. Fixing warnings?
// Run `bun run lint:baseline` in that workspace and commit the new baseline.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

const RATCHETED = new Set([
  "react-hooks/exhaustive-deps",
  "react-hooks/set-state-in-effect",
  "@typescript-eslint/no-floating-promises",
  "jsx-a11y/alt-text",
  "jsx-a11y/anchor-has-content",
  "jsx-a11y/click-events-have-key-events",
  "jsx-a11y/heading-has-content",
  "jsx-a11y/iframe-has-title",
  "jsx-a11y/interactive-supports-focus",
  "jsx-a11y/label-has-associated-control",
  "jsx-a11y/no-autofocus",
  "jsx-a11y/no-noninteractive-element-interactions",
  "jsx-a11y/no-noninteractive-element-to-interactive-role",
  "jsx-a11y/no-noninteractive-tabindex",
  "jsx-a11y/no-static-element-interactions",
  "jsx-a11y/role-supports-aria-props",
]);

/** Error unless the rule is ratcheted; keeps rule options and "off". */
function level(rule, value = "error") {
  const [severity, ...options] = Array.isArray(value) ? value : [value];
  if (severity === "off" || severity === 0) return "off";
  return [RATCHETED.has(rule) ? "warn" : "error", ...options];
}
function levels(rules) {
  return Object.fromEntries(Object.entries(rules).map(([rule, value]) => [rule, level(rule, value)]));
}

const TS = ["**/*.{ts,tsx,mts,cts}"];
// Playwright specs, fixtures and configs: not React (fixtures call `use()`).
const PLAYWRIGHT = ["**/e2e/**", "**/deployed-e2e/**", "**/playwright*.ts"];
const TESTS = ["**/*.test.{ts,tsx}", ...PLAYWRIGHT];

const appImport = "Packages are shared by both apps and must never import from an app.";
const storageMessage =
  "Raw Web Storage throws when storage is blocked or disabled and crashes the reader. Use safeLocalStorage / safeSessionStorage from @oncobase/safe-storage instead.";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/.vercel/**",
      "**/.vercel-functions/**",
      "**/.playwright/**",
      "**/.local/**",
      "**/.next/**",
      "**/out/**",
      "**/.generated/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/next-env.d.ts",
      "apps/*/public/**",
      "apps/app/convex/_generated/**",
    ],
  },
  // Unused disable directives are ratcheted too (lint-ratchet.ts counts them as "unused-disable-directive").
  { linterOptions: { reportUnusedDisableDirectives: "warn" } },
  {
    files: TS,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tseslint.plugin, "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      ...levels({ "@typescript-eslint/no-floating-promises": "error" }),
      ...levels(jsxA11y.flatConfigs.recommended.rules),
    },
  },
  {
    files: TS,
    ignores: PLAYWRIGHT,
    rules: levels({
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/set-state-in-effect": "error",
    }),
  },
  // apps/app/tsconfig.json leaves Convex out; see apps/app/tsconfig.convex.json.
  {
    files: ["apps/app/convex/**/*.ts"],
    languageOptions: { parserOptions: { projectService: false, project: ["./apps/app/tsconfig.convex.json"] } },
  },

  // Import boundaries.
  {
    files: ["packages/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          { name: "@oncobase/app", message: appImport },
          { name: "@oncobase/oncoguide", message: appImport },
        ],
        patterns: [{ regex: "(^|/)apps/", message: appImport }],
      }],
    },
  },
  {
    // shared/ is imported by the browser bundle, the Node server and Convex.
    files: ["apps/app/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{
        regex: "^\\.\\./(?:\\.\\./)*(src|server|convex|scripts|e2e)(/|$)",
        message: "apps/app/shared must stay dependency-free: browser, server and Convex all import it.",
      }] }],
    },
  },
  {
    // Convex functions run in Convex's runtime, not in the Node server or browser.
    files: ["apps/app/convex/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: [{
        regex: "^\\.\\./(?:\\.\\./)*(src|server|scripts|e2e)(/|$)",
        message: "Convex functions must not import the browser app or the Node server.",
        allowTypeImports: true,
      }] }],
    },
  },
  {
    // The browser bundle may use server types, and only Convex's generated client.
    files: ["apps/app/src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: [
        {
          regex: "^\\.\\./(?:\\.\\./)*(server|scripts|e2e)(/|$)",
          message: "The browser bundle must not import Node server code (type-only imports are fine).",
          allowTypeImports: true,
        },
        {
          regex: "^\\.\\./(?:\\.\\./)*convex/(?!_generated/)",
          message: "The browser bundle may import only convex/_generated from Convex.",
          allowTypeImports: true,
        },
      ] }],
    },
  },

  // Raw Web Storage, everywhere but the helper. Reading `window.localStorage`
  // can itself throw, so even a typeof check or a property read is forbidden.
  // apps/*/scripts only touch storage inside Playwright page.evaluate callbacks.
  {
    files: TS,
    ignores: [...TESTS, "apps/*/scripts/**", "packages/safe-storage/src/index.ts"],
    rules: {
      "no-restricted-globals": ["error",
        { name: "localStorage", message: storageMessage },
        { name: "sessionStorage", message: storageMessage },
      ],
      "no-restricted-properties": ["error",
        ...["window", "globalThis", "self"].flatMap(object =>
          ["localStorage", "sessionStorage"].map(property => ({ object, property, message: storageMessage }))),
      ],
    },
  },

  // apps/app tenant boundaries, moved unchanged from apps/app/eslint.config.mjs.
  {
    files: ["apps/app/convex/**/*.ts"],
    ignores: ["apps/app/convex/lib/site.ts", "apps/app/convex/lib/documentMeta.ts", "apps/app/convex/documentMeta.ts", "apps/app/convex/sites.ts", "apps/app/convex/migrations.ts", "apps/app/convex/commentRooms.ts", "apps/app/convex/conversations.ts", "apps/app/convex/documents.ts", "apps/app/convex/guestNames.ts", "apps/app/convex/users.ts", "apps/app/convex/admin/**"],
    rules: { "no-restricted-syntax": ["error", {
      selector: "CallExpression[callee.property.name='query'][callee.object.property.name='db']",
      message: "Resolve the site with requireSite and scope public Convex access by siteId.",
    }] },
  },
  {
    files: ["apps/app/src/**/*.{ts,tsx}", "apps/app/scripts/**/*.ts"],
    ignores: ["apps/app/scripts/publish/**", "apps/app/scripts/ingest-*.ts", "apps/app/scripts/build-*.ts", "apps/app/scripts/admin/**"],
    rules: { "no-restricted-imports": ["error", { paths: [{
      name: "@vercel/blob",
      message: "Use server/blob.ts so writes retain the sites/<siteSlug>/ prefix.",
    }] }] },
  },
];
