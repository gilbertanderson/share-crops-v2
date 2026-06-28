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

/** Ensure /sw.js is active and includes FCM (updates stale shells without messaging). */
async function ensurePushServiceWorker(): Promise<ServiceWorkerRegistration> {
  let registration = await navigator.serviceWorker.register(APP_SW_URL);
  try {
    await registration.update();
  } catch (err) {
    console.warn('[push] service worker update check failed:', err);
  }

  const waitForControllerChange = () =>
    new Promise<void>((resolve) => {
      const onController = () => {
        navigator.serviceWorker.removeEventListener('controllerchange', onController);
        resolve();
      };
      navigator.serviceWorker.addEventListener('controllerchange', onController);
    });

  const waitForInstalled = (worker: ServiceWorker) =>
    new Promise<void>((resolve) => {
      if (worker.state === 'installed' || worker.state === 'activated') {
        resolve();
        return;
      }
      const onStateChange = () => {
        if (worker.state === 'installed' || worker.state === 'activated') {
          worker.removeEventListener('statechange', onStateChange);
          resolve();
        }
      };
      worker.addEventListener('statechange', onStateChange);
    });

  if (registration.installing) {
    await waitForInstalled(registration.installing);
    registration = (await navigator.serviceWorker.getRegistration()) ?? registration;
  }

  if (registration.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    await waitForControllerChange();
    registration = (await navigator.serviceWorker.getRegistration()) ?? registration;
  }

  await navigator.serviceWorker.ready;
  return registration;
}

function firebaseMessagingErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') {
    switch (err.code) {
      case 'messaging/permission-blocked':
        return 'Notification permission was denied. Enable notifications in your browser settings and try again.';
      case 'messaging/unsupported-browser':
        return 'Push notifications are not supported in this browser.';
      case 'messaging/failed-service-worker-registration':
        return 'Could not activate the notification service worker. Refresh the page and try again.';
      default:
        if ('message' in err && typeof err.message === 'string' && err.message) {
          return err.message;
        }
    }
  }
  return 'Could not obtain a push token. Try refreshing the page and enabling again.';
}

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
  let registration: ServiceWorkerRegistration;
  try {
    registration = await ensurePushServiceWorker();
  } catch (err) {
    console.error('[push] service worker registration failed:', err);
    throw new PushTokenError(
      'Could not register the notification service worker.',
      'registration_failed',
    );
  }

  try {
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
    throw new PushTokenError(firebaseMessagingErrorMessage(err), 'token_failed');
  }
}

// Foreground messages (tab focused). FCM does NOT auto-show a notification here.
export function onForegroundMessage(cb: (payload: MessagePayload) => void): void {
  isSupported().then((ok) => {
    if (ok) onMessage(getMessaging(app), cb);
  });
}
