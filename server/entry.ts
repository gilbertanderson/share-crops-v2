// Source for the Vercel Serverless Function. It runs the Node Hono API and
// talks directly to Supabase Postgres/Storage.
//
// This file is NOT deployed directly: `scripts/build-api.mjs` esbuild-bundles it
// into a single `api/index.js` that Vercel serves as the catch-all API function.
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
// this one function. Mounting under both `/api` and `/` preserves the existing
// route shape in either rewrite form.
import { Hono } from 'hono';
import { app } from './app.ts';

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
