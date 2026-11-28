// Host detection for data.diana-tnbc.com. The HTML function imports this
// statically, so it stays free of runtime imports; the overlay itself
// (S3, sessions) loads lazily from ./entry.

export const DEFAULT_DATA_OVERLAY_ORIGIN = "https://data.diana-tnbc.com";

type Env = Record<string, string | undefined>;

function hostname(value: string) {
  return value.trim().toLowerCase().replace(/:\d+$/, "");
}

/** Hostnames served by the data overlay: DATA_OVERLAY_HOSTS (comma separated),
 * else the host of DATA_OVERLAY_ORIGIN. Outside production `data.localhost`
 * also answers, so `bun server/standalone.ts` can be exercised locally. */
export function dataOverlayHosts(env: Env = process.env) {
  const configured = (env.DATA_OVERLAY_HOSTS ?? "").split(",").map(hostname).filter(Boolean);
  if (configured.length > 0) return configured;
  let origin: string;
  try { origin = new URL(env.DATA_OVERLAY_ORIGIN?.trim() || DEFAULT_DATA_OVERLAY_ORIGIN).hostname; }
  catch { origin = new URL(DEFAULT_DATA_OVERLAY_ORIGIN).hostname; }
  return env.NODE_ENV === "production" ? [origin] : [origin, "data.localhost"];
}

export function isDataOverlayHost(host: string | null | undefined, env: Env = process.env) {
  if (!host) return false;
  return dataOverlayHosts(env).includes(hostname(host));
}

/**
 * The path the client asked for, still percent-encoded, from a raw
 * `IncomingMessage.url` or an absolute request URL. Vercel rewrites every
 * data-host path to `/api/app-shell?__path=$1`; the value is read without
 * URL normalization (which would silently resolve `..` and `%2e%2e`) so the
 * overlay can reject traversal instead of reinterpreting it. Returns null
 * when the rewrite parameter is ambiguous (repeated).
 */
export function rawRequestPath(url: string) {
  const withoutOrigin = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, "");
  const hashIndex = withoutOrigin.indexOf("#");
  const target = hashIndex === -1 ? withoutOrigin : withoutOrigin.slice(0, hashIndex);
  const queryIndex = target.indexOf("?");
  const path = queryIndex === -1 ? target : target.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : target.slice(queryIndex + 1);
  const rewritten = query.split("&").filter(pair => pair === "__path" || pair.startsWith("__path="));
  if (rewritten.length > 1) return null;
  if (rewritten.length === 1) {
    // One query-component decode yields the path as the client sent it
    // (still path-encoded). Whether or not Vercel re-encodes `$1`, every
    // check in parseDataPath runs on the fully decoded result, and the S3
    // key is built from that same string.
    try { return `/${decodeURIComponent(rewritten[0]!.slice("__path=".length))}`; }
    catch { return null; }
  }
  return path || "/";
}
