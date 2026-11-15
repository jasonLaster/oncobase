import type { ConvexHttpClient } from "convex/browser";
import { VERSIONED_PRIVATE_CACHE_CONTROL, WIKI_VERSION_HEADER } from "@oncobase/wiki-content";
import {
  DEFAULT_SITE_SLUG,
  type PasswordGateEntry,
  getRequestPasswordGateConfig,
  getSiteGate,
  hasValidAuthCookie,
  isDianaPreviewTestAuth,
} from "../reader-access";

export async function getPasswordGateConfig(
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const defaultEnabled = siteSlug === DEFAULT_SITE_SLUG;
  const site = await getSiteGate(client, siteSlug);
  return {
    enabled: site?.passwordGate ?? defaultEnabled,
    passwordHash: site?.passwordHash ?? undefined,
  };
}

export async function isPasswordGateEnabled(
  client: ConvexHttpClient,
  siteSlug: string,
) {
  return (await getPasswordGateConfig(client, siteSlug)).enabled;
}

export function passwordGateRequiredResponse() {
  return Response.json(
    { error: "Password gate authentication required" },
    {
      status: 401,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie, Host",
      },
    },
  );
}

export function passwordGateUnavailableResponse() {
  return Response.json(
    { error: "Password gate configuration is unavailable" },
    {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie, Host",
      },
    },
  );
}

export async function enforceApiPasswordGate(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  let config: PasswordGateEntry;
  try {
    config = await getRequestPasswordGateConfig(request, client, siteSlug);
  } catch (error) {
    console.warn("[wiki-vite-server] password gate lookup failed", error);
    return {
      enabled: true,
      response: passwordGateUnavailableResponse(),
    };
  }
  if (!config.enabled) return { enabled: false, response: null };
  if (
    (await hasValidAuthCookie(request, client, siteSlug, config)) ||
    isDianaPreviewTestAuth(request, siteSlug)
  ) {
    return { enabled: true, response: null };
  }
  return { enabled: true, response: passwordGateRequiredResponse() };
}

export function decorateViteHeaders(headers: HeadersInit) {
  const nextHeaders = new Headers(headers);
  const vary = nextHeaders.get("Vary");
  if (vary) {
    nextHeaders.set(
      "Vary",
      vary
        .split(",")
        .map((value: string) => (value.trim().toLowerCase() === "x-site-slug" ? "Host" : value.trim()))
        .join(", "),
    );
  }
  return nextHeaders;
}

/**
 * P11: a handler marks a response `X-Wiki-Version: match` only after it found
 * the request's `?v=` to be exactly the content this requester may read now.
 * That response alone keeps a long cache, and it is always `private`: nothing
 * from the gated site is ever `public`. Sign-out clears it (Clear-Site-Data).
 */
export function isValidatedVersionedResponse(headers: Headers) {
  return headers.get(WIKI_VERSION_HEADER) === "match";
}

export function privatePasswordGateHeaders(headers: HeadersInit) {
  const nextHeaders = decorateViteHeaders(headers);
  nextHeaders.set("Cache-Control", isValidatedVersionedResponse(nextHeaders)
    ? VERSIONED_PRIVATE_CACHE_CONTROL
    : "private, no-store");
  nextHeaders.delete("CDN-Cache-Control");
  const vary = new Set(
    (nextHeaders.get("Vary") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  vary.add("Cookie");
  vary.add("Host");
  nextHeaders.set("Vary", [...vary].join(", "));
  return nextHeaders;
}

export function privatizePasswordGatedResponse(response: Response) {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: privatePasswordGateHeaders(response.headers),
  });
}
