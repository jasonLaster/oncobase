const REDIRECT_ORIGIN = "https://wiki.invalid";

/**
 * Accept only root-relative paths that resolve on the current origin.
 *
 * Checking the resolved origin in addition to the leading slash rejects
 * protocol-relative targets (`//evil.example`) and backslash variants that
 * URL parsers normalize into cross-origin URLs.
 */
export function safeLocalRedirect(
  value: string | null | undefined,
  fallback = "/",
) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  try {
    const target = new URL(value, REDIRECT_ORIGIN);
    if (target.origin !== REDIRECT_ORIGIN) {
      return fallback;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
