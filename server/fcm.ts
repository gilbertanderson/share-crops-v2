// @ts-nocheck
// Server-side FCM sender (HTTP v1). Cross-runtime: signs a service-account JWT
// with `jose` (Deno + Node both), exchanges it for a short-lived OAuth access
// token, and POSTs to the FCM v1 send endpoint. No firebase-admin (CommonJS,
// can't run on Deno). No-ops gracefully when FIREBASE_SERVICE_ACCOUNT is unset,
// so push is simply inert until the secret is configured per runtime.
import { SignJWT, importPKCS8 } from "jose";
import { getEnv } from "./env.ts";
import * as db from "./db.ts";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

function serviceAccount(): any | null {
  const raw = getEnv("FIREBASE_SERVICE_ACCOUNT");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Cache the access token across invocations (warm instances) until ~1 min before expiry.
let cached: { token: string; exp: number } | null = null;

async function getAccessToken(sa: any): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;

  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const key = await importPKCS8(sa.private_key, "RS256");
  const assertion = await new SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    console.error("FCM access-token error:", res.status, await res.text().catch(() => ""));
    return null;
  }
  const json = await res.json();
  cached = { token: json.access_token, exp: now + (json.expires_in ?? 3600) };
  return cached.token;
}

// Send a notification to every device token registered for a user. Best-effort:
// never throws (callers fire-and-forget). Prunes tokens FCM rejects as stale.
export async function sendPushToUser(
  userId: string,
  notification: { title: string; body: string; data?: Record<string, string>; link?: string },
): Promise<void> {
  try {
    const sa = serviceAccount();
    if (!sa) return; // push not configured for this runtime
    const tokens = await db.getPushTokensForUser(userId);
    if (!tokens.length) return;
    const accessToken = await getAccessToken(sa);
    if (!accessToken) return;

    const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
    await Promise.all(tokens.map(async (token) => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: notification.title, body: notification.body },
              data: notification.data,
              webpush: { fcmOptions: { link: notification.link || "/" } },
            },
          }),
        });
        // 404 UNREGISTERED / 403 SenderId-mismatch → token is dead; drop it.
        if (res.status === 404 || res.status === 403) {
          await db.deletePushToken(token).catch(() => {});
        } else if (!res.ok) {
          console.error("FCM send error:", res.status, await res.text().catch(() => ""));
        }
      } catch (e) {
        console.error("FCM send exception:", String(e));
      }
    }));
  } catch (e) {
    console.error("sendPushToUser failed:", String(e));
  }
}
