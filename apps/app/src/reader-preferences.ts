export const READER_TREE_COOKIE = "wiki_reader_tree";

/** Presentation only. These untrusted values never select content or authorize access. */
export function readerPreferences(cookie: string) {
  const entries = cookie.split(/;\s*/);
  const raw = entries.find(entry => entry.startsWith(READER_TREE_COOKIE + "="))?.slice(READER_TREE_COOKIE.length + 1);
  let expanded: Record<string, boolean> = {};
  if (raw && raw.length <= 3500) {
    try {
      const parsed: unknown = JSON.parse(decodeURIComponent(raw));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        expanded = Object.fromEntries(Object.entries(parsed).filter(([key, value]) => key.length <= 200 && typeof value === "boolean").slice(0, 100));
      }
    } catch { /* Ignore malformed optional presentation preferences. */ }
  }
  return { expanded, accountPending: entries.some(entry => entry.startsWith("wiki_user_session=") && entry.length > "wiki_user_session=".length) };
}

export function rememberReaderTree(expanded: Map<string, boolean>) {
  try {
    const defaults = expanded.size === 1 && expanded.get("wiki") === true;
    const value = defaults ? "" : encodeURIComponent(JSON.stringify(Object.fromEntries(expanded)));
    if (value.length > 3500) return;
    document.cookie = `${READER_TREE_COOKIE}=${value}; Path=/; SameSite=Lax; Max-Age=${defaults ? 0 : 2592000}${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch { /* Blocked cookies cannot prevent navigation. */ }
}
