# Deploying Share Crops v2

The **same Hono backend** (`supabase/functions/_shared/app.ts`) runs on two runtimes:

- **Supabase Edge Functions (primary)** — Deno, served at
  `https://<project>.supabase.co/functions/v1/make-server-dd877831`
- **Vercel Serverless Functions (fallback)** — Node, served at
  `https://<app>.vercel.app/api/make-server-dd877831`

The frontend calls the primary first and automatically fails over to the
fallback on a network error or 5xx (see `fetchWithFailover` in `src/lib/api.ts`).
Both backends talk to the **same** Supabase Postgres / KV / Storage, so the
fallback stays useful even if the Edge Functions runtime is down.

```
            ┌──────────── Supabase (primary) ───────────┐
 frontend ──┤  Edge Function: make-server-dd877831       ├── Supabase DB
   │  └─ on 5xx/network error, fail over ↓               │   (Postgres + KV
   │        ┌──────────── Vercel (fallback) ─────────────┤    + Storage)
   └────────┤  /api  →  same Hono app (Node)             ├───┘
            └────────────────────────────────────────────┘
```

---

## 1. Backend env vars (both runtimes need these)

| Var | Value | Secret? |
|-----|-------|---------|
| `SUPABASE_URL` | `https://xwjvtpzpufhuybylnwzx.supabase.co` | no |
| `SUPABASE_ANON_KEY` | your project anon key | no |
| `SUPABASE_SERVICE_ROLE_KEY` | **you must supply** (Supabase → Settings → API) | **yes** |
| `APP_ID` | `dd877831` | no |
| `STORAGE_BUCKET_NAME` | `make-dd877831-sharecrops` | no |
| `KV_TABLE_NAME` | `kv_store_dd877831` | no |
| `ADMIN_EMAIL` | **you must supply** (email that gets the admin role) | no |
| `SEED_RATER_EMAIL` | optional (seed-data rater) | no |
| `CORS_ORIGINS` | comma-separated allowed origins, e.g. `https://<app>.vercel.app,http://localhost:5173,http://localhost:4321` | no |
| `DEFAULT_ORIGIN` | e.g. `https://<app>.vercel.app` | no |
| `ANTHROPIC_API_KEY` | **required for AI listing drafts** — Anthropic API key (`sk-ant-...`) | **yes** |
| `SKIP_INIT` | **Vercel only:** `true` (skips re-seeding on cold starts) | no |

> The service-role key is **not** in this repo and must never be committed.

---

## 2. Deploy the Supabase Edge Function (primary)

> Your original `shareCropsApp` already has this deployed and live. These steps
> let you (re)deploy the identical app from this repo if you want one source.

```bash
cd share-crops-v2
supabase login                       # one-time
supabase link --project-ref xwjvtpzpufhuybylnwzx

# Set the function secrets (skip SKIP_INIT here — primary should seed):
supabase secrets set \
  SUPABASE_SERVICE_ROLE_KEY=... \
  ADMIN_EMAIL=... \
  ANTHROPIC_API_KEY=... \
  APP_ID=dd877831 \
  STORAGE_BUCKET_NAME=make-dd877831-sharecrops \
  KV_TABLE_NAME=kv_store_dd877831 \
  CORS_ORIGINS="https://<app>.vercel.app,http://localhost:5173,http://localhost:4321" \
  DEFAULT_ORIGIN="https://<app>.vercel.app"

supabase functions deploy make-server-dd877831
```

`SUPABASE_URL` / `SUPABASE_ANON_KEY` are injected by the Supabase runtime
automatically. The `deno.json` import map resolves `hono` / `@supabase/supabase-js`.

---

## 3. Deploy to Vercel (frontend SPA + fallback backend)

Vercel hosts **both** the built SPA and the `/api` fallback function from this
one repo.

```bash
npm i -g vercel
vercel login
cd share-crops-v2
vercel link
```

Set env vars on the Vercel **project** (Settings → Environment Variables, or CLI):

```bash
# Backend (used by the /api function) — Production + Preview:
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add APP_ID                 # dd877831
vercel env add STORAGE_BUCKET_NAME    # make-dd877831-sharecrops
vercel env add KV_TABLE_NAME          # kv_store_dd877831
vercel env add ADMIN_EMAIL
vercel env add CORS_ORIGINS
vercel env add DEFAULT_ORIGIN
vercel env add ANTHROPIC_API_KEY      # sk-ant-... — powers ✨ Draft with AI
vercel env add SKIP_INIT              # true
vercel env add FIREBASE_PROJECT_ID    # share-crops-app

# Frontend build-time Firebase web config (client-safe; Production + Preview):
vercel env add VITE_FIREBASE_API_KEY
vercel env add VITE_FIREBASE_AUTH_DOMAIN
vercel env add VITE_FIREBASE_PROJECT_ID
vercel env add VITE_FIREBASE_STORAGE_BUCKET
vercel env add VITE_FIREBASE_MESSAGING_SENDER_ID
vercel env add VITE_FIREBASE_APP_ID
vercel env add VITE_FIREBASE_MEASUREMENT_ID

# Frontend build-time — point the app at its own /api as the fallback:
vercel env add VITE_FALLBACK_API_URL  # https://<your-app>.vercel.app/api/make-server-dd877831
```

Then deploy:

```bash
vercel --prod
```

Build settings are in `vercel.json`. The `buildCommand` is
`node scripts/check-vercel-env.mjs && node scripts/build-api.mjs && vite build`:

- **`scripts/check-vercel-env.mjs`** fails the deploy early if the Firebase
  browser config or server-side project id is missing. Without the
  `VITE_FIREBASE_*` values, the login screen throws `auth/invalid-api-key` at
  module load and renders blank. The API verifier uses `FIREBASE_PROJECT_ID` for
  Firebase ID-token issuer/audience checks.
- **`scripts/build-api.mjs`** esbuild-bundles `server/entry.ts` into a single
  self-contained `api/index.js` (git-ignored, generated). This is required: the
  function imports the shared Hono backend from `supabase/functions/_shared`,
  which uses Deno-style `.ts`-extension imports that Vercel's own file tracer
  (`@vercel/nft`) can't follow — a plain `api/*.ts` ships without its dependency
  and dies at runtime with `ERR_MODULE_NOT_FOUND`. Pre-bundling inlines every
  local + npm dependency so there is nothing left to trace.
- **`vite build`** produces the SPA in `dist`.

`server/entry.ts` exports Web-standard per-method handlers (`GET`/`POST`/…) that
delegate to Hono's native `app.fetch`. Vercel's Node runtime calls these with a
Web `Request`. (Do **not** use `hono/vercel`'s `handle()` here — it assumes the
legacy `(req, res)` Node signature and throws `req.headers.get is not a function`.)

A `vercel.json` rewrite funnels every `/api/*` depth to the one function, and a
second rewrite serves the SPA for all non-`/api` paths.

> **Chicken-and-egg:** `VITE_FALLBACK_API_URL` needs the final Vercel URL. Either
> deploy once to learn the production domain, set the var, and redeploy; or set it
> to your custom domain up front.

---

## 4. Verify the failover

```bash
# Health check both backends:
curl https://xwjvtpzpufhuybylnwzx.supabase.co/functions/v1/make-server-dd877831/health
curl https://<app>.vercel.app/api/make-server-dd877831/health
```

The e2e suite (`npm run test:e2e`) includes `tests/failover.spec.ts`, which
forces the primary to 5xx and asserts the app still loads via the fallback.

---

## ⚠️ Pre-existing bug found while porting

The original backend called `kv.delete(...)` in 5 places (listing-delete and
offer-delete/relist paths), but the KV module only exports `del`. Those calls
throw `TypeError` at runtime on the **live Supabase function** today. The ported
copy here fixes them (`kv.delete` → `kv.del`). Apply the same fix to the original
`shareCropsApp/supabase/functions/server/index.tsx` (or redeploy from this repo).
