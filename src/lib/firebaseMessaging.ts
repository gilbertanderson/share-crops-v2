// Firebase Cloud Messaging (web push) client helpers.
// Requires VITE_FIREBASE_VAPID_KEY (Firebase console → Cloud Messaging → Web Push
// certificates). Background notifications are handled by /firebase-messaging-sw.js.
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import type { MessagePayload } from 'firebase/messaging';
import { app } from './firebase';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

// Request permission and return the FCM registration token (or null if
// unsupported / denied / not configured). Register the token with the backend
// (POST /push/register) so the server can target this device.
export async function requestPushToken(): Promise<string | null> {
  if (!(await isSupported())) return null;
  if (!VAPID_KEY) {
    console.warn('[push] VITE_FIREBASE_VAPID_KEY not set — skipping push setup.');
    return null;
  }
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return null;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const registration =
    (await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js')) ??
    (await navigator.serviceWorker.register('/firebase-messaging-sw.js'));

  const token = await getToken(getMessaging(app), {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  return token || null;
}

// Foreground messages (tab focused). FCM does NOT auto-show a notification here.
export function onForegroundMessage(cb: (payload: MessagePayload) => void): void {
  isSupported().then((ok) => {
    if (ok) onMessage(getMessaging(app), cb);
  });
}
