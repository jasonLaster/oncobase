import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import { isOncobaseHost, siteOrigin } from "../src/site-host";

/** The cookies the production gate treats as a signed-in browser. */
const SIGNED_IN_COOKIE = /(?:^|;\s*)(?:authed(?:_[\w-]+)?|wiki_user_session)=/;

/**
 * Dev only; the Vite dev server has no gate or host routing, so mirror production here.
 *
 * - Production shows signed-out visitors the landing page at "/" by marking the HTML response. A
 *   signed-in cookie, `?token`, `?reader`, or a Playwright test run (x-wiki-test-run) keeps showing
 *   the reader.
 * - oncobase.io is a separate marketing site. Open it locally at http://oncobase.localhost:<port>/ (browsers
 *   send *.localhost to the loopback address): its pages get a `wiki-site` marker, and it has no API.
 * - On Diana's site /features and /compare moved to oncobase.io, so redirect them there.
 */
export function devLandingPlugin(): Plugin {
  return {
    name: "oncobase-dev-landing",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== "GET" && request.method !== "HEAD") return next();
        const url = new URL(request.url ?? "/", "http://localhost");
        const host = String(request.headers.host ?? "");
        const accepts = String(request.headers.accept ?? "").includes("text/html");
        if (isOncobaseHost(host)) {
          if (url.pathname.startsWith("/api/")) {
            response.statusCode = 404;
            return response.end("Not found");
          }
          // Page requests only; scripts, styles, and images fall through to Vite.
          if (!accepts || /\.[a-z0-9]+$/i.test(url.pathname) || /^\/(@|src\/|node_modules\/)/.test(url.pathname)) return next();
          try {
            const html = await readFile(path.join(server.config.root, "index.html"), "utf8");
            const transformed = await server.transformIndexHtml(request.url ?? "/", html);
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.setHeader("Cache-Control", "no-store");
            return response.end(
              transformed.replace(
                "</head>",
                '<meta name="wiki-site" content="oncobase" /><meta name="wiki-reader-access" content="public" /></head>',
              ),
            );
          } catch (error) {
            return next(error);
          }
        }
        if (url.pathname === "/features" || url.pathname === "/compare") {
          const [hostname, port = ""] = host.split(":");
          const origin = siteOrigin("oncobase", { protocol: "http:", hostname: hostname ?? "localhost", port });
          response.statusCode = 301;
          response.setHeader("Location", `${origin}${url.pathname}${url.search}`);
          return response.end();
        }
        if (url.pathname !== "/") return next();
        if (url.searchParams.has("token") || url.searchParams.has("reader")) return next();
        if (!String(request.headers.accept ?? "").includes("text/html")) return next();
        if (request.headers["x-wiki-test-run"]) return next();
        if (SIGNED_IN_COOKIE.test(request.headers.cookie ?? "")) return next();
        try {
          const html = await readFile(path.join(server.config.root, "index.html"), "utf8");
          const transformed = await server.transformIndexHtml(request.url ?? "/", html);
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(transformed.replace("</head>", '<meta name="wiki-reader-access" content="landing" /></head>'));
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
