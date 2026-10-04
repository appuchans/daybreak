// Offline shell. The app's own files (page, script, styles, fonts, icons) come from the cache first, so the
// page appears at once even on a weak connection, and are refreshed in the background: a new version shows
// on the next open. news.json goes to the network first and falls back to the last cached copy, so the
// stories are as fresh as the connection allows. Cross-origin requests (publisher images) are untouched.
const CACHE = "daybreak-v2";
const SHELL = ["./", "index.html", "app.css", "app.js", "lib.js", "fallback.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "fonts/fraunces-latin.woff2", "fonts/public-sans-latin.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

function fromNetwork(req) {
  return fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/news.json")) {
    e.respondWith(fromNetwork(req).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const network = fromNetwork(req);
      if (!cached) return network;
      e.waitUntil(network.catch(() => {}));
      return cached;
    }),
  );
});
