# Deploying Share Crops v2

## Production URLs (priority order)

| Role | URL | Notes |
|------|-----|--------|
| **Main (use this)** | `https://share-crops-v2.vercel.app` | Vercel SPA + `/api`. **Firebase auth is configured for this URL.** |
| Vercel backup | `https://share-crops-marketplace.vercel.app` | Second Vercel deployment; API failover target |
| Netlify backup | `https://sharecropsmarketplace.netlify.app` | Static SPA only when Vercel is down; calls Vercel APIs remotely |
| Firebase Hosting backup | `https://share-crops-app.web.app` | Static SPA only; calls Vercel APIs remotely |

Firebase **authDomain** is always `share-crops-app.firebaseapp.com` (not your site URL).
Add each **site hostname** to Firebase → Authentication → Authorized domains.

The production API path is `make-server-dd877831`. The Node Hono backend in
`server/` is the primary runtime today; the Supabase Edge Function copy remains
available as a tertiary API failover.

The frontend resolves API bases in `src/lib/appDomains.ts` and tries them in
order via `fetchWithFailover` in `src/lib/api.ts`:

- **Vercel main** (`share-crops-v2`) — same-origin
  `/api/make-server-dd877831`, then the marketplace Vercel API, then Supabase
  Edge.
- **Vercel marketplace fallback** — same-origin `/api/make-server-dd877831`,
  then Supabase Edge.
- **Static fallback hosts** (Netlify and Firebase Hosting) — remote v2 Vercel
  API, then marketplace Vercel API, then Supabase Edge.

Retries happen for network errors, HTML responses, 401/404, and 5xx responses
when another base is available. The Vercel and Supabase runtimes talk to the
same Supabase Postgres / KV / Storage, so the fallback chain stays useful across
host-specific outages.

```
                 ┌──────────── Vercel main ────────────┐
frontend ────────┤  /api/make-server-dd877831           ├── Supabase DB
  │ on retryable  └───────────────┬─────────────────────┘   (Postgres + KV
  │ error/HTML                    │                         + Storage)
  │                               ↓
  │              ┌────── Vercel marketplace fallback ───┐
  └─────────────→│  /api/make-server-dd877831            │
                 └───────────────┬──────────────────────┘
                                 ↓
                 ┌────── Supabase Edge tertiary API ────┐
                 │  /functions/v1/make-server-dd877831  │
                 └──────────────────────────────────────┘
```

---

## 1. API and build env vars

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
| `CORS_ORIGINS` | `https://share-crops-v2.vercel.app,https://share-crops-marketplace.vercel.app,https://sharecropsmarketplace.netlify.app,https://share-crops-app.web.app,https://share-crops-app.firebaseapp.com,http://localhost:5173,http://localhost:4321` | no |
| `DEFAULT_ORIGIN` | `https://share-crops-v2.vercel.app` (primary) | no |
| `VITE_FALLBACK_API_URL` | `https://share-crops-marketplace.vercel.app/api/make-server-dd877831` (backup API) | no |
| `VITE_SUPABASE_ANON_KEY` | Supabase project **anon** key (Dashboard → API) — browser Edge failover | no |
| `FIREBASE_PROJECT_ID` | `share-crops-app` — server-side Firebase ID-token verification | no |
| `VITE_FIREBASE_AUTH_DOMAIN` | `share-crops-app.firebaseapp.com` — **not** your Vercel URL | no |
| `VITE_FIREBASE_VAPID_KEY` | Firebase Console → Cloud Messaging → Web Push certificates; required for Profile → Enable notifications | no |
| `ANTHROPIC_API_KEY` | **required for AI listing drafts** — Anthropic API key | **yes** |
| `ANTHROPIC_DRAFT_MODEL` | optional — defaults to `claude-haiku-4-5-20251001` | no |
| `SKIP_INIT` | **Vercel only:** `true` (skips re-seeding on cold starts) | no |
| `NETLIFY_BLOBS_SITE_ID` | **optional** — Netlify site ID for stable image URLs (see §5) | no |
| `NETLIFY_BLOBS_TOKEN` | **optional** — Netlify personal access token with Blobs access (see §5) | **yes** |

> The service-role key is **not** in this repo and must never be committed.

---

## 2. Deploy the Supabase Edge Function (tertiary API failover)

The app no longer treats Supabase Edge as the primary runtime, but the browser
still appends it as the final API base. Keep it deployed if you want the
tertiary failover path to work when both Vercel API deployments are unavailable
or returning retryable responses.

```bash
cd share-crops-v2
supabase login                       # one-time
supabase link --project-ref xwjvtpzpufhuybylnwzx

# Set the function secrets:
supabase secrets set \
  SUPABASE_SERVICE_ROLE_KEY=... \
  ADMIN_EMAIL=... \
  ANTHROPIC_API_KEY=... \
  FIREBASE_PROJECT_ID=share-crops-app \
  APP_ID=dd877831 \
  STORAGE_BUCKET_NAME=make-dd877831-sharecrops \
  KV_TABLE_NAME=kv_store_dd877831 \
  CORS_ORIGINS="https://share-crops-v2.vercel.app,https://share-crops-marketplace.vercel.app,https://sharecropsmarketplace.netlify.app,https://share-crops-app.web.app,https://share-crops-app.firebaseapp.com,http://localhost:5173,http://localhost:4321" \
  DEFAULT_ORIGIN="https://share-crops-v2.vercel.app"

supabase functions deploy make-server-dd877831
```

`SUPABASE_URL` / `SUPABASE_ANON_KEY` are injected by the Supabase runtime
automatically. The `deno.json` import map resolves `hono` / `@supabase/supabase-js`.

---

## 3. Deploy to Vercel (frontend SPA + primary backend)

Vercel hosts **both** the built SPA and the `/api` function from this one repo.
Deploy the same configuration to the main `share-crops-v2` project and the
`share-crops-marketplace` fallback project.

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
vercel env add ANTHROPIC_API_KEY      # powers ✨ Draft with AI
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
vercel env add VITE_FIREBASE_VAPID_KEY   # Firebase Console → Cloud Messaging → Web Push certificates

# Frontend build-time — marketplace API to try after primary /api:
vercel env add VITE_FALLBACK_API_URL  # https://share-crops-marketplace.vercel.app/api/make-server-dd877831 (backup API)
vercel env add VITE_SUPABASE_ANON_KEY # enables browser calls to the Supabase Edge tertiary API
```

Then deploy:

```bash
vercel --prod
```

Build settings are in `vercel.json`. The `buildCommand` is
`node scripts/generate-sw.mjs && node scripts/check-vercel-env.mjs && vite build && node scripts/build-vercel-output.mjs`:

- **`scripts/generate-sw.mjs`** renders `public/sw.js` and
  `public/firebase-messaging-sw.js` from `scripts/templates/` and the
  `VITE_FIREBASE_*` build environment. Edit the templates, not the generated
  files in `public/`. Production builds must provide real Firebase web config;
  local dev and Playwright can use the demo placeholders from `.env.local`.
- **`scripts/check-vercel-env.mjs`** fails the deploy early if the Firebase
  browser config or server-side project id is missing. Without the
  `VITE_FIREBASE_*` values, the login screen throws `auth/invalid-api-key` at
  module load and renders blank. The API verifier uses `FIREBASE_PROJECT_ID` for
  Firebase ID-token issuer/audience checks.
- **`vite build`** produces the SPA in `dist` and, via a `closeBundle` hook in
  `vite.config.ts`, runs **`scripts/build-api.mjs`** to esbuild-bundle
  `server/entry.ts` into `api/index.js` (git-ignored).
- **`scripts/build-vercel-output.mjs`** assembles the **Vercel Build Output API**
  tree in `.vercel/output/` (static SPA + `functions/api/index.func`). This is
  required: with `outputDirectory: dist`, Vercel ignores `api/index.js` written
  outside `dist/` during the build, so `/api/*` silently 404s even though the
  bundle step succeeded. Routing (API rewrite + SPA fallback) lives in
  `.vercel/output/config.json`.

`server/entry.ts` exports Web-standard per-method handlers (`GET`/`POST`/…) that
delegate to Hono's native `app.fetch`. Vercel's Node runtime calls these with a
Web `Request`. (Do **not** use `hono/vercel`'s `handle()` here — it assumes the
legacy `(req, res)` Node signature and throws `req.headers.get is not a function`.)

A Build Output API route funnels every `/api/*` depth to the one function, and a
second route serves the SPA for all non-`/api` paths.

### Service worker and push notifications

`/sw.js` is the single service worker scope for the app. It handles both app-shell
offline caching and Firebase Cloud Messaging background notifications. The older
`/firebase-messaging-sw.js` file is generated only for backwards compatibility
with existing browser installs that activated it before FCM was merged into
`/sw.js`.

Operational constraints:

- Edit `scripts/templates/sw-shell.js` or
  `scripts/templates/sw-fcm-deprecated.js`; `scripts/generate-sw.mjs` rewrites
  the generated `public/*.js` files on `npm run dev`, `npm run build`, and the
  Vercel build command.
- The generated workers embed **public** Firebase web config from
  `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
  `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`,
  `VITE_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_FIREBASE_APP_ID`.
- `VITE_FIREBASE_VAPID_KEY` is not embedded in the worker, but it is required by
  `src/lib/firebaseMessaging.ts` before Profile → **Enable notifications** can
  register an FCM token with `POST /push/register`.

> **Chicken-and-egg:** `VITE_FALLBACK_API_URL` needs the final Vercel URL. Either
> deploy once to learn the production domain, set the var, and redeploy; or set it
> to your custom domain up front.

---

## 4. Verify API routing and failover

```bash
# Health check every API base in the production fallback chain:
curl https://share-crops-v2.vercel.app/api/make-server-dd877831/health
curl https://share-crops-marketplace.vercel.app/api/make-server-dd877831/health
curl https://xwjvtpzpufhuybylnwzx.supabase.co/functions/v1/make-server-dd877831/health
```

Each should return JSON `{"status":"ok",...}` — not HTML. If Vercel returns 404,
check the build log for `assembled .vercel/output` and confirm the deployment
includes a Serverless Function (not just static files).

The e2e suite (`npm run test:e2e`) includes `tests/failover.spec.ts`, which
forces the primary to 5xx and asserts the app still loads via the fallback.

---

## 5. Stable listing/profile images (Netlify Blobs)

By default, `/upload` stores files in **Supabase Storage** and returns a
**1-year signed URL** (`createSignedUrl(..., 31536000)`). That URL is persisted
on the listing or profile row — when it expires, the image breaks permanently.

When **both** `NETLIFY_BLOBS_SITE_ID` and `NETLIFY_BLOBS_TOKEN` are set on the
**Vercel** API runtime, uploads go to a Netlify Blob store instead. The API
returns a **stable same-origin URL**:

```
https://share-crops-v2.vercel.app/api/make-server-dd877831/images/<key>
```

`GET /images/:key` streams the blob with long-lived cache headers. Nothing in
the DB expires.

> **Where this applies:** Production uploads hit same-origin `/api` on Vercel
> (`src/lib/api.ts`), so Blobs vars belong on the **Vercel** project (both
> `share-crops-v2` and `share-crops-marketplace` if you use the fallback for
> uploads). The Supabase Edge Function failover copy still uses Supabase signed
> URLs — Deno does not run `@netlify/blobs` today.

### Enable on Vercel

1. **Site ID** — Netlify → [sharecropsmarketplace](https://app.netlify.com/projects/sharecropsmarketplace) → Site configuration → Site details → **Site ID**
2. **Token** — Netlify → User settings → Applications → **Personal access tokens** (create one with Blobs scope)
3. Add both to Vercel → Project → Environment Variables → **Production + Preview** (server-only, not `VITE_*`):

```bash
vercel env add NETLIFY_BLOBS_SITE_ID   # paste Site ID
vercel env add NETLIFY_BLOBS_TOKEN     # paste token (mark as Sensitive)
```

4. Redeploy both Vercel projects (`vercel --prod` or push to `main`).

### Verify

Upload a photo from **Create listing** or **Profile**. The JSON response should
include a URL under `…/images/…`, not a `supabase.co/storage/v1/object/sign/…`
link. Open the image URL in a new tab — it should load without auth.

Existing rows that still store old Supabase signed URLs are **not** migrated
automatically; re-upload photos or run a one-off refresh if needed.

---

## 6. Netlify static SPA (hosting fallback only)

`netlify.toml` deploys a **fallback frontend** when Vercel is unavailable. It has
**no `/api` function** — the SPA calls the **primary v2 Vercel API** first, then
the marketplace Vercel API (`VITE_FALLBACK_API_URL`).

> **Sign in at** `https://share-crops-v2.vercel.app/login` **for the supported
> Firebase auth flow.** The Netlify URL is for continuity only.

Site: [sharecropsmarketplace](https://app.netlify.com/projects/sharecropsmarketplace)

### Build

Netlify runs `npm install --include=dev && node scripts/netlify-prebuild.mjs && npm run build`
and publishes `dist/`. `NODE_VERSION=22` is set in `netlify.toml`.

`netlify-prebuild.mjs` deletes `api/index.js` (Vercel-only bundle). When
`NETLIFY_INJECT_FIREBASE=true` (the current `netlify.toml` setting), it keeps
the real Firebase web config from Netlify build env. Otherwise it fills missing
Firebase values with demo placeholders so preview builds can still produce a
static SPA.

### Secret scanning

Netlify's post-build secret scanner flags example tokens inside the Vercel API
bundle and public Firebase config in `dist/`. This repo sets scan overrides in
`netlify.toml` (`SECRETS_SCAN_ENABLED`, `SECRETS_SCAN_SMART_DETECTION_ENABLED`,
`SECRETS_SCAN_OMIT_PATHS`). If deploy previews still fail, confirm those vars in
the Netlify UI are not overridden back to enabled.

If `NETLIFY_INJECT_FIREBASE=false` or unset, builds use **placeholder** Firebase
keys so previews pass scanning; auth on the Netlify-hosted SPA will not work
until you inject real values.

### Real Firebase on Netlify (optional)

```bash
# Netlify UI — Production (and Preview if desired):
NETLIFY_INJECT_FIREBASE=true
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=share-crops-app.firebaseapp.com
# … remaining VITE_FIREBASE_* from Firebase Console
```

Add the Netlify site hostname to Firebase → Authentication → Authorized domains.

---

## 7. Firebase Hosting (static SPA)

`firebase.json` deploys the built SPA to **Firebase Hosting** at
`https://share-crops-app.web.app` (and `https://share-crops-app.firebaseapp.com`).
Like Netlify, this is a **static frontend only** — there is no `/api` function.
The SPA calls the Vercel APIs remotely (v2 first, then marketplace).

### One-time setup

1. **GitHub Actions secret (required)** — the first deploy failed because no
   credential was set, which is why `https://share-crops-app.web.app` shows
   **Site not found**. Add **one** of:

   **Option A — `FIREBASE_TOKEN` (recommended)**

   ```bash
   npx -y firebase-tools@latest login:ci
   ```

   Copy the token → GitHub → Settings → Secrets and variables → Actions →
   **New repository secret** → name `FIREBASE_TOKEN`.

   **Option B — `FIREBASE_SERVICE_ACCOUNT`**

   Firebase Console → Project settings → Service accounts → Generate new private
   key → paste the full JSON as secret `FIREBASE_SERVICE_ACCOUNT`.

2. **Re-run deploy** — Actions → **Firebase deploy** → **Run workflow** (or push
   to `main`). A successful run publishes the SPA to
   `https://share-crops-app.web.app`.

3. **Authorized domains** — Firebase Console → Authentication → Settings →
   Authorized domains: confirm `share-crops-app.web.app` is listed (default for Hosting).

4. **CORS** — Firebase Hosting origins are in `PRODUCTION_CORS_ORIGINS`
   (`scripts/domains.mjs`). Redeploy Vercel/Supabase if you added them after
   the last backend deploy.

### CI deploy

`.github/workflows/firebase-deploy.yml` runs on every push to `main` (and via
**Actions → Firebase deploy → Run workflow**). It builds with
`scripts/firebase-prebuild.mjs` and runs:

```bash
npx -y firebase-tools@latest deploy --only hosting,auth --project share-crops-app
```

The `auth` target syncs Google/email provider settings from `firebase.json`.

### Local deploy

Export the Firebase web config (or copy from `netlify.toml`), then:

```bash
export VITE_FIREBASE_API_KEY=...
export VITE_FIREBASE_AUTH_DOMAIN=share-crops-app.firebaseapp.com
# … remaining VITE_FIREBASE_* keys
npm run deploy:firebase
```

Or: `npx firebase-tools login` then `npm run configure:production -- --firebase-hosting`.

---

## ⚠️ Pre-existing bug found while porting

The original backend called `kv.delete(...)` in 5 places (listing-delete and
offer-delete/relist paths), but the KV module only exports `del`. Those calls
throw `TypeError` at runtime on the **live Supabase function** today. The ported
copy here fixes them (`kv.delete` → `kv.del`). Apply the same fix to the original
`shareCropsApp/supabase/functions/server/index.tsx` (or redeploy from this repo).
