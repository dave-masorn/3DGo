const CACHE_NAME = '3dgo-cache-v1';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', event => {
  // A simple network-first strategy, falling back to cache if offline.
  // This satisfies PWA installability requirements without causing aggressive caching issues.
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Only cache successful GET requests
        if (event.request.method === 'GET' && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
