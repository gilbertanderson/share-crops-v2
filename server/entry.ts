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

/**
 * Vercel rewrites `/api/*` to a single `api/index.js` function. Depending on
 * runtime, `request.url` may arrive as `/api` or `/api/index` without the
 * subpath. Restore the original path from the rewrite query param or headers.
 */
function normalizeRequest(request: Request): Request {
  const url = new URL(request.url);
  const pathParam = url.searchParams.get('__path');
  if (pathParam) {
    url.searchParams.delete('__path');
    const restored = new URL(`/api/${pathParam}${url.search}`, url.origin);
    return new Request(restored, request);
  }

  if (url.pathname === '/api' || url.pathname === '/api/index') {
    const invokePath =
      request.headers.get('x-vercel-invoke-path') ||
      request.headers.get('x-matched-path') ||
      request.headers.get('x-forwarded-uri');
    if (invokePath?.startsWith('/api/')) {
      const restored = new URL(`${invokePath}${url.search}`, url.origin);
      return new Request(restored, request);
    }
  }

  return request;
}

const handler = (request: Request) => root.fetch(normalizeRequest(request));

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
