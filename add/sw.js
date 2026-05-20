const CACHE = "ytch-add-v1";
const SHELL = ["/add/", "/add/index.html", "/add/manifest.json"];

self.addEventListener("install", e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
    self.skipWaiting();
});

self.addEventListener("activate", e => {
    e.waitUntil(caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ));
    self.clients.claim();
});

self.addEventListener("fetch", e => {
    const url = new URL(e.request.url);
    // Cache-first for app shell; network-only for API calls
    if (url.hostname === "api.github.com" || url.hostname === "api.allorigins.win" || url.hostname === "www.youtube.com") {
        e.respondWith(fetch(e.request));
        return;
    }
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request))
    );
});
