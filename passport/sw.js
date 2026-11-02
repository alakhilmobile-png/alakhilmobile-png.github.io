// Minimal service worker: makes the site installable as an app.
// It does not cache anything, so visitors always get the newest version.
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function () { /* network only */ });
