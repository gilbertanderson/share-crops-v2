// Reference handler for the @supabase/server Hono adapter.
//
// This is a standalone EXAMPLE — it is not wired into the live API. The shipping
// backend lives in supabase/functions/_shared/app.ts and is mounted by
// server/entry.ts (Vercel) and supabase/functions/make-server-dd877831 (Edge).
// This file shows the @supabase/server pattern so routes can migrate onto it
// incrementally. To serve it from Vercel, import its `app` into server/entry.ts.
//
// What @supabase/server gives you over hand-rolled auth:
//   • `withSupabase({ auth: 'user' })` verifies the caller's JWT LOCALLY against
//     SUPABASE_JWKS_URL (cached) — no `supabase.auth.getUser()` network call per
//     request, which is what _shared/app.ts currently does.
//   • It injects `c.var.supabaseContext` with two ready clients:
//       - `supabase`      → scoped to the caller, RLS enforced
//       - `supabaseAdmin` → secret key, bypasses RLS (use sparingly)
//     plus `userClaims` / `jwtClaims` decoded from the token.
//
// Required env (see .env.example): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
// SUPABASE_SECRET_KEY, SUPABASE_JWKS_URL. On Supabase Edge Functions these are
// injected automatically.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { withSupabase } from '@supabase/server/adapters/hono';
import type { SupabaseContext } from '@supabase/server';

type Env = { Variables: { supabaseContext: SupabaseContext } };

const app = new Hono<Env>();

// The Hono adapter does NOT handle CORS — use Hono's own middleware for it.
app.use('*', cors());

// Public: no credentials required.
app.get('/health', (c) => c.json({ status: 'ok' }));

// Everything below requires a valid Supabase user JWT. A present-but-invalid
// token is rejected immediately (Hono HTTPException 401).
app.use('/me', withSupabase({ auth: 'user' }));
app.use('/my-listings', withSupabase({ auth: 'user' }));

// Identity straight from the verified JWT — no DB round-trip.
app.get('/me', (c) => {
  const { userClaims } = c.var.supabaseContext;
  return c.json({ user: userClaims });
});

// RLS-scoped query: `supabase` runs as the caller, so policies decide visibility.
app.get('/my-listings', async (c) => {
  const { supabase, userClaims } = c.var.supabaseContext;
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('seller_id', userClaims!.id);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ listings: data });
});

export { app };

// Web-standard fetch handler — works on Vercel's modern runtime, Deno, Bun, etc.
export default { fetch: app.fetch };
