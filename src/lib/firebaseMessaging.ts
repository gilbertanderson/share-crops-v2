// Firebase Cloud Messaging (web push) client helpers.
// Requires VITE_FIREBASE_VAPID_KEY (Firebase console → Cloud Messaging → Web Push
// certificates). Background notifications are handled by /sw.js.
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import type { MessagePayload } from 'firebase/messaging';
import { app } from './firebase';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

export type PushTokenErrorCode =
  | 'unsupported'
  | 'not_configured'
  | 'permission_denied'
  | 'registration_failed'
  | 'token_failed';

export class PushTokenError extends Error {
  readonly code: PushTokenErrorCode;

  constructor(message: string, code: PushTokenErrorCode) {
    super(message);
    this.name = 'PushTokenError';
    this.code = code;
  }
}

const APP_SW_URL = '/sw.js';

// Request permission and return the FCM registration token. Register the token
// with the backend (POST /push/register) so the server can target this device.
export async function requestPushToken(): Promise<string> {
  if (!(await isSupported())) {
    throw new PushTokenError(
      'Push notifications are not supported in this browser.',
      'unsupported',
    );
  }
  if (!VAPID_KEY?.trim()) {
    throw new PushTokenError(
      'Push notifications are not configured for this environment.',
      'not_configured',
    );
  }
  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    throw new PushTokenError(
      'Push notifications are not supported in this browser.',
      'unsupported',
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new PushTokenError(
      'Notification permission was denied. Enable notifications in your browser settings and try again.',
      'permission_denied',
    );
  }

  // Use the app-shell SW at scope `/` (also hosts FCM). A separate
  // firebase-messaging-sw.js cannot share the same scope as /sw.js.
  let registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) {
    try {
      registration = await navigator.serviceWorker.register(APP_SW_URL);
    } catch (err) {
      console.error('[push] service worker registration failed:', err);
      throw new PushTokenError(
        'Could not register the notification service worker.',
        'registration_failed',
      );
    }
  }

  try {
    await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(app), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) {
      throw new PushTokenError(
        'Could not obtain a push token. Try refreshing the page and enabling again.',
        'token_failed',
      );
    }
    return token;
  } catch (err) {
    if (err instanceof PushTokenError) throw err;
    console.error('[push] getToken failed:', err);
    throw new PushTokenError(
      'Could not obtain a push token. Try refreshing the page and enabling again.',
      'token_failed',
    );
  }
}

// Foreground messages (tab focused). FCM does NOT auto-show a notification here.
export function onForegroundMessage(cb: (payload: MessagePayload) => void): void {
  isSupported().then((ok) => {
    if (ok) onMessage(getMessaging(app), cb);
  });
}
