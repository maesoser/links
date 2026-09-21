const CACHE_VERSION = "v6";
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
      fetch(request).catch(() => {
        return new Response(JSON.stringify({ error: "offline" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      })
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.status === 403) {
        reloadAllClients();
        return cached ?? response;
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

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);

  try {
    const response = await fetch(request);

    if (response.status === 403) {
      reloadAllClients();
      return response;
    }

    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    return new Response(JSON.stringify({ error: "offline", links: [], total: 0 }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}
