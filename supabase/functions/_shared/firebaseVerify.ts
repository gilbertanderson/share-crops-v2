// Cross-runtime Firebase ID-token verifier — the single source of truth for both
// the Deno edge function and the Node/Vercel function. Verifies tokens directly
// with `jose` against Google's public JWKS (no firebase-admin: it's CommonJS and
// crashes on Vercel with ERR_REQUIRE_ESM, and can't run on Deno at all). Token
// verification only needs Google's public keys — no service-account credential.
//
// Deno resolves "jose" via the import map in make-server-dd877831/deno.json;
// Node resolves it from node_modules through the esbuild bundle.
import { jwtVerify, createRemoteJWKSet } from "jose";
import { getEnv } from "./env.ts";
import type { AuthedUser } from "./app.ts";

// Firebase signs ID tokens (RS256) with rotating keys published here as a JWKS.
// createRemoteJWKSet fetches + caches them and refetches on an unknown key id.
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

// Project id drives the issuer/audience checks. Prefer explicit env vars that
// match the browser Firebase config — the service account may be present for FCM
// and must not override the project the client actually signs into.
function firebaseProjectId(): string {
  const explicit =
    getEnv("FIREBASE_PROJECT_ID")?.trim() ||
    getEnv("VITE_FIREBASE_PROJECT_ID")?.trim();
  if (explicit) return explicit;

  const raw = getEnv("FIREBASE_SERVICE_ACCOUNT");
  if (raw) {
    try {
      const fromSa = JSON.parse(raw).project_id;
      if (fromSa) return fromSa;
    } catch { /* fall through */ }
  }
  return "share-crops-app";
}

const PROJECT_ID = firebaseProjectId();

export function getFirebaseProjectId(): string {
  return PROJECT_ID;
}

// Verify a Firebase ID token and map it to the app's authed-user shape. Returns
// null on any invalid/expired/wrong-audience token. The user_metadata mirror
// keeps the OAuth auto-provision path (auth/me) working unchanged.
//
// Security gate: tokens whose email is not yet verified are rejected, so a user
// can't sign up with an address they don't control and immediately act as that
// identity. Federated providers (Google) set email_verified true; email/password
// users must complete the verification email first.
export async function verifyFirebaseToken(token: string): Promise<AuthedUser | null> {
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
      algorithms: ["RS256"],
    });
    if (!payload.sub) return null;
    if (payload.email && !payload.email_verified) return null;
    return {
      id: String(payload.sub),
      email: (payload.email as string | undefined) ?? null,
      user_metadata: {
        full_name: payload.name,
        name: payload.name,
        avatar_url: payload.picture,
        picture: payload.picture,
      },
    };
  } catch {
    return null;
  }
}
