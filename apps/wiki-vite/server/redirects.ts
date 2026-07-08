import redirects from "../../../apps/web/redirects.json";

type RedirectEntry = {
  source: string;
  destination: string;
  permanent?: boolean;
};

function matchRedirect(pathname: string, entry: RedirectEntry) {
  if (!entry.source.includes(":path*")) {
    return pathname === entry.source ? entry.destination : null;
  }

  const sourcePrefix = entry.source.slice(0, entry.source.indexOf(":path*"));
  if (!pathname.startsWith(sourcePrefix)) return null;
  const rest = pathname.slice(sourcePrefix.length);
  return entry.destination.replace(":path*", rest);
}

export function legacyRedirectResponse(request: Request) {
  const url = new URL(request.url);
  for (const entry of redirects as RedirectEntry[]) {
    const destination = matchRedirect(url.pathname, entry);
    if (!destination) continue;
    const target = new URL(destination, request.url);
    target.search = url.search;
    return Response.redirect(target, entry.permanent ? 308 : 307);
  }
  return null;
}
