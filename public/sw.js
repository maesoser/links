const CACHE_VERSION = "v8";
const SHELL_CACHE = `links-shell-${CACHE_VERSION}`;
const API_CACHE = `links-api-${CACHE_VERSION}`;

const SHELL_ASSETS = ["/", "/manifest.json", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  const current = new Set([SHELL_CACHE, API_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !current.has(k)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function reloadAllClients() {
  self.clients.matchAll({ type: "window" }).then((clients) => {
    clients.forEach((client) => client.navigate(client.url));
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 401 || response.status === 403) {
            reloadAllClients();
          }
          return response;
        })
        .catch(() => {
          return new Response(JSON.stringify({ error: "offline" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        })
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(staleWhileRevalidateApi(request));
    return;
  }

  event.respondWith(staleWhileRevalidateShell(request));
});

async function staleWhileRevalidateShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.status === 401 || response.status === 403) {
        reloadAllClients();
        return response;
      }
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(
      () =>
        new Response("Offline – shell not yet cached", {
          status: 503,
          headers: { "Content-Type": "text/plain" },
        })
    );

  return cached ?? (await fetchPromise);
}

async function staleWhileRevalidateApi(request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request);

  // Always kick off a background network fetch to refresh the cache.
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.status === 401 || response.status === 403) {
        reloadAllClients();
        return response;
      }
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => {
      // Network failed — if we already returned a cached response, this
      // background fetch just silently fails. If we have no cache entry
      // we'll fall through to the offline response below.
      return null;
    });

  // Serve cache immediately if available; otherwise await the network.
  if (cached) {
    // Background revalidation — result discarded (cache already updated above).
    fetchPromise.catch(() => {});
    return cached;
  }

  // No cache entry yet — must wait for the network.
  const response = await fetchPromise;
  if (response) return response;

  return new Response(JSON.stringify({ error: "offline", links: [], total: 0 }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}
