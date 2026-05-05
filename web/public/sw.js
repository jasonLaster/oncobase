const FILE_TREE_CACHE = "diana-file-tree-v1";
const MAX_FILE_TREE_ENTRIES = 8;

function isPublicCompactFileTreeRequest(request) {
  if (request.method !== "GET") return false;

  const url = new URL(request.url);
  return (
    url.origin === self.location.origin &&
    url.pathname === "/api/file-tree" &&
    url.searchParams.get("format") === "compact" &&
    url.searchParams.get("scope") === "public"
  );
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_FILE_TREE_ENTRIES) return;

  await Promise.all(
    keys
      .slice(0, keys.length - MAX_FILE_TREE_ENTRIES)
      .map((request) => cache.delete(request)),
  );
}

async function fetchAndCacheFileTree(request) {
  const response = await fetch(request);
  if (
    response.ok &&
    response.headers.get("X-File-Tree-Cache") === "public"
  ) {
    const cache = await caches.open(FILE_TREE_CACHE);
    await cache.put(request, response.clone());
    await trimCache(cache);
  }
  return response;
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith("diana-file-tree-") && key !== FILE_TREE_CACHE)
              .map((key) => caches.delete(key)),
          ),
        ),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  if (!isPublicCompactFileTreeRequest(event.request)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(FILE_TREE_CACHE);
      const cached = await cache.match(event.request);
      const refresh = fetchAndCacheFileTree(event.request);

      if (cached) {
        event.waitUntil(refresh.catch(() => undefined));
        return cached;
      }

      return refresh;
    })(),
  );
});
