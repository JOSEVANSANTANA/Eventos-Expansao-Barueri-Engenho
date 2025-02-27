var cacheName = 'organizador-v1';
var filesToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    'https://cdn.jsdelivr.net/npm/fullcalendar@5.11.0/main.min.css',
    'https://cdn.jsdelivr.net/npm/fullcalendar@5.11.0/main.min.js'
];

self.addEventListener('install', function(event) {
    event.waitUntil(caches.open(cacheName).then(function(cache) {
        return cache.addAll(filesToCache);
    }));
});

self.addEventListener('fetch', function(event) {
    event.respondWith(caches.match(event.request).then(function(response) {
        return response || fetch(event.request);
    }));
});