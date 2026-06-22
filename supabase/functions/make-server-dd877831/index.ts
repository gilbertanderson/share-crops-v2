// Supabase Edge Function entry — serves the shared Hono app on Deno.
// The same app runs on Vercel via /api (see /api/[[...route]].ts).
import { app } from "../_shared/app.ts";

Deno.serve(app.fetch);
