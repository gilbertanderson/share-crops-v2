// Node-only Firebase Admin token verifier for the API backend.
import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export type AuthedUser = {
  id: string;
  email: string | null;
  user_metadata?: Record<string, any>;
};

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

// Verify a Firebase ID token and map it to the app's authenticated-user shape.
// Returns null on invalid/expired tokens. The user_metadata mirror lets the
// existing OAuth auto-provision path work unchanged.
//
// Security gate: tokens whose email is not yet verified are rejected. This stops
// someone from signing up with an email they don't control and immediately
// acting as that identity. Federated providers (Google) return email_verified
// true; email/password users must complete the verification email first.
export async function verifyFirebaseToken(token: string): Promise<AuthedUser | null> {
  initAdmin();
  try {
    const decoded = await getAuth().verifyIdToken(token);
    if (decoded.email && !decoded.email_verified) return null;
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
