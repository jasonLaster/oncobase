// URL scheme of data.diana-tnbc.com and the only place a URL becomes an S3 key.
//
//   /                    index (HTML, or JSON with Accept: application/json)
//   /index.json          index as JSON
//   /_auth/signin        start the diana-tnbc.com sign-in handoff
//   /_auth/callback      finish it (exchanges the handoff token for a cookie)
//   /_auth/signout       POST: end the data-host session
//   /private/<path>      key private/<path> (role checked)
//   /<path>              key public/<path> (everything else)
//
// Paths are validated before they are classified: no `..` or `.` segments,
// no empty segments (so no `//` or trailing `/`), no backslashes, control
// characters or NUL, no percent-encoded separators or dots, and no `%` left
// after the single decode (double encoding). Classification and the key are
// both derived from the same decoded segments, and the key is re-checked to
// sit strictly under its prefix.

import { PRIVATE_PREFIX, PUBLIC_PREFIX } from "./prefix-roles";

export type DataRoute =
  | { kind: "index" }
  | { kind: "index-json" }
  | { kind: "auth"; action: "signin" | "callback" | "signout" }
  | { kind: "private-root" }
  | { kind: "object"; visibility: "public" | "private"; key: string }
  | { kind: "invalid" };

/** S3 keys are at most 1024 bytes. */
const MAX_KEY_BYTES = 1024;
const ENCODED_FORBIDDEN = /%(?:2e|2f|5c|25|00)/i;
const DECODED_FORBIDDEN = /[\u0000-\u001f\u007f\\%]/;
const AUTH_ACTIONS = new Set(["signin", "callback", "signout"]);
/** First segments that never name a public object. */
export const RESERVED_FIRST_SEGMENTS = new Set(["private", "_auth"]);

export class UnsafeKeyError extends Error {
  constructor(key: string, prefix: string) {
    super(`Key ${JSON.stringify(key)} is not strictly under ${prefix}`);
    this.name = "UnsafeKeyError";
  }
}

/** Segments of a decoded relative path, or null when any segment is unsafe. */
export function safeSegments(decoded: string) {
  if (!decoded || DECODED_FORBIDDEN.test(decoded)) return null;
  const segments = decoded.split("/");
  if (segments.some(segment => segment === "" || segment === "." || segment === "..")) return null;
  return segments;
}

/** Throws unless `key` is `prefix` followed by one or more safe segments. */
export function assertKeyUnderPrefix(key: string, prefix: string) {
  if (!prefix.endsWith("/") || !key.startsWith(prefix) || !safeSegments(key.slice(prefix.length))) {
    throw new UnsafeKeyError(key, prefix);
  }
  if (new TextEncoder().encode(key).length > MAX_KEY_BYTES) throw new UnsafeKeyError(key, prefix);
  return key;
}

function keyFor(prefix: string, segments: string[]) {
  try { return assertKeyUnderPrefix(`${prefix}${segments.join("/")}`, prefix); }
  catch { return null; }
}

/** Classify a client path (percent-encoded, starting with "/"). */
export function parseDataPath(rawPath: string | null | undefined): DataRoute {
  if (rawPath === "/") return { kind: "index" };
  if (!rawPath || !rawPath.startsWith("/") || ENCODED_FORBIDDEN.test(rawPath)) return { kind: "invalid" };
  let decoded: string;
  try { decoded = decodeURIComponent(rawPath.slice(1)); }
  catch { return { kind: "invalid" }; }
  const segments = safeSegments(decoded);
  if (!segments) return { kind: "invalid" };

  if (segments.length === 1 && segments[0] === "index.json") return { kind: "index-json" };
  if (segments[0] === "_auth") {
    return segments.length === 2 && AUTH_ACTIONS.has(segments[1]!)
      ? { kind: "auth", action: segments[1] as "signin" | "callback" | "signout" }
      : { kind: "invalid" };
  }
  if (segments[0] === "private") {
    if (segments.length === 1) return { kind: "private-root" };
    const key = keyFor(PRIVATE_PREFIX, segments.slice(1));
    return key ? { kind: "object", visibility: "private", key } : { kind: "invalid" };
  }
  const key = keyFor(PUBLIC_PREFIX, segments);
  return key ? { kind: "object", visibility: "public", key } : { kind: "invalid" };
}

/** The data-host URL path for a key, or null when no URL can reach it. */
export function urlPathForKey(key: string) {
  let segments: string[] | null;
  if (key.startsWith(PRIVATE_PREFIX)) {
    segments = safeSegments(key.slice(PRIVATE_PREFIX.length));
    if (segments) segments = ["private", ...segments];
  } else if (key.startsWith(PUBLIC_PREFIX)) {
    segments = safeSegments(key.slice(PUBLIC_PREFIX.length));
    // public/private/... and public/_auth/... are shadowed by the scheme.
    if (segments && (RESERVED_FIRST_SEGMENTS.has(segments[0]!) || (segments.length === 1 && segments[0] === "index.json"))) segments = null;
  } else {
    segments = null;
  }
  if (!segments) return null;
  const path = `/${segments.map(encodeURIComponent).join("/")}`;
  const route = parseDataPath(path);
  return route.kind === "object" && route.key === key ? path : null;
}

/** A post-sign-in destination on the data host; anything else becomes "/". */
export function safeDataNext(value: string | null | undefined) {
  if (!value) return "/";
  const route = parseDataPath(value);
  return route.kind === "object" || route.kind === "private-root" || route.kind === "index" || route.kind === "index-json"
    ? value
    : "/";
}
