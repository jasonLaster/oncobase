export const PLACEHOLDER_CONVEX_URL = "https://placeholder.convex.cloud";
export const PROD_CONVEX_FALLBACK_URL = "https://youthful-cricket-560.convex.cloud";

export function isPlaceholderConvexUrl(url: string | undefined): boolean {
  return url === PLACEHOLDER_CONVEX_URL;
}

export function resolveServerConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (url && !isPlaceholderConvexUrl(url)) {
    return url;
  }

  // Vercel previews should read production Convex. Some preview/static
  // environments carry the placeholder value used by CI compile checks;
  // never let that placeholder reach the deployed server runtime.
  if (process.env.VERCEL === "1") {
    return PROD_CONVEX_FALLBACK_URL;
  }

  return isPlaceholderConvexUrl(url) ? "" : (url ?? "");
}

export function shouldSkipConvexReads(): boolean {
  return !resolveServerConvexUrl();
}
