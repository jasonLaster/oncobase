// This cookie is a response-size hint, never proof of identity or permission.
export const READER_SHELL_COOKIE = "wiki_reader_shell";
export function readerShellHint(cookie: string, url: URL): boolean {
  if (url.searchParams.get("readerCache") === "0" || url.searchParams.get("readerBootstrap") === "0") return false;
  try {
    const raw = cookie.split(";").map(part => part.trim()).find(part => part.startsWith(`${READER_SHELL_COOKIE}=`))?.slice(READER_SHELL_COOKIE.length + 1);
    if (!raw || raw.length > 3000) return false;
    const paths: unknown = JSON.parse(decodeURIComponent(raw));
    return Array.isArray(paths) && paths.length <= 8 && paths.includes(url.pathname);
  } catch { return false; }
}
