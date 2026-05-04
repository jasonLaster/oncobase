export const PLACEHOLDER_CONVEX_URL = "https://placeholder.convex.cloud";
export const PROD_CONVEX_FALLBACK_URL = "https://youthful-cricket-560.convex.cloud";
const DISABLE_PROD_CONVEX_FALLBACK = "0";

export function isPlaceholderConvexUrl(url: string | undefined): boolean {
  return url === PLACEHOLDER_CONVEX_URL;
}

function configuredConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  return url && !isPlaceholderConvexUrl(url) ? url : "";
}

function prodConvexFallbackEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_PROD_CONVEX !== DISABLE_PROD_CONVEX_FALLBACK;
}

export function resolvePublicConvexUrl(): string {
  return configuredConvexUrl() || (prodConvexFallbackEnabled() ? PROD_CONVEX_FALLBACK_URL : "");
}

export function resolveServerConvexUrl(): string {
  return resolvePublicConvexUrl();
}

export function shouldSkipConvexReads(): boolean {
  return !resolveServerConvexUrl();
}
