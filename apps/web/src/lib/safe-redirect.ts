const REDIRECT_ORIGIN = "https://wiki.invalid";

/**
 * Accept only root-relative paths that resolve on the current origin.
 *
 * The origin check also rejects backslash variants that URL parsers normalize
 * into cross-origin URLs.
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

export function safeLoginRedirect(
  value: string | null | undefined,
  rawHash = "",
) {
  const target = safeLocalRedirect(value, "");
  if (!target) return "/";
  return rawHash && !target.includes("#") ? `${target}${rawHash}` : target;
}
