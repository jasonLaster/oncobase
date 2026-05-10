const STORAGE_KEY = "wiki-vite-livestore-devtools";
const QUERY_PARAM = "livestoreDevtools";

function readQueryPreference(url: URL): boolean | null {
  const rawValue = url.searchParams.get(QUERY_PARAM) ?? url.searchParams.get("devtools");
  if (rawValue == null) return null;

  const normalized = rawValue.toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) return true;
  if (["0", "false", "off", "no"].includes(normalized)) return false;
  return null;
}

export function readDevtoolsFooterVisible(url = new URL(window.location.href)): boolean {
  return readQueryPreference(url) === true;
}

export function readLiveStoreDevtoolsEnabled(): boolean {
  const queryPreference = readQueryPreference(new URL(window.location.href));
  if (queryPreference != null) {
    if (queryPreference) {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    return queryPreference;
  }

  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

export function reloadWithLiveStoreDevtools(enabled: boolean) {
  if (enabled) {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  const nextUrl = new URL(window.location.href);
  if (enabled) {
    nextUrl.searchParams.set(QUERY_PARAM, "1");
    nextUrl.searchParams.set("devtools", "1");
  } else {
    nextUrl.searchParams.delete(QUERY_PARAM);
    nextUrl.searchParams.delete("devtools");
  }
  window.location.assign(nextUrl.toString());
}
