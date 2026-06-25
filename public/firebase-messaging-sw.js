/* eslint-disable */
// FCM background message handler. Runs in its own service-worker context, so it
// cannot read import.meta.env — the (non-secret, public) Firebase web config is
// inlined here. Keep these values in sync with .env.local / src/lib/firebase.ts.
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
