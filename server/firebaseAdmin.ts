// Node-only Firebase Admin token verifier for the Vercel function. It lives here
// rather than in the shared backend (supabase/functions/_shared/app.ts) because
// firebase-admin requires a Node runtime and can't run on the Deno edge function.
// server/entry.ts wires this in via `setTokenVerifier`, so the shared routes
// verify Firebase ID tokens without ever importing firebase-admin into Deno code.
import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { AuthedUser } from '../supabase/functions/_shared/app';

// Lazily initialize the default app once. Credentials: prefer an inline
// service-account JSON in FIREBASE_SERVICE_ACCOUNT; otherwise fall back to
// Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS / GCP metadata).
function initAdmin(): void {
  if (getApps().length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  initializeApp({
    credential: raw ? cert(JSON.parse(raw)) : applicationDefault(),
  });
}

// Verify a Firebase ID token and map it to the shared AuthedUser shape. Returns
// null on any invalid/expired token (the caller logs it as an auth error, not a
// crash). The user_metadata mirror lets the existing OAuth auto-provision path
// (which reads full_name/name/avatar_url/picture) work unchanged.
export async function verifyFirebaseToken(token: string): Promise<AuthedUser | null> {
  initAdmin();
  try {
    const decoded = await getAuth().verifyIdToken(token);
    return {
      id: decoded.uid,
      email: decoded.email ?? null,
      user_metadata: {
        full_name: decoded.name,
        name: decoded.name,
        avatar_url: decoded.picture,
        picture: decoded.picture,
      },
    };
  } catch {
    return null;
  }
}
