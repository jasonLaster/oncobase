import { expect, test } from "bun:test";
import { API_ROUTES, EDUCATION_API_ALIASES, PUBLISH_API_ROUTES, RAW_API_ROUTES, TRACED_API_ROUTES, matchApiRoute, matchRawApiRoute } from "./api-routes";

// The route list before the table existed, kept literally so any change to
// claimed paths, gate exemptions or traced names is a reviewed test change.
const CLAIMED_EXACT = [
  "/api/login", "/api/auth/session", "/api/auth/signin", "/api/auth/signup", "/api/auth/signout",
  "/api/ai-search", "/api/chat", "/api/search", "/api/timeline", "/api/diagnostic-studies", "/api/share-preview",
  "/api/dicom/file", "/api/dicom/studies", "/api/dicom/series", "/api/dicom/annotations", "/api/dicom/comparisons",
  "/api/test/diagnostic-studies", "/api/test/dicom-comparisons", "/api/tools",
  "/api/liveblocks-auth", "/api/liveblocks-threads", "/api/liveblocks-add-comment", "/api/liveblocks-delete-thread",
  "/api/liveblocks-users", "/api/liveblocks-guest", "/api/liveblocks-webhook",
  "/api/download", "/api/file", "/api/page-copy",
  "/api/integrations/epic/authorize", "/api/integrations/epic/callback", "/api/integrations/epic/sync",
];
const CLAIMED_PREFIXES = ["/api/wiki/", "/api/admin/", "/api/publish/", "/api/pathology/", "/api/dicom/comparisons/"];

function wasGateExempt(pathname: string) {
  return pathname === "/api/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/admin/") ||
    pathname.startsWith("/api/publish/") ||
    pathname === "/api/wiki/session" ||
    pathname === "/api/share-preview" ||
    pathname === "/api/liveblocks-webhook" ||
    pathname.startsWith("/api/integrations/epic/");
}

test("the table claims exactly the previously handled paths", () => {
  for (const path of CLAIMED_EXACT) expect(matchApiRoute(path)?.path ?? null).toBe(path);
  for (const prefix of CLAIMED_PREFIXES) expect(matchApiRoute(`${prefix}anything/else`)).not.toBeNull();
  for (const path of ["/api", "/api/", "/api/auth/other", "/api/integrations/epic/other", "/api/dicom/other", "/api/filex", "/api/education/manifest", "/api/telemetry/other"]) {
    expect(matchApiRoute(path)).toBeNull();
  }
  expect(matchApiRoute("/api/wiki/unknown")?.load).toBeUndefined();
  expect(matchApiRoute("/api/wiki/session")?.path).toBe("/api/wiki/session");
  expect(matchRawApiRoute("/api/wiki/telemetry")?.path).toBe("/api/wiki/telemetry");
  expect(matchRawApiRoute("/api/telemetry/manifest")?.path).toBe("/api/telemetry/manifest");
  expect(new Set(API_ROUTES.map(route => route.path ?? route.prefix)).size).toBe(API_ROUTES.length);
});

test("gate rules match the previous exemption list", () => {
  const samples = [...CLAIMED_EXACT, "/api/wiki/session", "/api/wiki/manifest", "/api/wiki/pages", "/api/wiki/prefetch",
    "/api/wiki/convex-token", "/api/wiki/unknown", "/api/admin/session", "/api/admin/pii/x", "/api/publish/begin", "/api/pathology/slides", "/api/dicom/comparisons/a"];
  for (const path of samples) {
    const route = matchApiRoute(path)!;
    const gatedOnDefault = route.gate !== "exempt";
    const gatedElsewhere = route.gate === "required";
    // Previously: gated unless exempt, and /api/wiki/session gated on the default site only.
    expect(gatedElsewhere).toBe(!wasGateExempt(path));
    expect(gatedOnDefault).toBe(!wasGateExempt(path) || path === "/api/wiki/session");
  }
});

test("education fallback covers only the public reader reads", () => {
  const url = (path: string) => new URL(`https://wiki.test${path}`);
  const eligible = (path: string) => Boolean(matchApiRoute(url(path).pathname)?.educationRead?.(url(path)));
  for (const path of ["/api/wiki/session", "/api/wiki/manifest", "/api/wiki/pages", "/api/wiki/prefetch", "/api/search"]) expect(eligible(path)).toBe(true);
  expect(eligible("/api/wiki/pages?slugs=")).toBe(true);
  expect(eligible("/api/wiki/pages?slugs=wiki/education/a,wiki/education/b")).toBe(true);
  expect(eligible("/api/wiki/pages?slugs=wiki/education/a,private")).toBe(false);
  expect(eligible("/api/file?path=wiki/education/a.png")).toBe(true);
  expect(eligible("/api/file?path=private.png")).toBe(false);
  expect(eligible("/api/file")).toBe(false);
  expect(eligible("/api/page-copy?slug=wiki/education/a")).toBe(true);
  expect(eligible("/api/page-copy?slug=private")).toBe(false);
  for (const path of ["/api/download", "/api/tools", "/api/chat", "/api/wiki/convex-token", "/api/wiki/unknown"]) expect(eligible(path)).toBe(false);
  for (const target of Object.values(EDUCATION_API_ALIASES)) expect(matchApiRoute(target)?.educationRead).toBeDefined();
});

test("privatized responses are the four previously wrapped routes", () => {
  expect(API_ROUTES.filter(route => route.privatize).map(route => route.path).sort()).toEqual(["/api/download", "/api/file", "/api/page-copy", "/api/search"]);
});

test("tracing names only fixed route strings", () => {
  expect([...TRACED_API_ROUTES].sort()).toEqual([
    "/api/admin/access", "/api/admin/roles", "/api/admin/session", "/api/admin/users", "/api/admin/users/role",
    ...CLAIMED_EXACT, "/api/wiki/manifest", "/api/wiki/pages", "/api/wiki/prefetch", "/api/wiki/session", "/api/wiki/convex-token",
    ...RAW_API_ROUTES.map(route => route.path), ...PUBLISH_API_ROUTES,
  ].sort());
  for (const name of TRACED_API_ROUTES) expect(name).toMatch(/^\/api\/[a-z0-9/-]+$/);
});

test("every route loader resolves to a handler", async () => {
  for (const route of [...API_ROUTES, ...RAW_API_ROUTES]) {
    if (route.load) expect(typeof await route.load()).toBe("function");
  }
});
