// Fixed classes for the HTML shell's request span. Paths carry page slugs, so
// only a first-segment family and an outcome leave the process.
const FAMILIES = ["wiki", "sources", "education", "tools", "tags", "search", "chat", "admin", "diagnostics", "comments", "share", "api", "assets", "pdf-assets"] as const;
export type ShellPathClass = "root" | typeof FAMILIES[number] | "sign-in" | "file" | "probe" | "other";
export type ShellOutcome = "document" | "redirect" | "asset" | "asset-miss" | "probe" | "not-found" | "error" | "other";

// Scanners ask every site for these. Nothing here serves them, and no wiki
// page can live at them: hidden path segments (other than .well-known) are
// never published, and the reader has no server-side scripts or WordPress.
const PROBE_FILE_RE = /\.(?:php\d?|phtml|aspx?|jsp|cgi|env|sql|bak)$/i;
// Published pages live under these; their names are the author's, so only the
// hidden-segment rule applies inside them.
const CONTENT_FAMILIES = new Set(["wiki", "sources", "education", "tags"]);
const PROBE_PREFIXES = ["/wp-admin", "/wp-content", "/wp-includes", "/wp-json", "/wp-login", "/wordpress", "/xmlrpc", "/cgi-bin", "/phpmyadmin"];

export function isProbePath(pathname: string) {
  const lower = pathname.toLowerCase();
  if (lower.split("/").some(segment => segment.startsWith(".") && segment !== ".well-known" && segment !== "." && segment !== "..")) return true;
  if (CONTENT_FAMILIES.has(lower.split("/")[1] ?? "")) return false;
  if (PROBE_FILE_RE.test(lower)) return true;
  return PROBE_PREFIXES.some(prefix => lower === prefix || lower.startsWith(`${prefix}/`) || lower.startsWith(`${prefix}.`));
}

export function shellPathClass(pathname: string): ShellPathClass {
  if (isProbePath(pathname)) return "probe";
  if (pathname === "/") return "root";
  if (pathname === "/login" || pathname === "/sign-in") return "sign-in";
  const segment = pathname.split("/")[1] ?? "";
  const family = FAMILIES.find(name => name === segment);
  if (family) return family;
  return /\.[a-z0-9]{1,8}$/i.test(pathname) ? "file" : "other";
}

export function shellOutcome(status: number, pathClass: ShellPathClass, contentType: string | null): ShellOutcome {
  if (pathClass === "probe") return "probe";
  if (status >= 500) return "error";
  if (status >= 300 && status < 400) return "redirect";
  const file = pathClass === "file" || pathClass === "assets" || pathClass === "pdf-assets";
  if (status === 404) return file ? "asset-miss" : "not-found";
  if (status >= 200 && status < 300) return contentType?.startsWith("text/html") ? "document" : file ? "asset" : "other";
  return "other";
}

/** A scanner's request ends here: no gate lookup, no database read, never cached. */
export function probeResponse() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
}
