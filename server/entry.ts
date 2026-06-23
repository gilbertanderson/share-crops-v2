// Source for the Vercel Serverless Function. It runs the SAME shared Hono app
// as the Supabase Edge Function, on Node, talking directly to Supabase. This is
// the fallback backend the frontend fails over to.
//
// This file is NOT deployed directly: `scripts/build-api.mjs` esbuild-bundles it
// (inlining the shared backend, which uses Deno-style `.ts` imports that Vercel's
// own file tracer can't follow) into a single self-contained `api/index.js`.
//
// Vercel's modern Node runtime uses the Web-standard function signature: it calls
// exported per-method handlers (GET/POST/…) with a Web `Request` and expects a
// Web `Response`. Hono is Web-standard natively, so each handler just delegates to
// `root.fetch(request)`. (The old `hono/vercel` `handle()` adapter assumes the
// legacy `(req, res)` Node signature and breaks here — `req.headers.get` is not a
// function — so we don't use it.)
//
// Vercel's filesystem catch-all only matches a single path segment for plain
// (non-Next) projects, so a `vercel.json` rewrite funnels every `/api/*` depth to
// this one function. The app is mounted under both `/api` and `/` so it matches
// whether Vercel hands us the original path (/api/make-server-dd877831/*) or a
// prefix-stripped one (/make-server-dd877831/*).
import { Hono } from 'hono';
import { app, setTokenVerifier } from '../supabase/functions/_shared/app';
import { verifyFirebaseToken } from './firebaseAdmin';

// On Node/Vercel, verify bearer tokens as Firebase ID tokens (Admin SDK) instead
// of the shared backend's default Supabase-JWT check. Set once at module load.
setTokenVerifier(verifyFirebaseToken);

const root = new Hono();
root.route('/api', app);
root.route('/', app);

const handler = (request: Request) => root.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
