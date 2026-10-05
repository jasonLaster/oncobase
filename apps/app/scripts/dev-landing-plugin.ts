import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

/** The cookies the production gate treats as a signed-in browser. */
const SIGNED_IN_COOKIE = /(?:^|;\s*)(?:authed(?:_[\w-]+)?|wiki_user_session)=/;

/**
 * Dev only. Production shows signed-out visitors the landing page at "/" by
 * marking the HTML response; the Vite dev server has no gate, so mirror that
 * here. A signed-in cookie, `?token`, `?reader`, or a Playwright test run
 * (x-wiki-test-run) keeps showing the reader.
 */
export function devLandingPlugin(): Plugin {
  return {
    name: "oncobase-dev-landing",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== "GET" && request.method !== "HEAD") return next();
        const url = new URL(request.url ?? "/", "http://localhost");
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
