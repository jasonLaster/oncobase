const ALLOWED_ORIGINS_ENV = "WIKI_VITE_ALLOWED_ORIGINS";

function allowedOrigins() {
  return new Set(
    (process.env[ALLOWED_ORIGINS_ENV] ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function appendVary(headers: Headers, value: string) {
  const current = headers.get("Vary");
  if (!current) {
    headers.set("Vary", value);
    return;
  }

  const parts = new Set(current.split(",").map((part) => part.trim()).filter(Boolean));
  parts.add(value);
  headers.set("Vary", [...parts].join(", "));
}

export function wikiApiHeaders(request: Request, init: HeadersInit = {}) {
  const headers = new Headers(init);
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins().has(origin)) return headers;

  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  appendVary(headers, "Origin");
  return headers;
}

export function wikiApiOptions(request: Request) {
  const headers = wikiApiHeaders(request, {
    "Access-Control-Allow-Headers": "Accept, Content-Type, If-None-Match, x-site-slug",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  });

  if (!headers.has("Access-Control-Allow-Origin")) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, { status: 204, headers });
}
