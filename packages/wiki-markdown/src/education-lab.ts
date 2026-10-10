export const EDUCATION_LAB_SANDBOX = "allow-scripts allow-popups";
const PREFIX = "wiki/education/";

/** Only explicitly marked curriculum labs get executable iframe support.
 * Their document stays on the local education asset route, with an opaque
 * sandbox origin. Host adapters may translate that route to a local export. */
export function resolveEducationLabSrc(src: string | undefined, currentSlug?: string, apiBasePath = ""): string {
  const invalid = () => { throw Error("Education lab requires a local HTML asset under wiki/education/"); };
  if (!src || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src) || /[\\\u0000-\u001f]/.test(src)) return invalid();
  let asset: string;
  let fragment = "";
  if (src.startsWith("/api/")) {
    const url = new URL(src, "https://wiki.invalid");
    if (!/^\/api\/(?:education\/)?(?:api\/)?file$/.test(url.pathname) ||
        url.searchParams.getAll("path").length !== 1 || [...url.searchParams.keys()].some(key => key !== "path")) return invalid();
    asset = url.searchParams.get("path")!;
    fragment = url.hash;
    // A file API path must already be canonical, without traversal segments.
    if (asset.startsWith("/") || asset.split("/").some(part => part === "." || part === "..")) return invalid();
  } else {
    const [rawPath, ...hash] = src.split("#");
    if (rawPath.includes("?")) return invalid();
    let decoded: string;
    try { decoded = decodeURIComponent(rawPath); } catch { return invalid(); }
    fragment = hash.length ? `#${hash.join("#")}` : "";
    const directory = currentSlug?.split("/").slice(0, -1).join("/");
    if (!decoded.startsWith("/") && !decoded.startsWith(PREFIX) && !directory?.startsWith(PREFIX)) return invalid();
    const joined = decoded.startsWith("/") || decoded.startsWith(PREFIX) ? decoded.replace(/^\//, "") : `${directory}/${decoded}`;
    const parts: string[] = [];
    for (const part of joined.split("/")) {
      if (part === ".") continue;
      if (part === "..") { if (!parts.length) return invalid(); parts.pop(); }
      else parts.push(part);
    }
    asset = parts.join("/");
  }
  if (!asset.startsWith(PREFIX) || !/\.html$/i.test(asset) || /[\\%:\u0000-\u001f]/.test(asset) ||
      asset.split("/").some(part => !part || part === "." || part === "..")) return invalid();
  return `${apiBasePath}/api/file?path=${encodeURIComponent(asset)}${fragment}`;
}
