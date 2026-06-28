/* eslint-disable */
// DEPRECATED: FCM now runs inside /sw.js (one service worker per scope).
// Kept so existing installs that activated this script before the merge keep
// receiving background messages until they pick up the updated /sw.js.
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
