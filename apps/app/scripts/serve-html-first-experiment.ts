/** Loopback-only, read-only harness. Never deploy this script. */
import { resolve } from "node:path";

export async function startHtmlFirstExperiment(port = 0) {
  process.env.NODE_ENV = "development";
  process.env.WIKI_SITE_SLUG = "diana";
  process.env.WIKI_GATE_SESSION_SECRET = crypto.randomUUID();
  delete process.env.WIKI_PREFETCH_SECRET;
  process.env.WIKI_BACKEND_TRACING = "0";
  const { createClient, getPasswordGateConfig, authedCookieName } = await import("../server/wiki-api");
  const { createWikiViteHandler } = await import("../server/app-shell");
  const { createWikiGateSession } = await import("@oncobase/wiki-content/gate-session");
  const client = createClient();
  const config = await getPasswordGateConfig(client, "diana");
  const token = await createWikiGateSession({ siteSlug: "diana", secret: process.env.WIKI_GATE_SESSION_SECRET,
    gateVersion: JSON.stringify([config.enabled, config.passwordHash ?? process.env.DIANA_WIKI_PASSWORD_HASH ?? "passwordless"]) });
  const cookieName = authedCookieName("diana");
  const handler = createWikiViteHandler({ client, distDir: resolve(import.meta.dir, "../dist"), htmlFirstExperiment: true });
  const server = Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 60, async fetch(request) {
    // Issue a synthetic gate session to this loopback browser only. This route
    // exists solely in the local experiment, never in the deployed app handler.
    if (new URL(request.url).pathname === "/__experiment/start") {
      return new Response(null, { status: 302, headers: {
        Location: "/", "Cache-Control": "private, no-store",
        "Set-Cookie": `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax`,
      } });
    }
    return handler(request);
  } });
  return { server, origin: `http://127.0.0.1:${server.port}`, cookieName, token };
}

if (import.meta.main) {
  const { origin } = await startHtmlFirstExperiment(Number(process.env.PORT ?? 62009));
  console.log(`HTML-first experiment: ${origin}/__experiment/start`);
}
