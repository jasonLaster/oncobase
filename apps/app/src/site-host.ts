/**
 * Two sites share one deployment and answer by host: oncobase.io is the Oncobase marketing site
 * (home, features, compare), and every other host is Diana's knowledge base. Nothing here needs
 * the wiki database, so it runs in the browser, the server, and the inline head scripts.
 */
export type SiteKind = "diana" | "oncobase";

export const ONCOBASE_ORIGIN = "https://oncobase.io";
export const DIANA_ORIGIN = "https://diana-tnbc.com";

/**
 * Hosts that serve the marketing site: oncobase.io and www.oncobase.io, plus oncobase.localhost
 * and www.oncobase.localhost for local work. Other subdomains (e.g. kevin.oncobase.io) serve
 * hosted wikis resolved by host. The inline reader scripts copy this pattern because they are
 * serialized into the HTML head; a test keeps the copies equal.
 */
export const ONCOBASE_HOST_PATTERN = "^(www\\.)?oncobase\\.(io|localhost)$";
const ONCOBASE_HOST_RE = new RegExp(ONCOBASE_HOST_PATTERN);

/** `extraHosts` adds preview aliases (the ONCOBASE_SITE_HOSTS environment variable on the server). */
export function isOncobaseHost(host: string | null | undefined, extraHosts: readonly string[] = []): boolean {
  const name = (host ?? "").trim().toLowerCase().split(":")[0] ?? "";
  if (!name) return false;
  return ONCOBASE_HOST_RE.test(name) || extraHosts.includes(name);
}

export function siteKindForHost(host: string | null | undefined, extraHosts: readonly string[] = []): SiteKind {
  return isOncobaseHost(host, extraHosts) ? "oncobase" : "diana";
}

const isLocalHost = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");

/**
 * The origin of a site as seen from where the visitor is now. On localhost both sites share the
 * current port (diana at localhost, oncobase at oncobase.localhost); everywhere else they are the
 * real domains, so a preview deployment still links to production for the other site.
 */
export function siteOrigin(site: SiteKind, here: { protocol: string; hostname: string; port: string } | null): string {
  if (here && isLocalHost(here.hostname)) {
    const host = site === "oncobase" ? "oncobase.localhost" : "localhost";
    return `${here.protocol}//${host}${here.port ? `:${here.port}` : ""}`;
  }
  return site === "oncobase" ? ONCOBASE_ORIGIN : DIANA_ORIGIN;
}

/** The name a hosted wiki shows in its logo, sign-in page and workspace menu. */
export type SiteBrand = {
  /** The letter in the square logo. */
  initial: string;
  /** Wordmark first part, e.g. "Diana" or "Kevin". */
  name: string;
  /** Wordmark tag after the name, e.g. "TNBC"; empty for hosted wikis. */
  tag: string;
  /** Name and tag together, for labels. */
  label: string;
};

const DIANA_BRAND: SiteBrand = { initial: "D", name: "Diana", tag: "TNBC", label: "Diana TNBC" };
const HOSTED_WIKI_RE = /^([a-z0-9][a-z0-9-]*)\.oncobase\.(io|localhost)$/;

/** Hosted wikis on <name>.oncobase.io brand themselves from the subdomain; every other host is Diana's. */
export function siteBrandForHost(host: string | null | undefined): SiteBrand {
  const name = (host ?? "").trim().toLowerCase().split(":")[0] ?? "";
  const sub = HOSTED_WIKI_RE.exec(name)?.[1];
  if (!sub || sub === "www") return DIANA_BRAND;
  const display = sub.split("-").filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" ");
  return { initial: display[0] ?? "", name: display, tag: "", label: display };
}

/** The brand for the page's own host (Diana's on the server, where there is no location). */
export function currentSiteBrand(): SiteBrand {
  return siteBrandForHost(typeof location === "undefined" ? null : location.hostname);
}
