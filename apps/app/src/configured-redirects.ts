import redirects from "../redirects.json";

// The server imports this table directly. The reader loads this module after
// paint (CanonicalRouteBoundary). It imports nothing the reader shares, so the
// lazy chunk does not split shared helpers into new eager chunks.

function safeDecodePathname(pathname: string) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export type RedirectEntry = {
  source: string;
  destination: string;
  permanent?: boolean;
  exclude?: string[];
};

export function matchConfiguredRedirect(
  pathname: string,
  entry: RedirectEntry,
) {
  const normalizedPath = safeDecodePathname(pathname)
    .replace(/\.(?:md|mdx)$/i, "")
    .replace(/\/+$/, "");
  if (entry.exclude?.some((prefix) =>
    normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
  )) return null;

  if (!entry.source.includes(":path*")) {
    return pathname === entry.source ? entry.destination : null;
  }

  const sourcePrefix = entry.source.slice(0, entry.source.indexOf(":path*"));
  if (!pathname.startsWith(sourcePrefix)) return null;
  const rest = pathname.slice(sourcePrefix.length);
  return entry.destination.replace(":path*", rest);
}

export function configuredRedirect(pathname: string) {
  for (const entry of redirects as RedirectEntry[]) {
    const destination = matchConfiguredRedirect(pathname, entry);
    if (destination) return { destination, permanent: entry.permanent === true };
  }
  return null;
}

export function configuredRedirectPathname(pathname: string) {
  return configuredRedirect(pathname)?.destination ?? null;
}

