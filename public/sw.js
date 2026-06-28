// Share Crops service worker — app-shell offline support + FCM background push.
// Firebase config is public (same values as src/lib/firebase.ts / .env.local).
importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCEI7ej1xjvuv7BPfTo8GbSnPCkULiKjIU',
  authDomain: 'share-crops-app.firebaseapp.com',
  projectId: 'share-crops-app',
  storageBucket: 'share-crops-app.firebasestorage.app',
  messagingSenderId: '764953465643',
  appId: '1:764953465643:web:9433426e334aed02a4eb6e',
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || 'Share Crops', {
    body: body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: payload.data || {},
  });
});

const CACHE = 'sharecrops-shell-v3';
const SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never intercept cross-origin, the API, or the Supabase edge function.
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api') ||
    url.pathname.includes('/functions/v1')
  ) {
    return;
  }

  // SPA navigations: network-first, fall back to cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() =>
          caches.match('/index.html').then((hit) => hit || caches.match('/offline.html')),
        ),
    );
    return;
  }

  // Static assets: cache-first, populate on miss.
  event.respondWith(
    caches.match(request).then((hit) =>
      hit ||
      fetch(request).then((res) => {
        if (!res.ok) return res;
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return res;
      }),
    ),
  );
});
