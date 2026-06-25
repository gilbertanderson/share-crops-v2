// Supabase Edge Function entry — serves the shared Hono app on Deno.
// The same app runs on Vercel via server/entry.ts.
import { app, setTokenVerifier } from "../_shared/app.ts";
import { verifyFirebaseToken } from "../_shared/firebaseVerify.ts";

// Verify bearer tokens as Firebase ID tokens (the frontend mints them via
// getIdToken()). Without this the edge function falls back to Supabase-JWT
// verification and 401s every authenticated request. Set once at module load.
setTokenVerifier(verifyFirebaseToken);

Deno.serve(app.fetch);
